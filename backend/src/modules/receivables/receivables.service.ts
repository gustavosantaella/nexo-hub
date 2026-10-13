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
  buildDateRangeFilter,
  resolveAccountStatus,
  startOfToday,
} from '../../common/utils/account.util';
import {
  compareMoney,
  fitToBalance,
  money,
  toMoney,
} from '../../common/utils/money.util';
import { normalizeNullableId } from '../../common/utils/normalize.util';
import {
  buildPaginatedResult,
  toSkip,
} from '../../common/utils/pagination.util';
import { tenantWhere } from '../../common/utils/tenant.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CashService } from '../cash/cash.service';
import { RatesService } from '../rates/rates.service';
import { ReceivableQueryDto } from './dto/receivable-query.dto';
import {
  CollectReceivableDto,
  CreateReceivableDto,
  UpdateReceivableDto,
} from './dto/receivable.dto';

const RECEIVABLE_INCLUDE = {
  customer: { select: { id: true, name: true, phone: true } },
  payments: {
    orderBy: { createdAt: 'desc' },
    include: { createdBy: { select: { id: true, name: true } } },
  },
} satisfies Prisma.AccountReceivableInclude;

@Injectable()
export class ReceivablesService {
  constructor(
    private readonly prisma: PrismaService,
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

    const receivable = await this.prisma.accountReceivable.create({
      data: {
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
      },
      include: RECEIVABLE_INCLUDE,
    });

    return this.withBalance(receivable);
  }

  async findAll(companyId: string, query: ReceivableQueryDto) {
    const today = startOfToday();

    const where: Prisma.AccountReceivableWhereInput = {
      ...tenantWhere(companyId),
      ...(query.status ? { status: query.status } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.search ? { description: { contains: query.search } } : {}),
      ...(query.overdueOnly
        ? {
            dueDate: { lt: today },
            status: { in: [AccountStatus.PENDING, AccountStatus.PARTIAL] },
          }
        : {}),
      ...(query.from || query.to
        ? { dueDate: buildDateRangeFilter(query.from, query.to) }
        : {}),
    };

    const [items, total, aggregate] = await this.prisma.$transaction([
      this.prisma.accountReceivable.findMany({
        where,
        include: RECEIVABLE_INCLUDE,
        orderBy: query.toOrderBy(['dueDate', 'amount', 'createdAt'], {
          createdAt: 'desc',
        }),
        skip: toSkip(query.page, query.limit),
        take: query.limit,
      }),
      this.prisma.accountReceivable.count({ where }),
      this.prisma.accountReceivable.aggregate({
        where,
        _sum: { baseAmount: true, paidAmount: true },
      }),
    ]);

    const totalAmount = toMoney(aggregate._sum.baseAmount ?? 0);
    const totalPaid = toMoney(aggregate._sum.paidAmount ?? 0);

    return {
      ...buildPaginatedResult(
        items.map((item) => this.withBalance(item)),
        total,
        query.page,
        query.limit,
      ),
      totals: {
        amount: totalAmount,
        collected: totalPaid,
        balance: money.sub(totalAmount, totalPaid),
      },
    };
  }

  async findOne(companyId: string, id: string) {
    const receivable = await this.prisma.accountReceivable.findFirst({
      where: { id, ...tenantWhere(companyId) },
      include: RECEIVABLE_INCLUDE,
    });
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

    await this.prisma.accountReceivable.updateMany({
      where: { id, ...tenantWhere(companyId) },
      data: {
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
      },
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

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.receivablePayment.create({
        data: {
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
      });

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
            referenceType: 'RECEIVABLE',
            referenceId: payment.id,
            createdById: userId,
          },
          tx,
        );
      }

      const paidAmount = money.add(receivable.paidAmount, baseAmount);
      await tx.accountReceivable.updateMany({
        where: { id, ...tenantWhere(companyId) },
        data: {
          paidAmount,
          status: resolveAccountStatus(receivable.baseAmount, paidAmount),
        },
      });

      const updated = await tx.accountReceivable.findFirst({
        where: { id, ...tenantWhere(companyId) },
        include: RECEIVABLE_INCLUDE,
      });
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

    await this.prisma.accountReceivable.updateMany({
      where: { id, ...tenantWhere(companyId) },
      data: { status: AccountStatus.CANCELLED },
    });
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

    await this.prisma.accountReceivable.deleteMany({
      where: { id, ...tenantWhere(companyId) },
    });
    return { id, deleted: true };
  }

  /** Resumen por estado + saldo total por cobrar. */
  async summary(companyId: string) {
    // Promise.all (y no $transaction): Prisma pierde la inferencia de tipos de
    // `groupBy` dentro del arreglo de la transaccion. Solo son lecturas.
    const [byStatus, aggregate] = await Promise.all([
      this.prisma.accountReceivable.groupBy({
        by: ['status'],
        where: tenantWhere(companyId),
        orderBy: { status: 'asc' },
        _sum: { baseAmount: true, paidAmount: true },
        _count: { _all: true },
      }),
      this.prisma.accountReceivable.aggregate({
        where: {
          status: { in: [AccountStatus.PENDING, AccountStatus.PARTIAL] },
          ...tenantWhere(companyId),
        },
        _sum: { baseAmount: true, paidAmount: true },
        _count: { _all: true },
      }),
    ]);

    const totalAmount = toMoney(aggregate._sum.baseAmount ?? 0);
    const totalPaid = toMoney(aggregate._sum.paidAmount ?? 0);

    return {
      openAmount: totalAmount,
      openCollected: totalPaid,
      openBalance: money.sub(totalAmount, totalPaid),
      openCount: aggregate._count._all,
      byStatus: byStatus.map((row) => ({
        status: row.status,
        count: row._count._all,
        amount: toMoney(row._sum.baseAmount ?? 0),
        collected: toMoney(row._sum.paidAmount ?? 0),
        balance: money.sub(
          toMoney(row._sum.baseAmount ?? 0),
          toMoney(row._sum.paidAmount ?? 0),
        ),
      })),
    };
  }

  /** Saldo total pendiente de cobro (para estadisticas). */
  async outstandingBalance(companyId: string) {
    const result = await this.prisma.accountReceivable.aggregate({
      where: {
        status: { in: [AccountStatus.PENDING, AccountStatus.PARTIAL] },
        ...tenantWhere(companyId),
      },
      _sum: { baseAmount: true, paidAmount: true },
    });
    return money.sub(
      toMoney(result._sum.baseAmount ?? 0),
      toMoney(result._sum.paidAmount ?? 0),
    );
  }
}
