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
import { normalizeNullableId } from '../../common/utils/normalize.util';
import { buildPaginatedResult } from '../../common/utils/pagination.util';
import type { PrismaClientLike } from '../../prisma/prisma.service';
import { CashService } from '../cash/cash.service';
import { RatesService } from '../rates/rates.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { ExpenseQueryDto } from './dto/expense-query.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import {
  EXPENSE_REFERENCE_TYPE,
  ExpensesRepository,
} from './expenses.repository';

@Injectable()
export class ExpensesService {
  constructor(
    private readonly repository: ExpensesRepository,
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

    return this.repository.transaction(async (tx) => {
      const data: Prisma.ExpenseUncheckedCreateInput = {
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
      };
      const expense = await this.repository.create(data, tx);

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
          referenceType: EXPENSE_REFERENCE_TYPE,
          referenceId: expense.id,
          createdById: userId,
        },
        tx,
      );

      await this.repository.attachCashSession(
        companyId,
        expense.id,
        session.id,
        tx,
      );

      return this.findWithInclude(companyId, tx, expense.id);
    });
  }

  /** Relee el gasto dentro de su empresa (nunca cruza datos entre empresas). */
  private async findWithInclude(
    companyId: string,
    tx: PrismaClientLike,
    id: string,
  ) {
    const expense = await this.repository.findWithRelations(companyId, id, tx);
    if (!expense) throw new NotFoundException('Gasto no encontrado');
    return expense;
  }

  async findAll(companyId: string, query: ExpenseQueryDto) {
    const { items, total, totalBaseAmount } = await this.repository.findPage(
      companyId,
      query,
    );

    return {
      ...buildPaginatedResult(items, total, query.page, query.limit),
      totals: { amount: toMoney(totalBaseAmount) },
    };
  }

  async findOne(companyId: string, id: string) {
    const expense = await this.repository.findWithRelations(companyId, id);
    if (!expense) throw new NotFoundException('Gasto no encontrado');
    return expense;
  }

  /** Totales agregados por categoria/metodo para el panel de gastos. */
  async summary(companyId: string, query: ExpenseQueryDto) {
    const summary = await this.repository.summary(companyId, query);

    return {
      total: toMoney(summary.totalBaseAmount),
      byCategory: summary.byCategory
        .map((row) => ({
          category: row.category,
          amount: toMoney(row.baseAmount),
          count: row.count,
        }))
        .sort((a, b) => b.amount - a.amount),
      byMethod: summary.byMethod.map((row) => ({
        method: row.method,
        amount: toMoney(row.baseAmount),
        count: row.count,
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

    return this.repository.transaction(async (tx) => {
      if (expense.cashSessionId && changed) {
        const movement = await this.repository.findCashMovement(
          companyId,
          expense.id,
          tx,
        );
        if (!movement) {
          throw new BadRequestException(
            'Inconsistencia: el gasto no tiene movimiento de caja asociado',
          );
        }
        await this.repository.updateCashMovement(
          companyId,
          movement.id,
          {
            amount,
            currency: conversion.currency,
            exchangeRate: conversion.exchangeRate,
            baseAmount: conversion.baseAmount,
            description: `Gasto: ${dto.description ?? expense.description}`,
          },
          tx,
        );
      }

      await this.repository.update(
        companyId,
        id,
        {
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
        tx,
      );

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

    return this.repository.transaction(async (tx) => {
      await this.repository.deleteCashMovements(companyId, expense.id, tx);
      await this.repository.remove(companyId, id, tx);
      return { id, deleted: true };
    });
  }

  /** Suma de gastos del rango en USD (usado por estadisticas). */
  async totalForRange(companyId: string, from: Date, to: Date) {
    const total = await this.repository.sumBaseAmountForRange(
      companyId,
      from,
      to,
    );
    return money.add(total, 0);
  }

}
