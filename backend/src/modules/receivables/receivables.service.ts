import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  AccountStatus,
  CashMovementCategory,
  CashMovementType,
  PaymentMethod,
} from '../../common/constants/enums';
import {
  accountBalance,
  resolveAccountStatus,
} from '../../common/utils/account.util';
import {
  compareMoney,
  fitToBalance,
  money,
  toMoney,
} from '../../common/utils/money.util';
import { normalizeNullableId } from '../../common/utils/normalize.util';
import { buildPaginatedResult } from '../../common/utils/pagination.util';
import type { PrismaClientLike } from '../../prisma/prisma.service';
import { CashService } from '../cash/cash.service';
import { RatesService } from '../rates/rates.service';
import { ReceivableQueryDto } from './dto/receivable-query.dto';
import {
  CollectReceivableDto,
  CreateReceivableDto,
  UpdateReceivableDto,
} from './dto/receivable.dto';
import {
  RECEIVABLE_REFERENCE_TYPE,
  ReceivablesRepository,
} from './receivables.repository';

@Injectable()
export class ReceivablesService {
  constructor(
    private readonly repository: ReceivablesRepository,
    private readonly cash: CashService,
    private readonly rates: RatesService,
  ) {}

  async create(companyId: string, dto: CreateReceivableDto, userId: string) {
    // El monto se guarda en la moneda de la cuenta y su equivalente en USD
    // (`baseAmount`), que es el que suman los reportes y contra el que se
    // comparan los cobros (siempre en moneda base).
    const amount = toMoney(dto.amount);
    const conversion = await this.rates.resolvePayment(
      companyId,
      amount,
      dto.currency,
    );

    const data: Prisma.AccountReceivableUncheckedCreateInput = {
      companyId,
      customerId: normalizeNullableId(dto.customerId),
      orderId: normalizeNullableId(dto.orderId),
      description: dto.description,
      amount,
      currency: conversion.currency,
      exchangeRate: conversion.exchangeRate,
      baseAmount: conversion.baseAmount,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      reference: dto.reference,
      notes: dto.notes,
      status: AccountStatus.PENDING,
      createdById: userId,
    };

    const receivable = await this.repository.create(data);

    return this.withBalance(receivable);
  }

  async findAll(companyId: string, query: ReceivableQueryDto) {
    const { items, total, totalBaseAmount, totalPaidAmount } =
      await this.repository.findPage(companyId, query);

    return {
      ...buildPaginatedResult(
        items.map((item) => this.withBalance(item)),
        total,
        query.page,
        query.limit,
      ),
      totals: {
        amount: toMoney(totalBaseAmount),
        collected: toMoney(totalPaidAmount),
        balance: money.sub(
          toMoney(totalBaseAmount),
          toMoney(totalPaidAmount),
        ),
      },
    };
  }

  async findOne(companyId: string, id: string) {
    const receivable = await this.repository.findWithRelations(companyId, id);
    if (!receivable) {
      throw new NotFoundException('Cuenta por cobrar no encontrada');
    }
    return this.withBalance(receivable);
  }

  private withBalance<
    T extends {
      amount: number;
      baseAmount: number;
      paidAmount: number;
      status: string;
    },
  >(row: T) {
    return {
      ...row,
      status: resolveAccountStatus(row.baseAmount, row.paidAmount, row.status),
      balance: accountBalance(row.baseAmount, row.paidAmount),
    };
  }

  /** Actualiza datos. El monto y la moneda solo sin cobros registrados. */
  async update(companyId: string, id: string, dto: UpdateReceivableDto) {
    const receivable = await this.findOne(companyId, id);

    // Cambiar el monto o la moneda altera el equivalente en USD y el saldo.
    const monetaryChange =
      dto.amount !== undefined || dto.currency !== undefined;

    if (monetaryChange) {
      if (compareMoney(receivable.paidAmount, 0) > 0) {
        throw new BadRequestException(
          'No se puede cambiar el monto ni la moneda: la cuenta ya tiene cobros registrados.',
        );
      }
      if (receivable.status === AccountStatus.CANCELLED) {
        throw new BadRequestException('La cuenta esta anulada.');
      }
    }

    // Solo se recalcula la conversion si cambio el monto o la moneda.
    const amount = toMoney(dto.amount ?? receivable.amount);
    const conversion = monetaryChange
      ? await this.rates.resolvePayment(
          companyId,
          amount,
          dto.currency ?? receivable.currency,
        )
      : null;

    await this.repository.update(companyId, id, {
      ...(dto.customerId !== undefined
        ? { customerId: normalizeNullableId(dto.customerId) }
        : {}),
      ...(dto.description !== undefined
        ? { description: dto.description }
        : {}),
      ...(conversion
        ? {
            amount,
            currency: conversion.currency,
            exchangeRate: conversion.exchangeRate,
            baseAmount: conversion.baseAmount,
          }
        : {}),
      ...(dto.dueDate !== undefined
        ? { dueDate: dto.dueDate ? new Date(dto.dueDate) : null }
        : {}),
      ...(dto.reference !== undefined ? { reference: dto.reference } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
    });

    return this.findOne(companyId, id);
  }

  /**
   * Registra un cobro. Si es en efectivo (`depositToCash`, por defecto true
   * cuando el metodo es CASH) ingresa el dinero a la caja abierta.
   */
  async collect(
    companyId: string,
    id: string,
    dto: CollectReceivableDto,
    userId: string,
  ) {
    const receivable = await this.findOne(companyId, id);

    if (receivable.status === AccountStatus.CANCELLED) {
      throw new BadRequestException('La cuenta esta anulada');
    }

    // `amount` viene en la moneda del cobro; el saldo de la cuenta esta en la
    // moneda base (USD), por eso se compara el equivalente convertido.
    const amount = toMoney(dto.amount);
    const conversion = await this.rates.resolvePayment(
      companyId,
      amount,
      dto.currency,
    );
    const { currency, exchangeRate } = conversion;

    const balance = money.sub(receivable.baseAmount, receivable.paidAmount);
    // Se ajusta al saldo cuando el exceso es solo el redondeo de convertir a
    // otra moneda.
    const baseAmount = fitToBalance(conversion.baseAmount, balance);
    if (baseAmount === null) {
      throw new BadRequestException(
        `El cobro (${conversion.baseAmount} USD) supera el saldo pendiente (${balance} USD)`,
      );
    }

    const method = dto.method ?? PaymentMethod.CASH;
    const depositToCash = dto.depositToCash ?? method === PaymentMethod.CASH;

    return this.repository.transaction(async (tx) => {
      const payment = await this.repository.createPayment(
        {
          companyId,
          receivableId: id,
          amount,
          method,
          currency,
          exchangeRate,
          baseAmount,
          note: dto.note,
          createdById: userId,
        },
        tx,
      );

      if (depositToCash) {
        const session = await this.cash.getOpenSessionOrThrow(companyId, tx);
        await this.cash.registerMovement(
          companyId,
          {
            sessionId: session.id,
            type: CashMovementType.IN,
            category: CashMovementCategory.PAYMENT,
            paymentMethod: method,
            amount,
            currency,
            baseAmount,
            description: `Cobro CxC: ${receivable.description}`,
            referenceType: RECEIVABLE_REFERENCE_TYPE,
            referenceId: payment.id,
            createdById: userId,
          },
          tx,
        );
      }

      const paidAmount = money.add(receivable.paidAmount, baseAmount);
      await this.repository.updatePaymentTotals(
        companyId,
        id,
        {
          paidAmount,
          status: resolveAccountStatus(receivable.baseAmount, paidAmount),
        },
        tx,
      );

      const updated = await this.repository.findWithRelations(
        companyId,
        id,
        tx,
      );
      if (!updated) {
        throw new NotFoundException('Cuenta por cobrar no encontrada');
      }
      return this.withBalance(updated);
    });
  }

  /** Anula la cuenta (solo si no tiene cobros). */
  async cancel(companyId: string, id: string) {
    const receivable = await this.findOne(companyId, id);

    if (compareMoney(receivable.paidAmount, 0) > 0) {
      throw new BadRequestException(
        'No se puede anular una cuenta con cobros registrados.',
      );
    }
    if (receivable.status === AccountStatus.CANCELLED) return receivable;

    await this.repository.cancel(companyId, id);
    return this.findOne(companyId, id);
  }

  /** Elimina la cuenta (solo si no tiene cobros). */
  async remove(companyId: string, id: string) {
    const receivable = await this.findOne(companyId, id);

    if (compareMoney(receivable.paidAmount, 0) > 0) {
      throw new BadRequestException(
        'No se puede eliminar una cuenta con cobros. Anulala en su lugar.',
      );
    }

    await this.repository.remove(companyId, id);
    return { id, deleted: true };
  }

  /** Resumen por estado + saldo total por cobrar. */
  async summary(companyId: string) {
    const summary = await this.repository.summary(companyId);

    const totalAmount = toMoney(summary.openBaseAmount);
    const totalPaid = toMoney(summary.openPaidAmount);

    return {
      openAmount: totalAmount,
      openCollected: totalPaid,
      openBalance: money.sub(totalAmount, totalPaid),
      openCount: summary.openCount,
      byStatus: summary.byStatus.map((row) => ({
        status: row.status,
        count: row.count,
        amount: toMoney(row.baseAmount),
        collected: toMoney(row.paidAmount),
        balance: money.sub(
          toMoney(row.baseAmount),
          toMoney(row.paidAmount),
        ),
      })),
    };
  }

  /** Saldo total pendiente de cobro (para estadisticas). */
  async outstandingBalance(companyId: string) {
    const result = await this.repository.outstanding(companyId);
    return money.sub(
      toMoney(result.baseAmount),
      toMoney(result.paidAmount),
    );
  }
}
