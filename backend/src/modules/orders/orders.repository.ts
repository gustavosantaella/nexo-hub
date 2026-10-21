import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { OrderStatus } from '../../common/constants/enums';
import { buildDateRange } from '../../common/utils/date.util';
import { tenantWhere } from '../../common/utils/tenant.util';
import { PrismaService, type PrismaClientLike } from '../../prisma/prisma.service';
import { OrderQueryDto } from './dto/order-query.dto';

const ORDER_LIST_INCLUDE = {
  customer: { select: { id: true, name: true, phone: true } },
  createdBy: { select: { id: true, name: true } },
  _count: { select: { items: true, payments: true } },
} satisfies Prisma.OrderInclude;

export const ORDER_DETAIL_INCLUDE = {
  customer: { select: { id: true, name: true, phone: true, docNumber: true } },
  createdBy: { select: { id: true, name: true } },
  cashSession: { select: { id: true, code: true, status: true } },
  items: true,
  payments: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.OrderInclude;

/**
 * Pedidos activos del tablero operativo (cocina/salon y mapa de mesas del POS).
 * Ademas del resumen trae las lineas del pedido: el cajero necesita ver los
 * productos ya cargados en la mesa al entrar a agregar o cobrar.
 */
const ORDER_ACTIVE_INCLUDE = {
  ...ORDER_LIST_INCLUDE,
  items: true,
} satisfies Prisma.OrderInclude;

const ORDER_STATUS_INCLUDE = {
  items: true,
  _count: { select: { payments: true } },
} satisfies Prisma.OrderInclude;

export type OrderWithItems = Prisma.OrderGetPayload<{
  include: { items: true };
}>;

export type OrderStatusContext = Prisma.OrderGetPayload<{
  include: { items: true; _count: { select: { payments: true } } };
}>;

/**
 * Acceso a datos de pedidos. Toda consulta/escritura de Prisma del modulo vive
 * aqui: el servicio conserva validaciones y reglas de negocio, pero no conoce
 * el cliente de base de datos.
 */
@Injectable()
export class OrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(tx?: PrismaClientLike): PrismaClientLike {
    return tx ?? this.prisma;
  }

  /** Ejecuta una unidad de trabajo dentro de una transaccion de base de datos. */
  transaction<T>(work: (tx: PrismaClientLike) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => work(tx));
  }

  findWithItems(
    companyId: string,
    id: string,
    tx?: PrismaClientLike,
  ): Promise<OrderWithItems | null> {
    return this.client(tx).order.findFirst({
      where: { id, ...tenantWhere(companyId) },
      include: { items: true },
    });
  }

  findWithPayments(companyId: string, id: string) {
    return this.prisma.order.findFirst({
      where: { id, ...tenantWhere(companyId) },
      include: { items: true, _count: { select: { payments: true } } },
    });
  }

  findStatusContext(
    companyId: string,
    id: string,
  ): Promise<OrderStatusContext | null> {
    return this.prisma.order.findFirst({
      where: { id, ...tenantWhere(companyId) },
      include: ORDER_STATUS_INCLUDE,
    });
  }

  findDetail(companyId: string, id: string, tx?: PrismaClientLike) {
    return this.client(tx).order.findFirst({
      where: { id, ...tenantWhere(companyId) },
      include: ORDER_DETAIL_INCLUDE,
    });
  }


  findDetailById(id: string, tx: PrismaClientLike) {
    return tx.order.findUniqueOrThrow({
      where: { id },
      include: ORDER_DETAIL_INCLUDE,
    });
  }

  async findPage(companyId: string, query: OrderQueryDto) {
    const where = this.listWhere(companyId, query);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: ORDER_LIST_INCLUDE,
        orderBy: query.toOrderBy(['createdAt', 'total', 'code'], {
          createdAt: 'desc',
        }),
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.order.count({ where }),
    ]);

    return { items, total };
  }

  findActive(companyId: string) {
    return this.prisma.order.findMany({
      where: {
        ...tenantWhere(companyId),
        status: {
          in: [
            OrderStatus.PENDING,
            OrderStatus.CONFIRMED,
            OrderStatus.PREPARING,
            OrderStatus.READY,
            OrderStatus.PROCESSING,
          ],
        },
      },
      include: ORDER_ACTIVE_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
  }

  create(data: Prisma.OrderUncheckedCreateInput, tx: PrismaClientLike) {
    return tx.order.create({
      data,
      include: ORDER_DETAIL_INCLUDE,
    });
  }

  update(
    companyId: string,
    id: string,
    data: Prisma.OrderUncheckedUpdateInput,
    tx?: PrismaClientLike,
  ) {
    return this.client(tx).order.update({
      where: { id, ...tenantWhere(companyId) },
      data,
      include: ORDER_DETAIL_INCLUDE,
    });
  }

  updateStatus(
    companyId: string,
    id: string,
    status: OrderStatus,
    tx?: PrismaClientLike,
  ) {
    return this.client(tx).order.update({
      where: { id, ...tenantWhere(companyId) },
      data: { status },
      include: ORDER_DETAIL_INCLUDE,
    });
  }

  /**
   * Marca el pedido como cancelado solo si aun no lo esta. El filtro por estado
   * hace que la devolucion de stock ocurra exactamente una vez.
   */
  markCancelled(companyId: string, id: string, tx: PrismaClientLike) {
    return tx.order.updateMany({
      where: {
        id,
        ...tenantWhere(companyId),
        status: { not: OrderStatus.CANCELLED },
      },
      data: { status: OrderStatus.CANCELLED },
    });
  }

  delete(companyId: string, id: string, tx: PrismaClientLike) {
    return tx.order.delete({ where: { id, ...tenantWhere(companyId) } });
  }

  /** Siguiente secuencia diaria usada para generar el codigo del pedido. */

  /** Siguiente secuencia diaria usada para generar el codigo del pedido. */
  countToday(companyId: string, tx: PrismaClientLike) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return tx.order.count({
      where: { createdAt: { gte: startOfDay }, ...tenantWhere(companyId) },
    });
  }

  createPayment(
    data: Prisma.OrderPaymentUncheckedCreateInput,
    tx: PrismaClientLike,
  ) {
    return tx.orderPayment.create({ data });
  }

  /** Pago ya aplicado por un trabajo de la cola (idempotencia). */
  findPaymentByKey(idempotencyKey: string, tx: PrismaClientLike) {
    return tx.orderPayment.findUnique({ where: { idempotencyKey } });
  }

  /**
   * Toma el pedido para cobro solo si sigue en el estado esperado. El filtro
   * evita que dos requests simultaneos encolen el mismo cobro dos veces.
   */
  markProcessing(
    companyId: string,
    id: string,
    expectedStatus: string,
    tx: PrismaClientLike,
  ) {
    return tx.order.updateMany({
      where: {
        id,
        ...tenantWhere(companyId),
        status: expectedStatus,
      },
      data: { status: OrderStatus.PROCESSING },
    });
  }

  /**
   * Devuelve el pedido a su estado anterior solo si sigue en PROCESSING. Si el
   * cobro ya lo completo (o alguien lo cambio), no se toca.
   */
  restoreStatusIfProcessing(
    companyId: string,
    id: string,
    status: string,
    tx?: PrismaClientLike,
  ) {
    return this.client(tx).order.updateMany({
      where: {
        id,
        ...tenantWhere(companyId),
        status: OrderStatus.PROCESSING,
      },
      data: { status },
    });
  }

  /** Productos vendibles (sueltos) del catalogo de la empresa. */
  findSaleProducts(
    companyId: string,
    productIds: string[],
    tx?: PrismaClientLike,
  ) {
    return this.client(tx).product.findMany({
      where: { id: { in: productIds }, ...tenantWhere(companyId) },
      select: { id: true, name: true, price: true, active: true },
    });
  }

  /** Ids de los productos que llevan control de inventario. */
  async findTrackedProductIds(
    companyId: string,
    productIds: string[],
    tx?: PrismaClientLike,
  ): Promise<string[]> {
    const unique = [...new Set(productIds)];
    if (unique.length === 0) return [];
    const products = await this.client(tx).product.findMany({
      where: { id: { in: unique }, ...tenantWhere(companyId) },
      select: { id: true, trackStock: true },
    });
    return products
      .filter((product) => product.trackStock)
      .map((product) => product.id);
  }

  private listWhere(
    companyId: string,
    query: OrderQueryDto,
  ): Prisma.OrderWhereInput {
    const dateFilter = buildDateRange(query.from, query.to);

    return {
      ...tenantWhere(companyId),
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.paymentStatus ? { paymentStatus: query.paymentStatus } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.cashSessionId ? { cashSessionId: query.cashSessionId } : {}),
      ...(query.from || query.to ? { createdAt: dateFilter } : {}),
      ...(query.search
        ? {
            OR: [
              { code: { contains: query.search } },
              { name: { contains: query.search } },
              { tableNumber: { contains: query.search } },
              { customer: { name: { contains: query.search } } },
            ],
          }
        : {}),
    };
  }
}

