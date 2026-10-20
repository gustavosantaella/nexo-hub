import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { CashSessionStatus } from '../../common/constants/enums';
import { normalizeCurrencyCode } from '../../common/constants/currencies';
import { buildDateRange } from '../../common/utils/date.util';
import { toSkip } from '../../common/utils/pagination.util';
import { tenantWhere } from '../../common/utils/tenant.util';
import { PrismaService, type PrismaClientLike } from '../../prisma/prisma.service';
import { CashMovementQueryDto, CashSessionQueryDto } from './dto/cash-query.dto';

/** Sesion con su arqueo completo (movimientos + usuarios de apertura/cierre). */
const SESSION_INCLUDE = {
  openedBy: { select: { id: true, name: true, email: true } },
  closedBy: { select: { id: true, name: true, email: true } },
  movements: {
    orderBy: { createdAt: 'desc' },
    include: { createdBy: { select: { id: true, name: true } } },
  },
} satisfies Prisma.CashSessionInclude;

/** Listado de sesiones: usuarios y conteos, sin traer los movimientos. */
const SESSION_LIST_INCLUDE = {
  openedBy: { select: { id: true, name: true } },
  closedBy: { select: { id: true, name: true } },
  _count: { select: { movements: true, orders: true } },
} satisfies Prisma.CashSessionInclude;

/** Listado de movimientos con su usuario y la sesion a la que pertenecen. */
const MOVEMENT_LIST_INCLUDE = {
  createdBy: { select: { id: true, name: true } },
  session: { select: { id: true, code: true, status: true } },
} satisfies Prisma.CashMovementInclude;

/** Pedidos con propina y sus cobros (para separar la propina del arqueo). */
const ORDER_TIPS_SELECT = {
  id: true,
  total: true,
  tip: true,
  payments: {
    select: {
      id: true,
      amount: true,
      baseAmount: true,
      cashMovementId: true,
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.OrderSelect;

export type CashSessionWithRelations = Prisma.CashSessionGetPayload<{
  include: typeof SESSION_INCLUDE;
}>;

export type CashOrderTips = Prisma.OrderGetPayload<{
  select: typeof ORDER_TIPS_SELECT;
}>;

/**
 * Acceso a datos de caja. Toda consulta/escritura de Prisma del modulo vive
 * aqui: el servicio conserva el arqueo, las conversiones y las reglas de
 * apertura/cierre, pero no conoce el cliente de base de datos.
 */
@Injectable()
export class CashRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(tx?: PrismaClientLike): PrismaClientLike {
    return tx ?? this.prisma;
  }

  /** Ejecuta una unidad de trabajo dentro de una transaccion de base de datos. */
  /** Ejecuta una unidad de trabajo dentro de una transaccion de base de datos. */
  transaction<T>(work: (tx: PrismaClientLike) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => work(tx));
  }

  /** Sesion abierta actual con su arqueo (o `null`). */
  findCurrentSession(companyId: string): Promise<CashSessionWithRelations | null> {
    return this.prisma.cashSession.findFirst({
      where: { status: CashSessionStatus.OPEN, ...tenantWhere(companyId) },
      include: SESSION_INCLUDE,
      orderBy: { openedAt: 'desc' },
    });
  }

  /** Sesion por id con su arqueo (el servicio valida la existencia). */
  findSessionById(companyId: string, id: string) {
    return this.prisma.cashSession.findFirst({
      where: { id, ...tenantWhere(companyId) },
      include: SESSION_INCLUDE,
    });
  }

  /** Pagina de sesiones con los conteos de movimientos y pedidos. */
  async findSessionPage(companyId: string, query: CashSessionQueryDto) {
    const where = this.sessionWhere(companyId, query);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.cashSession.findMany({
        where,
        include: SESSION_LIST_INCLUDE,
        orderBy: query.toOrderBy(['openedAt', 'closedAt'], { openedAt: 'desc' }),
        skip: toSkip(query.page, query.limit),
        take: query.limit,
      }),
      this.prisma.cashSession.count({ where }),
    ]);

    return { items, total };
  }

  /** Pagina de movimientos de caja con su usuario y su sesion. */
  async findMovementPage(companyId: string, query: CashMovementQueryDto) {
    const where = this.movementWhere(companyId, query);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.cashMovement.findMany({
        where,
        include: MOVEMENT_LIST_INCLUDE,
        orderBy: query.toOrderBy(['createdAt', 'amount'], { createdAt: 'desc' }),
        skip: toSkip(query.page, query.limit),
        take: query.limit,
      }),
      this.prisma.cashMovement.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * Sesion OPEN de la empresa (o la del usuario cuando `openedById` viene).
   * Evita dobles aperturas dentro de la transaccion.
   */
  findOpenSession(
    companyId: string,
    options: { openedById?: string } = {},
    tx?: PrismaClientLike,
  ) {
    return this.client(tx).cashSession.findFirst({
      where: {
        status: CashSessionStatus.OPEN,
        ...(options.openedById ? { openedById: options.openedById } : {}),
        ...tenantWhere(companyId),
      },
    });
  }

  /** Cantidad de cajas abiertas hoy (secuencia del codigo CJ-YYYYMMDD-NNNN). */
  countToday(companyId: string, tx?: PrismaClientLike) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return this.client(tx).cashSession.count({
      where: { openedAt: { gte: startOfDay }, ...tenantWhere(companyId) },
    });
  }

  /** Crea la sesion y devuelve su arqueo completo. */
  createSession(
    data: Prisma.CashSessionUncheckedCreateInput,
    tx?: PrismaClientLike,
  ): Promise<CashSessionWithRelations> {
    return this.client(tx).cashSession.create({
      data,
      include: SESSION_INCLUDE,
    });
  }

  /** Sesion abierta con sus movimientos (base del arqueo de cierre). */
  findOpenSessionWithMovements(companyId: string, tx: PrismaClientLike) {
    return tx.cashSession.findFirst({
      where: { status: CashSessionStatus.OPEN, ...tenantWhere(companyId) },
      include: { movements: true },
      orderBy: { openedAt: 'desc' },
    });
  }

  /**
   * Cierra la sesion solo si sigue abierta: el filtro por estado hace el cierre
   * atomico (evita doble cierre).
   */
  closeSession(
    companyId: string,
    id: string,
    data: Prisma.CashSessionUncheckedUpdateManyInput,
    tx: PrismaClientLike,
  ) {
    return tx.cashSession.updateMany({
      where: {
        id,
        status: CashSessionStatus.OPEN,
        ...tenantWhere(companyId),
      },
      data,
    });
  }

  /** Sesion ya cerrada con su arqueo (lectura posterior al cierre). */
  findSessionOrThrow(
    companyId: string,
    id: string,
    tx: PrismaClientLike,
  ): Promise<CashSessionWithRelations> {
    return tx.cashSession.findUniqueOrThrow({
      where: { id, ...tenantWhere(companyId) },
      include: SESSION_INCLUDE,
    });
  }


  /** Pedidos con propina referenciados por los movimientos recibidos. */
  findOrdersWithTips(
    companyId: string,
    orderIds: string[],
  ): Promise<CashOrderTips[]> {
    return this.prisma.order.findMany({
      where: {
        id: { in: orderIds },
        // Sin propina no hay nada que separar.
        tip: { gt: 0 },
        ...tenantWhere(companyId),
      },
      select: ORDER_TIPS_SELECT,
    });
  }

  /** Sesion destino de un movimiento (id, codigo y estado). */
  findSessionForMovement(
    companyId: string,
    sessionId: string,
    tx?: PrismaClientLike,
  ) {
    return this.client(tx).cashSession.findFirst({
      where: { id: sessionId, ...tenantWhere(companyId) },
      select: { id: true, code: true, status: true },
    });
  }

  /** Registra el movimiento en la sesion de caja (append-only). */
  createMovement(
    data: Prisma.CashMovementUncheckedCreateInput,
    tx?: PrismaClientLike,
  ) {
    return this.client(tx).cashMovement.create({ data });
  }

  private sessionWhere(
    companyId: string,
    query: CashSessionQueryDto,
  ): Prisma.CashSessionWhereInput {
    const dateFilter = buildDateRange(query.from, query.to);

    return {
      ...tenantWhere(companyId),
      ...(query.status ? { status: query.status } : {}),
      // El rango (opcional) se aplica sobre la apertura: las cajas que se
      // abrieron dentro del periodo pedido.
      ...(query.from || query.to ? { openedAt: dateFilter } : {}),
    };
  }

  private movementWhere(
    companyId: string,
    query: CashMovementQueryDto,
  ): Prisma.CashMovementWhereInput {
    const dateFilter = buildDateRange(query.from, query.to);

    return {
      ...tenantWhere(companyId),
      ...(query.sessionId ? { sessionId: query.sessionId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.paymentMethod ? { paymentMethod: query.paymentMethod } : {}),
      ...(query.currency
        ? { currency: normalizeCurrencyCode(query.currency) }
        : {}),
      ...(query.from || query.to ? { createdAt: dateFilter } : {}),
    };
  }
}
