import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { buildDateRangeFilter } from '../../common/utils/account.util';
import { toSkip } from '../../common/utils/pagination.util';
import { tenantWhere } from '../../common/utils/tenant.util';
import { PrismaService, type PrismaClientLike } from '../../prisma/prisma.service';
import { ExpenseQueryDto } from './dto/expense-query.dto';

/** Tipo de referencia con el que el gasto marca su movimiento de caja. */
export const EXPENSE_REFERENCE_TYPE = 'EXPENSE';

const EXPENSE_INCLUDE = {
  supplier: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  cashSession: { select: { id: true, code: true, status: true } },
} satisfies Prisma.ExpenseInclude;

export type ExpenseWithRelations = Prisma.ExpenseGetPayload<{
  include: typeof EXPENSE_INCLUDE;
}>;

/**
 * Acceso a datos de gastos. Toda consulta/escritura de Prisma del modulo vive
 * aqui: el servicio conserva las validaciones y las reglas de caja, pero no
 * conoce el cliente de base de datos.
 */
@Injectable()
export class ExpensesRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(tx?: PrismaClientLike): PrismaClientLike {
    return tx ?? this.prisma;
  }

  /** Ejecuta una unidad de trabajo dentro de una transaccion de base de datos. */
  transaction<T>(work: (tx: PrismaClientLike) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => work(tx));
  }

  create(data: Prisma.ExpenseUncheckedCreateInput, tx: PrismaClientLike) {
    return tx.expense.create({ data });
  }

  /** Gasto con sus relaciones dentro de su empresa (o `null`). */
  findWithRelations(
    companyId: string,
    id: string,
    tx?: PrismaClientLike,
  ): Promise<ExpenseWithRelations | null> {
    return this.client(tx).expense.findFirst({
      where: { id, ...tenantWhere(companyId) },
      include: EXPENSE_INCLUDE,
    });
  }

  /** Vincula el gasto con la sesion de caja que registro su egreso. */
  attachCashSession(
    companyId: string,
    id: string,
    cashSessionId: string,
    tx: PrismaClientLike,
  ) {
    return tx.expense.updateMany({
      where: { id, ...tenantWhere(companyId) },
      data: { cashSessionId },
    });
  }

  update(
    companyId: string,
    id: string,
    data: Prisma.ExpenseUpdateManyMutationInput,
    tx?: PrismaClientLike,
  ) {
    return this.client(tx).expense.updateMany({
      where: { id, ...tenantWhere(companyId) },
      data,
    });
  }

  remove(companyId: string, id: string, tx: PrismaClientLike) {
    return tx.expense.deleteMany({ where: { id, ...tenantWhere(companyId) } });
  }

  /** Pagina del listado con el total de filas y la suma en la moneda base. */
  async findPage(companyId: string, query: ExpenseQueryDto) {
    const where = this.listWhere(companyId, query);

    const [items, total, aggregate] = await this.prisma.$transaction([
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
      items,
      total,
      totalBaseAmount: aggregate._sum.baseAmount ?? 0,
    };
  }

  /** Totales agregados por categoria y metodo de pago del panel de gastos. */
  async summary(companyId: string, query: ExpenseQueryDto) {
    const where = this.summaryWhere(companyId, query);

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
      totalBaseAmount: total._sum.baseAmount ?? 0,
      byCategory: byCategory.map((row) => ({
        category: row.category,
        baseAmount: row._sum.baseAmount ?? 0,
        count: row._count._all,
      })),
      byMethod: byMethod.map((row) => ({
        method: row.paymentMethod,
        baseAmount: row._sum.baseAmount ?? 0,
        count: row._count._all,
      })),
    };
  }

  /** Suma de los gastos del rango en USD (moneda base). */
  async sumBaseAmountForRange(companyId: string, from: Date, to: Date) {
    const result = await this.prisma.expense.aggregate({
      where: { date: { gte: from, lte: to }, ...tenantWhere(companyId) },
      _sum: { baseAmount: true },
    });
    return result._sum.baseAmount ?? 0;
  }

  /** Movimiento de caja que respalda el gasto (para ajustarlo o revertirlo). */
  findCashMovement(companyId: string, expenseId: string, tx: PrismaClientLike) {
    return tx.cashMovement.findFirst({
      where: {
        referenceType: EXPENSE_REFERENCE_TYPE,
        referenceId: expenseId,
        ...tenantWhere(companyId),
      },
    });
  }

  updateCashMovement(
    companyId: string,
    movementId: string,
    data: Prisma.CashMovementUpdateManyMutationInput,
    tx: PrismaClientLike,
  ) {
    return tx.cashMovement.updateMany({
      where: { id: movementId, ...tenantWhere(companyId) },
      data,
    });
  }

  /** Borra los movimientos de caja del gasto (al eliminarlo). */
  deleteCashMovements(
    companyId: string,
    expenseId: string,
    tx: PrismaClientLike,
  ) {
    return tx.cashMovement.deleteMany({
      where: {
        referenceType: EXPENSE_REFERENCE_TYPE,
        referenceId: expenseId,
        ...tenantWhere(companyId),
      },
    });
  }

  private listWhere(
    companyId: string,
    query: ExpenseQueryDto,
  ): Prisma.ExpenseWhereInput {
    return {
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
  }

  /** El panel de gastos no filtra ni por metodo de pago ni por sesion de caja. */
  private summaryWhere(
    companyId: string,
    query: ExpenseQueryDto,
  ): Prisma.ExpenseWhereInput {
    return {
      ...tenantWhere(companyId),
      ...(query.category ? { category: query.category } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.from || query.to
        ? { date: buildDateRangeFilter(query.from, query.to) }
        : {}),
    };
  }
}

