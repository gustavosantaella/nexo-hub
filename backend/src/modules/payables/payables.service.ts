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
  compareMoney,
  fitToBalance,
  money,
  toMoney,
} from '../../common/utils/money.util';
import {
  accountBalance,
  buildDateRangeFilter,
  resolveAccountStatus,
  startOfToday,
} from '../../common/utils/account.util';
import { normalizeNullableId } from '../../common/utils/normalize.util';
import {
  buildPaginatedResult,
  toSkip,
} from '../../common/utils/pagination.util';
import { tenantWhere } from '../../common/utils/tenant.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CashService } from '../cash/cash.service';
import { RatesService } from '../rates/rates.service';
import { PayableQueryDto } from './dto/payable-query.dto';
import {
  CreatePayableDto,
  PayPayableDto,
  UpdatePayableDto,
} from './dto/payable.dto';

const PAYABLE_INCLUDE = {
  supplier: { select: { id: true, name: true, phone: true } },
  createdBy: { select: { id: true, name: true } },
  payments: {
    orderBy: { createdAt: 'desc' },
    include: { createdBy: { select: { id: true, name: true } } },
  },
} satisfies Prisma.AccountPayableInclude;

/** Filtro por fecha de vencimiento (acepta 'YYYY-MM-DD' o ISO completo). */
@Injectable()
export class PayablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cash: CashService,
    private readonly rates: RatesService,
  ) {}

  async create(companyId: string, dto: CreatePayableDto, userId: string) {
    // El monto se guarda en la moneda de la cuenta y su equivalente en USD
    // (`baseAmount`), que es el que suman los reportes y contra el que se
    // comparan los abonos (siempre en moneda base).
    const amount = toMoney(dto.amount);
    const conversion = await this.rates.resolvePayment(
      companyId,
      amount,
      dto.currency,
    );

    const payable = await this.prisma.accountPayable.create({
      data: {
        companyId,
        supplierId: normalizeNullableId(dto.supplierId),
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
      include: PAYABLE_INCLUDE,
    });

    return this.withBalance(payable);
  }

  async findAll(companyId: string, query: PayableQueryDto) {
    const today = startOfToday();

    const where: Prisma.AccountPayableWhereInput = {
      ...tenantWhere(companyId),
      ...(query.status ? { status: query.status } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.search ? { description: { contains: query.search } } : {}),
      ...(query.from || query.to
        ? { dueDate: buildDateRangeFilter(query.from, query.to) }
        : {}),
      ...(query.overdueOnly
        ? {
            dueDate: { lt: today },
            status: { in: [AccountStatus.PENDING, AccountStatus.PARTIAL] },
          }
        : {}),
    };

    const [items, total, aggregate] = await this.prisma.$transaction([
      this.prisma.accountPayable.findMany({
        where,
        include: PAYABLE_INCLUDE,
        orderBy: query.toOrderBy(['dueDate', 'amount', 'createdAt'], {
          createdAt: 'desc',
        }),
        skip: toSkip(query.page, query.limit),
        take: query.limit,
      }),
      this.prisma.accountPayable.count({ where }),
      this.prisma.accountPayable.aggregate({
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
        paid: totalPaid,
        balance: money.sub(totalAmount, totalPaid),
      },
    };
  }

  async findOne(companyId: string, id: string) {
    const payable = await this.prisma.accountPayable.findFirst({
      where: { id, ...tenantWhere(companyId) },
      include: PAYABLE_INCLUDE,
    });
    if (!payable) throw new NotFoundException('Cuenta por pagar no encontrada');
    return this.withBalance(payable);
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

  /**
   * Actualiza datos de la cuenta. El monto y la moneda solo pueden cambiarse
   * mientras no existan abonos registrados (los abonos ya impactaron la caja).
   */
  async update(companyId: string, id: string, dto: UpdatePayableDto) {
    const payable = await this.findOne(companyId, id);

    // Cambiar el monto o la moneda altera el equivalente en USD y el saldo.
    const monetaryChange =
      dto.amount !== undefined || dto.currency !== undefined;

    if (monetaryChange) {
      if (compareMoney(payable.paidAmount, 0) > 0) {
        throw new BadRequestException(
          'No se puede cambiar el monto ni la moneda: la cuenta ya tiene abonos registrados.',
        );
      }
      if (payable.status === AccountStatus.CANCELLED) {
        throw new BadRequestException('La cuenta esta anulada.');
      }
    }

    // Solo se recalcula la conversion si cambio el monto o la moneda.
    const amount = toMoney(dto.amount ?? payable.amount);
    const conversion = monetaryChange
      ? await this.rates.resolvePayment(
          companyId,
          amount,
          dto.currency ?? payable.currency,
        )
      : null;

    await this.prisma.accountPayable.updateMany({
      where: { id, ...tenantWhere(companyId) },
      data: {
        ...(dto.supplierId !== undefined
          ? { supplierId: normalizeNullableId(dto.supplierId) }
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
   * Registra un abono. Si se paga en efectivo (`payFromCash`, por defecto true
   * cuando el metodo es CASH) genera el egreso correspondiente en la caja.
   */
  async addPayment(
    companyId: string,
    id: string,
    dto: PayPayableDto,
    userId: string,
  ) {
    const payable = await this.findOne(companyId, id);

    if (payable.status === AccountStatus.CANCELLED) {
      throw new BadRequestException('La cuenta esta anulada');
    }

    // `amount` viene en la moneda del pago; el saldo de la cuenta esta en la
    // moneda base (USD), por eso se compara el equivalente convertido.
    const amount = toMoney(dto.amount);
    const conversion = await this.rates.resolvePayment(
      companyId,
      amount,
      dto.currency,
    );
    const { currency, exchangeRate } = conversion;

    const balance = money.sub(payable.baseAmount, payable.paidAmount);
    // Se ajusta al saldo cuando el exceso es solo el redondeo de convertir a
    // otra moneda.
    const baseAmount = fitToBalance(conversion.baseAmount, balance);
    if (baseAmount === null) {
      throw new BadRequestException(
        `El abono (${conversion.baseAmount} USD) supera el saldo pendiente (${balance} USD)`,
      );
    }

    const method = dto.method ?? PaymentMethod.CASH;
    const payFromCash = dto.payFromCash ?? method === PaymentMethod.CASH;

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payablePayment.create({
        data: {
          companyId,
          payableId: id,
          amount,
          method,
          currency,
          exchangeRate,
          baseAmount,
          note: dto.note,
          createdById: userId,
        },
      });

      if (payFromCash) {
        const session = await this.cash.getOpenSessionOrThrow(companyId, tx);
        await this.cash.registerMovement(
          companyId,
          {
            sessionId: session.id,
            type: CashMovementType.OUT,
            category: CashMovementCategory.PAYMENT,
            paymentMethod: method,
            amount,
            currency,
            baseAmount,
            description: `Abono CxP: ${payable.description}`,
            referenceType: 'PAYABLE',
            referenceId: payment.id,
            createdById: userId,
          },
          tx,
        );
      }

      const paidAmount = money.add(payable.paidAmount, baseAmount);
      await tx.accountPayable.updateMany({
        where: { id, ...tenantWhere(companyId) },
        data: {
          paidAmount,
          status: resolveAccountStatus(payable.baseAmount, paidAmount),
        },
      });

      const updated = await tx.accountPayable.findFirst({
        where: { id, ...tenantWhere(companyId) },
        include: PAYABLE_INCLUDE,
      });
      if (!updated) {
        throw new NotFoundException('Cuenta por pagar no encontrada');
      }
      return this.withBalance(updated);
    });
  }

  /** Anula la cuenta (solo si no tiene abonos). */
  async cancel(companyId: string, id: string) {
    const payable = await this.findOne(companyId, id);

    if (compareMoney(payable.paidAmount, 0) > 0) {
      throw new BadRequestException(
        'No se puede anular una cuenta con abonos registrados.',
      );
    }
    if (payable.status === AccountStatus.CANCELLED) {
      return payable;
    }

    await this.prisma.accountPayable.updateMany({
      where: { id, ...tenantWhere(companyId) },
      data: { status: AccountStatus.CANCELLED },
    });
    return this.findOne(companyId, id);
  }

  /** Elimina la cuenta (solo si no tiene abonos). */
  async remove(companyId: string, id: string) {
    const payable = await this.findOne(companyId, id);

    if (compareMoney(payable.paidAmount, 0) > 0) {
      throw new BadRequestException(
        'No se puede eliminar una cuenta con abonos. Anulala en su lugar.',
      );
    }

    await this.prisma.accountPayable.deleteMany({
      where: { id, ...tenantWhere(companyId) },
    });
    return { id, deleted: true };
  }

  /** Resumen por estado + saldo total pendiente. */
  async summary(companyId: string) {
    // Promise.all (y no $transaction): Prisma pierde la inferencia de tipos de
    // `groupBy` dentro del arreglo de la transaccion. Solo son lecturas.
    const [byStatus, aggregate] = await Promise.all([
      this.prisma.accountPayable.groupBy({
        by: ['status'],
        where: tenantWhere(companyId),
        orderBy: { status: 'asc' },
        _sum: { baseAmount: true, paidAmount: true },
        _count: { _all: true },
      }),
      this.prisma.accountPayable.aggregate({
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
      openPaid: totalPaid,
      openBalance: money.sub(totalAmount, totalPaid),
      openCount: aggregate._count._all,
      byStatus: byStatus.map((row) => ({
        status: row.status,
        count: row._count._all,
        amount: toMoney(row._sum.baseAmount ?? 0),
        paid: toMoney(row._sum.paidAmount ?? 0),
        balance: money.sub(
          toMoney(row._sum.baseAmount ?? 0),
          toMoney(row._sum.paidAmount ?? 0),
        ),
      })),
    };
  }

  /** Saldo total pendiente de pago (para estadisticas del dashboard). */
  async outstandingBalance(companyId: string) {
    const result = await this.prisma.accountPayable.aggregate({
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

