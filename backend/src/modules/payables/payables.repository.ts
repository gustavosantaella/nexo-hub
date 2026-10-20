import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AccountStatus } from '../../common/constants/enums';
import {
  buildDateRangeFilter,
  startOfToday,
} from '../../common/utils/account.util';
import { toSkip } from '../../common/utils/pagination.util';
import { tenantWhere } from '../../common/utils/tenant.util';
import { PrismaService, type PrismaClientLike } from '../../prisma/prisma.service';
import { PayableQueryDto } from './dto/payable-query.dto';

/** Tipo de referencia con el que el abono marca su movimiento de caja. */
export const PAYABLE_REFERENCE_TYPE = 'PAYABLE';

const PAYABLE_INCLUDE = {
  supplier: { select: { id: true, name: true, phone: true } },
  createdBy: { select: { id: true, name: true } },
  payments: {
    orderBy: { createdAt: 'desc' },
    include: { createdBy: { select: { id: true, name: true } } },
  },
} satisfies Prisma.AccountPayableInclude;

export type PayableWithRelations = Prisma.AccountPayableGetPayload<{
  include: typeof PAYABLE_INCLUDE;
}>;

/** Estado y saldo calculados que se persisten al registrar un abono. */
export interface PayablePaymentTotals {
  paidAmount: number;
  status: string;
}

/**
 * Acceso a datos de cuentas por pagar. Toda consulta/escritura de Prisma del
 * modulo vive aqui: el servicio conserva las reglas de negocio (monedas, saldos
 * y caja), pero no conoce el cliente de base de datos.
 */
@Injectable()
export class PayablesRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(tx?: PrismaClientLike): PrismaClientLike {
    return tx ?? this.prisma;
  }

  /** Ejecuta una unidad de trabajo dentro de una transaccion de base de datos. */
  transaction<T>(work: (tx: PrismaClientLike) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => work(tx));
  }

  create(data: Prisma.AccountPayableUncheckedCreateInput) {
    return this.prisma.accountPayable.create({
      data,
      include: PAYABLE_INCLUDE,
    });
  }

  /** Cuenta con su proveedor y sus abonos dentro de su empresa (o `null`). */
  findWithRelations(
    companyId: string,
    id: string,
    tx?: PrismaClientLike,
  ): Promise<PayableWithRelations | null> {
    return this.client(tx).accountPayable.findFirst({
      where: { id, ...tenantWhere(companyId) },
      include: PAYABLE_INCLUDE,
    });
  }

  update(
    companyId: string,
    id: string,
    data: Prisma.AccountPayableUpdateManyMutationInput,
  ) {
    return this.prisma.accountPayable.updateMany({
      where: { id, ...tenantWhere(companyId) },
      data,
    });
  }

  cancel(companyId: string, id: string) {
    return this.prisma.accountPayable.updateMany({
      where: { id, ...tenantWhere(companyId) },
      data: { status: AccountStatus.CANCELLED },
    });
  }

  remove(companyId: string, id: string) {
    return this.prisma.accountPayable.deleteMany({
      where: { id, ...tenantWhere(companyId) },
    });
  }

  /** Pagina del listado con el total de filas y los importes acumulados. */
  async findPage(companyId: string, query: PayableQueryDto) {
    const where = this.listWhere(companyId, query);

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

    return {
      items,
      total,
      totalBaseAmount: aggregate._sum.baseAmount ?? 0,
      totalPaidAmount: aggregate._sum.paidAmount ?? 0,
    };
  }

  /** Registra el abono a la cuenta (dentro de la transaccion del servicio). */
  createPayment(
    data: Prisma.PayablePaymentUncheckedCreateInput,
    tx: PrismaClientLike,
  ) {
    return tx.payablePayment.create({ data });
  }

  /** Refresca el importe abonado y el estado derivado de la cuenta. */
  updatePaymentTotals(
    companyId: string,
    id: string,
    totals: PayablePaymentTotals,
    tx: PrismaClientLike,
  ) {
    return tx.accountPayable.updateMany({
      where: { id, ...tenantWhere(companyId) },
      data: { paidAmount: totals.paidAmount, status: totals.status },
    });
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

    return {
      openBaseAmount: aggregate._sum.baseAmount ?? 0,
      openPaidAmount: aggregate._sum.paidAmount ?? 0,
      openCount: aggregate._count._all,
      byStatus: byStatus.map((row) => ({
        status: row.status,
        baseAmount: row._sum.baseAmount ?? 0,
        paidAmount: row._sum.paidAmount ?? 0,
        count: row._count._all,
      })),
    };
  }

  /** Saldo total pendiente de pago (para estadisticas del dashboard). */
  async outstanding(companyId: string) {
    const result = await this.prisma.accountPayable.aggregate({
      where: {
        status: { in: [AccountStatus.PENDING, AccountStatus.PARTIAL] },
        ...tenantWhere(companyId),
      },
      _sum: { baseAmount: true, paidAmount: true },
    });
    return {
      baseAmount: result._sum.baseAmount ?? 0,
      paidAmount: result._sum.paidAmount ?? 0,
    };
  }

  private listWhere(
    companyId: string,
    query: PayableQueryDto,
  ): Prisma.AccountPayableWhereInput {
    const today = startOfToday();

    return {
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
  }
}
