import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  CashMovementCategory,
  CashMovementType,
  CashSessionStatus,
  PaymentMethod,
} from '../../common/constants/enums';
import { money, toMoney } from '../../common/utils/money.util';
import { buildDateRangeFilter } from '../../common/utils/account.util';
import { normalizeNullableId } from '../../common/utils/normalize.util';
import {
  buildPaginatedResult,
  toSkip,
} from '../../common/utils/pagination.util';
import { tenantWhere } from '../../common/utils/tenant.util';
import { PrismaService, type PrismaClientLike } from '../../prisma/prisma.service';
import { CashService } from '../cash/cash.service';
import { RatesService } from '../rates/rates.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { ExpenseQueryDto } from './dto/expense-query.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';

const EXPENSE_INCLUDE = {
  supplier: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  cashSession: { select: { id: true, code: true, status: true } },
} satisfies Prisma.ExpenseInclude;

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cash: CashService,
    private readonly rates: RatesService,
  ) {}

  /**
   * Registra el gasto. Si se paga en efectivo (`payFromCash`, por defecto true
   * cuando el metodo es CASH) genera automaticamente el egreso de caja.
   *
   * El monto se guarda en la moneda del pago y su equivalente en USD
   * (`baseAmount`), que es el que suman los reportes.
   */
  async create(companyId: string, dto: CreateExpenseDto, userId: string) {
    const amount = toMoney(dto.amount);
    const conversion = await this.rates.resolvePayment(
      companyId,
      amount,
      dto.currency,
    );
    const paymentMethod = dto.paymentMethod ?? PaymentMethod.CASH;
    const payFromCash = dto.payFromCash ?? paymentMethod === PaymentMethod.CASH;

    return this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          companyId,
          category: dto.category,
          description: dto.description,
          amount,
          currency: conversion.currency,
          exchangeRate: conversion.exchangeRate,
          baseAmount: conversion.baseAmount,
          date: dto.date ? new Date(dto.date) : new Date(),
          paymentMethod,
          supplierId: normalizeNullableId(dto.supplierId),
          createdById: userId,
        },
      });

      if (!payFromCash) return this.findWithInclude(companyId, tx, expense.id);

      const session = await this.cash.getOpenSessionOrThrow(companyId, tx);
      await this.cash.registerMovement(
        companyId,
        {
          sessionId: session.id,
          type: CashMovementType.OUT,
          category: CashMovementCategory.EXPENSE,
          paymentMethod,
          amount,
          currency: conversion.currency,
          description: `Gasto: ${dto.description}`,
          referenceType: 'EXPENSE',
          referenceId: expense.id,
          createdById: userId,
        },
        tx,
      );

      await tx.expense.updateMany({
        where: { id: expense.id, ...tenantWhere(companyId) },
        data: { cashSessionId: session.id },
      });

      return this.findWithInclude(companyId, tx, expense.id);
    });
  }

  /** Relee el gasto dentro de su empresa (nunca cruza datos entre empresas). */
  private async findWithInclude(
    companyId: string,
    tx: PrismaClientLike,
    id: string,
  ) {
    const expense = await tx.expense.findFirst({
      where: { id, ...tenantWhere(companyId) },
      include: EXPENSE_INCLUDE,
    });
    if (!expense) throw new NotFoundException('Gasto no encontrado');
    return expense;
  }

  async findAll(companyId: string, query: ExpenseQueryDto) {
    const where: Prisma.ExpenseWhereInput = {
      ...tenantWhere(companyId),
      ...(query.category ? { category: query.category } : {}),
      ...(query.paymentMethod ? { paymentMethod: query.paymentMethod } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.cashSessionId ? { cashSessionId: query.cashSessionId } : {}),
      ...(query.from || query.to
        ? { date: buildDateRangeFilter(query.from, query.to) }
        : {}),
      ...(query.search ? { description: { contains: query.search } } : {}),
    };

    const [items, total, sum] = await this.prisma.$transaction([
      this.prisma.expense.findMany({
        where,
        include: EXPENSE_INCLUDE,
        orderBy: query.toOrderBy(['date', 'amount', 'createdAt'], {
          date: 'desc',
        }),
        skip: toSkip(query.page, query.limit),
        take: query.limit,
      }),
      this.prisma.expense.count({ where }),
      // Los totales se suman en la moneda base (USD) para no mezclar monedas.
      this.prisma.expense.aggregate({ where, _sum: { baseAmount: true } }),
    ]);

    return {
      ...buildPaginatedResult(items, total, query.page, query.limit),
      totals: { amount: toMoney(sum._sum.baseAmount ?? 0) },
    };
  }

  async findOne(companyId: string, id: string) {
    const expense = await this.prisma.expense.findFirst({
      where: { id, ...tenantWhere(companyId) },
      include: EXPENSE_INCLUDE,
    });
    if (!expense) throw new NotFoundException('Gasto no encontrado');
    return expense;
  }

  /** Totales agregados por categoria/metodo para el panel de gastos. */
  async summary(companyId: string, query: ExpenseQueryDto) {
    const where: Prisma.ExpenseWhereInput = {
      ...tenantWhere(companyId),
      ...(query.category ? { category: query.category } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.from || query.to
        ? { date: buildDateRangeFilter(query.from, query.to) }
        : {}),
    };

    // Nota: se usa Promise.all (en lugar de $transaction) porque Prisma pierde
    // la inferencia de tipos de `groupBy` cuando va dentro del arreglo de una
    // transaccion. Son solo lecturas, asi que no se requiere atomicidad.
    const [byCategory, byMethod, total] = await Promise.all([
      this.prisma.expense.groupBy({
        by: ['category'],
        where,
        orderBy: { category: 'asc' },
        _sum: { baseAmount: true },
        _count: { _all: true },
      }),
      this.prisma.expense.groupBy({
        by: ['paymentMethod'],
        where,
        orderBy: { paymentMethod: 'asc' },
        _sum: { baseAmount: true },
        _count: { _all: true },
      }),
      this.prisma.expense.aggregate({ where, _sum: { baseAmount: true } }),
    ]);

    return {
      total: toMoney(total._sum.baseAmount ?? 0),
      byCategory: byCategory
        .map((row) => ({
          category: row.category,
          amount: toMoney(row._sum.baseAmount ?? 0),
          count: row._count._all,
        }))
        .sort((a, b) => b.amount - a.amount),
      byMethod: byMethod.map((row) => ({
        method: row.paymentMethod,
        amount: toMoney(row._sum.baseAmount ?? 0),
        count: row._count._all,
      })),
    };
  }

  /**
   * Actualiza el gasto. Si esta vinculado a una sesion de caja CERRADA no se
   * puede tocar (registro inmutable). Si la sesion sigue abierta y cambia el
   * monto, se ajusta el movimiento de caja para mantener el arqueo coherente.
   */
  async update(companyId: string, id: string, dto: UpdateExpenseDto) {
    const expense = await this.findOne(companyId, id);
    const amount =
      dto.amount !== undefined ? toMoney(dto.amount) : expense.amount;
    const currency = dto.currency ?? expense.currency;

    if (expense.cashSession?.status === CashSessionStatus.CLOSED) {
      throw new BadRequestException(
        'No se puede modificar un gasto asociado a una caja ya cerrada. Registra un ajuste.',
      );
    }

    // Solo se recalcula la conversion si cambio el monto o la moneda.
    const changed =
      dto.amount !== undefined || dto.currency !== undefined;
    const conversion = changed
      ? await this.rates.resolvePayment(companyId, amount, currency)
      : {
          currency: expense.currency,
          exchangeRate: expense.exchangeRate,
          baseAmount: expense.baseAmount,
        };

    return this.prisma.$transaction(async (tx) => {
      if (expense.cashSessionId && changed) {
        const movement = await tx.cashMovement.findFirst({
          where: {
            referenceType: 'EXPENSE',
            referenceId: expense.id,
            ...tenantWhere(companyId),
          },
        });
        if (!movement) {
          throw new BadRequestException(
            'Inconsistencia: el gasto no tiene movimiento de caja asociado',
          );
        }
        await tx.cashMovement.updateMany({
          where: { id: movement.id, ...tenantWhere(companyId) },
          data: {
            amount,
            currency: conversion.currency,
            exchangeRate: conversion.exchangeRate,
            baseAmount: conversion.baseAmount,
            description: `Gasto: ${dto.description ?? expense.description}`,
          },
        });
      }

      await tx.expense.updateMany({
        where: { id, ...tenantWhere(companyId) },
        data: {
          ...(dto.category !== undefined ? { category: dto.category } : {}),
          ...(dto.description !== undefined
            ? { description: dto.description }
            : {}),
          ...(dto.amount !== undefined ? { amount } : {}),
          ...(dto.currency !== undefined
            ? { currency: conversion.currency }
            : {}),
          ...(changed
            ? {
                exchangeRate: conversion.exchangeRate,
                baseAmount: conversion.baseAmount,
              }
            : {}),
          ...(dto.date !== undefined ? { date: new Date(dto.date) } : {}),
          ...(dto.paymentMethod !== undefined
            ? { paymentMethod: dto.paymentMethod }
            : {}),
          ...(dto.supplierId !== undefined
            ? { supplierId: normalizeNullableId(dto.supplierId) }
            : {}),
        },
      });

      return this.findWithInclude(companyId, tx, id);
    });
  }

  /**
   * Elimina el gasto. Si impacto caja solo se permite mientras la sesion siga
   * abierta: en ese caso se elimina tambien el movimiento de caja.
   */
  async remove(companyId: string, id: string) {
    const expense = await this.findOne(companyId, id);

    if (expense.cashSession?.status === CashSessionStatus.CLOSED) {
      throw new BadRequestException(
        'No se puede eliminar un gasto de una caja cerrada. Registra el reverso en la caja actual.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.cashMovement.deleteMany({
        where: {
          referenceType: 'EXPENSE',
          referenceId: expense.id,
          ...tenantWhere(companyId),
        },
      });
      await tx.expense.deleteMany({ where: { id, ...tenantWhere(companyId) } });
      return { id, deleted: true };
    });
  }

  /** Suma de gastos del rango en USD (usado por estadisticas). */
  async totalForRange(companyId: string, from: Date, to: Date) {
    const result = await this.prisma.expense.aggregate({
      where: { date: { gte: from, lte: to }, ...tenantWhere(companyId) },
      _sum: { baseAmount: true },
    });
    return money.add(result._sum.baseAmount ?? 0, 0);
  }

}
