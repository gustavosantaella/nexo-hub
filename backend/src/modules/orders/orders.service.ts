import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  CashMovementCategory,
  CashMovementType,
  OrderStatus,
  OrderType,
  PaymentStatus,
  StockMovementType,
  StockReferenceType,
  type OrderStatus as OrderStatusT,
} from '../../common/constants/enums';
import { buildCode } from '../../common/utils/code.util';
import { buildDateRange } from '../../common/utils/date.util';
import {
  compareMoney,
  fitToBalance,
  money,
  toCents,
  toMoney,
} from '../../common/utils/money.util';
import { normalizeNullableId } from '../../common/utils/normalize.util';
import {
  buildPaginatedResult,
  toSkip,
} from '../../common/utils/pagination.util';
import { tenantWhere } from '../../common/utils/tenant.util';
import { PrismaService, type PrismaClientLike } from '../../prisma/prisma.service';
import { CashService } from '../cash/cash.service';
import { InventoryService } from '../inventory/inventory.service';
import { RatesService } from '../rates/rates.service';
import {
  AddOrderItemsDto,
  AddOrderPaymentDto,
  CreateOrderDto,
  OrderItemDto,
  UpdateOrderDto,
  UpdateOrderItemDto,
} from './dto/order.dto';
import { OrderQueryDto, UpdateOrderStatusDto } from './dto/order-query.dto';

const ORDER_LIST_INCLUDE = {
  customer: { select: { id: true, name: true, phone: true } },
  createdBy: { select: { id: true, name: true } },
  _count: { select: { items: true, payments: true } },
} satisfies Prisma.OrderInclude;

const ORDER_DETAIL_INCLUDE = {
  customer: { select: { id: true, name: true, phone: true, docNumber: true } },
  createdBy: { select: { id: true, name: true } },
  cashSession: { select: { id: true, code: true, status: true } },
  items: true,
  payments: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.OrderInclude;

type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true } }>;

/** Maquina de estados del pedido. Estados terminales: COMPLETED / CANCELLED. */
const ORDER_TRANSITIONS: Record<string, OrderStatusT[]> = {
  [OrderStatus.PENDING]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
  [OrderStatus.PREPARING]: [OrderStatus.READY, OrderStatus.CANCELLED],
  [OrderStatus.READY]: [OrderStatus.COMPLETED, OrderStatus.CANCELLED],
  [OrderStatus.COMPLETED]: [],
  [OrderStatus.CANCELLED]: [],
};

export interface OrderTotals {
  subtotal: number;
  discount: number;
  tax: number;
  tip: number;
  total: number;
}

/** Item resuelto: nombre y precio congelados (snapshot) + control de stock. */
interface ResolvedOrderItem {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
  trackStock: boolean;
}

/**
 * Linea final de un pedido al agregar productos.
 * Una linea por `productId` + `unitPrice`: los productos repetidos se suman en
 * una sola linea en vez de crear filas nuevas.
 */
interface MergedOrderLine {
  /** `id` del item existente que se actualiza (ausente si la linea es nueva). */
  itemId?: string;
  /** Items existentes duplicados que se consolidan en esta linea y se borran. */
  removeIds: string[];
  /** Cantidad que la linea tenia guardada (0 si la linea es nueva). */
  originalQuantity: number;
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

/**
 * Calculo unico de totales de un pedido: descuento + IGV sobre el neto y la
 * propina al final (la propina NO paga IGV).
 */
export function computeOrderTotals(input: {
  items: { quantity: number; unitPrice: number }[];
  discount?: number;
  taxRate?: number;
  tip?: number;
}): OrderTotals {
  const subtotal = money.sum(
    input.items.map((i) => money.mul(i.unitPrice, i.quantity)),
  );
  const discount = Math.min(toMoney(input.discount ?? 0), subtotal);
  const taxable = money.sub(subtotal, discount);
  const tax = money.mul(taxable, toMoney(input.taxRate ?? 0) / 100);
  const tip = toMoney(input.tip ?? 0);
  return {
    subtotal,
    discount,
    tax,
    tip,
    total: money.add(money.add(taxable, tax), tip),
  };
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly cash: CashService,
    private readonly rates: RatesService,
  ) {}

  /** Crea el pedido, descuenta stock y guarda el snapshot de precios. */
  async create(companyId: string, dto: CreateOrderDto, userId: string) {
    const items = await this.resolveItems(companyId, dto.items);

    const totals = computeOrderTotals({
      items,
      discount: dto.discount,
      taxRate: dto.taxRate,
      tip: dto.tip,
    });

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          companyId,
          code: await this.nextCode(companyId, tx),
          customerId: normalizeNullableId(dto.customerId),
          type: dto.type ?? OrderType.DINE_IN,
          status: OrderStatus.PENDING,
          tableNumber: dto.tableNumber,
          notes: dto.notes,
          subtotal: totals.subtotal,
          discount: totals.discount,
          tax: totals.tax,
          tip: totals.tip,
          total: totals.total,
          createdById: userId,
          items: {
            create: items.map((item) => ({
              companyId,
              productId: item.productId,
              name: item.name,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              total: item.total,
            })),
          },
        },
        include: ORDER_DETAIL_INCLUDE,
      });

      // El stock se consume al registrar la venta (trazable con referenceId).
      for (const item of items) {
        if (!item.trackStock) continue;
        await this.inventory.applyMovement(
          companyId,
          {
            productId: item.productId,
            type: StockMovementType.OUT,
            quantity: item.quantity,
            reason: `Pedido ${order.code}`,
            referenceType: StockReferenceType.ORDER,
            referenceId: order.id,
            createdById: userId,
          },
          tx,
        );
      }

      return order;
    });
  }

  /**
   * Agrega items a un pedido existente ("seguir agregando productos").
   *
   * Descuenta el stock de los productos nuevos y recalcula los totales sobre
   * TODAS las lineas resultantes (las que ya estaban mas las nuevas),
   * conservando el descuento y el IGV aplicados al pedido. No se permite en
   * pedidos terminales (COMPLETED / CANCELLED).
   *
   * Los productos repetidos se fusionan: si el producto ya esta en el pedido
   * (al mismo precio) se suma la cantidad a esa linea en vez de crear una
   * segunda; si el precio unitario es distinto se conserva una linea aparte
   * para no alterar importes ya registrados.
   */
  async addItems(
    companyId: string,
    id: string,
    dto: AddOrderItemsDto,
    userId: string,
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id, ...tenantWhere(companyId) },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    if (
      order.status === OrderStatus.COMPLETED ||
      order.status === OrderStatus.CANCELLED
    ) {
      throw new BadRequestException(
        order.status === OrderStatus.CANCELLED
          ? 'No se pueden agregar productos a un pedido cancelado'
          : 'No se pueden agregar productos a un pedido completado',
      );
    }

    const newItems = await this.resolveItems(companyId, dto.items);
    const lines = this.mergeLines(order.items, newItems);

    const totals = computeOrderTotals({
      items: lines,
      discount: order.discount,
      taxRate: this.effectiveTaxRate(order),
      tip: order.tip,
    });

    if (compareMoney(totals.total, order.paidAmount) < 0) {
      throw new BadRequestException(
        'El nuevo total no puede ser menor a lo ya pagado por el cliente',
      );
    }

    const paymentStatus =
      order.paidAmount <= 0
        ? PaymentStatus.UNPAID
        : compareMoney(order.paidAmount, totals.total) >= 0
          ? PaymentStatus.PAID
          : PaymentStatus.PARTIAL;

    const toCreate = lines.filter((line) => !line.itemId);
    const toUpdate = lines.filter(
      (line): line is MergedOrderLine & { itemId: string } =>
        !!line.itemId && line.quantity !== line.originalQuantity,
    );
    const toDelete = lines.flatMap((line) => line.removeIds);

    // Salida de stock: una sola por producto, sumando las cantidades repetidas.
    const stockOut = new Map<string, number>();
    for (const item of newItems) {
      if (!item.trackStock) continue;
      stockOut.set(
        item.productId,
        (stockOut.get(item.productId) ?? 0) + item.quantity,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id, ...tenantWhere(companyId) },
        data: {
          ...totals,
          paymentStatus,
          items: {
            ...(toCreate.length > 0
              ? {
                  create: toCreate.map((line) => ({
                    companyId,
                    productId: line.productId,
                    name: line.name,
                    quantity: line.quantity,
                    unitPrice: line.unitPrice,
                    total: line.total,
                  })),
                }
              : {}),
            ...(toUpdate.length > 0
              ? {
                  update: toUpdate.map((line) => ({
                    where: { id: line.itemId },
                    data: { quantity: line.quantity, total: line.total },
                  })),
                }
              : {}),
            ...(toDelete.length > 0
              ? { deleteMany: toDelete.map((itemId) => ({ id: itemId })) }
              : {}),
          },
        },
        include: ORDER_DETAIL_INCLUDE,
      });

      // El stock de los productos agregados se consume igual que al crear.
      for (const [productId, quantity] of stockOut) {
        await this.inventory.applyMovement(
          companyId,
          {
            productId,
            type: StockMovementType.OUT,
            quantity,
            reason: `Pedido ${order.code}`,
            referenceType: StockReferenceType.ORDER,
            referenceId: order.id,
            createdById: userId,
          },
          tx,
        );
      }

      return updated;
    });
  }

  /**
   * Corrige la cantidad de un producto ya cargado en el pedido (error de
   * captura). El stock se ajusta por la diferencia: si la cantidad sube se
   * consume lo agregado, si baja se devuelve lo quitado.
   */
  async updateItem(
    companyId: string,
    id: string,
    itemId: string,
    dto: UpdateOrderItemDto,
    userId: string,
  ) {
    const order = await this.loadEditableOrder(companyId, id);
    const item = this.findItem(order, itemId);

    // Nada que hacer: la cantidad pedida es la que ya tiene la linea.
    if (item.quantity === dto.quantity) return this.findOne(companyId, id);

    const delta = dto.quantity - item.quantity;
    const lines = order.items.map((line) =>
      line.id === itemId
        ? {
            ...line,
            quantity: dto.quantity,
            total: money.mul(line.unitPrice, dto.quantity),
          }
        : line,
    );

    return this.applyItemChange(
      companyId,
      order,
      lines,
      [
        {
          productId: item.productId,
          type: delta > 0 ? StockMovementType.OUT : StockMovementType.IN,
          quantity: Math.abs(delta),
          reason:
            delta > 0
              ? `Pedido ${order.code}`
              : `Devolucion por corregir la cantidad del pedido ${order.code}`,
        },
      ],
      userId,
    );
  }

  /**
   * Quita un producto del pedido (se cargo por error) devolviendo su cantidad
   * al inventario. El pedido conserva siempre al menos una linea: para dejar
   * el pedido vacio hay que cancelarlo.
   */
  async removeItem(
    companyId: string,
    id: string,
    itemId: string,
    userId: string,
  ) {
    const order = await this.loadEditableOrder(companyId, id);
    const item = this.findItem(order, itemId);

    if (order.items.length <= 1) {
      throw new BadRequestException(
        'El pedido debe conservar al menos un producto. Si no lo vas a usar, cancelalo.',
      );
    }

    const lines = order.items.filter((line) => line.id !== itemId);

    return this.applyItemChange(
      companyId,
      order,
      lines,
      [
        {
          productId: item.productId,
          type: StockMovementType.IN,
          quantity: item.quantity,
          reason: `Devolucion por quitar un producto del pedido ${order.code}`,
        },
      ],
      userId,
    );
  }

  /**
   * Arma las lineas finales del pedido fusionando los productos repetidos.
   *
   * La clave de fusion es `productId` + `unitPrice` (en centavos, para comparar
   * con exactitud): el mismo producto al mismo precio ocupa una sola linea con
   * las cantidades sumadas. Tambien recorre las lineas existentes, por lo que
   * consolida duplicados previos (esas filas vuelven en `removeIds` para
   * borrarlas y que los totales sigan cuadrando con la base).
   */
  private mergeLines(
    existing: OrderWithItems['items'],
    added: ResolvedOrderItem[],
  ): MergedOrderLine[] {
    const lines = new Map<string, MergedOrderLine>();
    const keyOf = (productId: string, unitPrice: number) =>
      `${productId}|${toCents(unitPrice)}`;

    for (const item of existing) {
      const key = keyOf(item.productId, item.unitPrice);
      const current = lines.get(key);
      if (!current) {
        lines.set(key, {
          itemId: item.id,
          removeIds: [],
          originalQuantity: item.quantity,
          productId: item.productId,
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.total,
        });
        continue;
      }
      // Fila duplicada del mismo producto y precio: se consolida en la primera.
      current.quantity += item.quantity;
      current.total = money.mul(current.unitPrice, current.quantity);
      current.removeIds.push(item.id);
    }

    for (const item of added) {
      const key = keyOf(item.productId, item.unitPrice);
      const current = lines.get(key);
      if (!current) {
        lines.set(key, {
          removeIds: [],
          originalQuantity: 0,
          productId: item.productId,
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.total,
        });
        continue;
      }
      // El producto ya estaba en el pedido: se suma la cantidad.
      current.quantity += item.quantity;
      current.total = money.mul(current.unitPrice, current.quantity);
    }

    return [...lines.values()];
  }

  /**
   * Valida los productos de las lineas y arma los items con el snapshot de
   * nombre y precio. Se usa al crear el pedido y al agregar mas productos.
   */
  private async resolveItems(
    companyId: string,
    lines: OrderItemDto[],
  ): Promise<ResolvedOrderItem[]> {
    const productIds = [...new Set(lines.map((i) => i.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, ...tenantWhere(companyId) },
      select: { id: true, name: true, price: true, active: true, trackStock: true },
    });

    if (products.length !== productIds.length) {
      const found = new Set(products.map((p) => p.id));
      const missing = productIds.filter((id) => !found.has(id));
      throw new BadRequestException(
        `Producto(s) no encontrado(s): ${missing.join(', ')}`,
      );
    }

    const byId = new Map(products.map((p) => [p.id, p]));
    return lines.map((line) => {
      const product = byId.get(line.productId)!;
      if (!product.active) {
        throw new BadRequestException(
          `El producto "${product.name}" esta inactivo y no puede venderse`,
        );
      }
      const unitPrice = toMoney(line.unitPrice ?? product.price);
      return {
        productId: product.id,
        name: product.name,
        quantity: line.quantity,
        unitPrice,
        total: money.mul(unitPrice, line.quantity),
        trackStock: product.trackStock,
      };
    });
  }

  /** Tasa de IGV efectiva guardada en el pedido (para recalcular el impuesto). */
  private effectiveTaxRate(order: {
    subtotal: number;
    discount: number;
    tax: number;
  }): number {
    const taxable = money.sub(order.subtotal, order.discount);
    return taxable > 0 ? (order.tax / taxable) * 100 : 0;
  }

  // =========================================================================
  //  CONSULTAS
  // =========================================================================

  async findAll(companyId: string, query: OrderQueryDto) {
    const dateFilter = buildDateRange(query.from, query.to);

    const where: Prisma.OrderWhereInput = {
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
              { tableNumber: { contains: query.search } },
              { customer: { name: { contains: query.search } } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: ORDER_LIST_INCLUDE,
        orderBy: query.toOrderBy(['createdAt', 'total', 'code'], {
          createdAt: 'desc',
        }),
        skip: toSkip(query.page, query.limit),
        take: query.limit,
      }),
      this.prisma.order.count({ where }),
    ]);

    return buildPaginatedResult(items, total, query.page, query.limit);
  }

  /** Pedidos activos (no terminados) para el tablero operativo. */
  findActiveOrders(companyId: string) {
    return this.prisma.order.findMany({
      where: {
        ...tenantWhere(companyId),
        status: {
          in: [
            OrderStatus.PENDING,
            OrderStatus.CONFIRMED,
            OrderStatus.PREPARING,
            OrderStatus.READY,
          ],
        },
      },
      include: ORDER_LIST_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(companyId: string, id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, ...tenantWhere(companyId) },
      include: ORDER_DETAIL_INCLUDE,
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    return order;
  }

  /** Actualiza datos editables y recalcula totales sobre los items existentes. */
  async update(companyId: string, id: string, dto: UpdateOrderDto) {
    const order = await this.prisma.order.findFirst({
      where: { id, ...tenantWhere(companyId) },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('No se puede editar un pedido cancelado');
    }

    const totals = computeOrderTotals({
      items: order.items,
      discount: dto.discount ?? order.discount,
      taxRate: dto.taxRate ?? this.effectiveTaxRate(order),
      tip: dto.tip ?? order.tip,
    });

    if (compareMoney(totals.total, order.paidAmount) < 0) {
      throw new BadRequestException(
        'El nuevo total no puede ser menor a lo ya pagado por el cliente',
      );
    }

    const paymentStatus =
      order.paidAmount <= 0
        ? PaymentStatus.UNPAID
        : compareMoney(order.paidAmount, totals.total) >= 0
          ? PaymentStatus.PAID
          : PaymentStatus.PARTIAL;

    return this.prisma.order.update({
      where: { id, ...tenantWhere(companyId) },
      data: {
        ...(dto.customerId !== undefined
          ? { customerId: normalizeNullableId(dto.customerId) }
          : {}),
        ...(dto.tableNumber !== undefined ? { tableNumber: dto.tableNumber } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...totals,
        paymentStatus,
      },
      include: ORDER_DETAIL_INCLUDE,
    });
  }

  // =========================================================================
  //  COBROS (integracion con CAJA)
  // =========================================================================

  /**
   * Registra un cobro del pedido. En una sola transaccion:
   *   1. valida saldo pendiente y que exista una caja abierta
   *   2. crea el CashMovement (ingreso por venta, con el metodo elegido)
   *   3. crea el OrderPayment apuntando al movimiento
   *   4. actualiza paidAmount / paymentStatus / cashSessionId
   */
  async addPayment(
    companyId: string,
    orderId: string,
    dto: AddOrderPaymentDto,
    userId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, ...tenantWhere(companyId) },
      });
      if (!order) throw new NotFoundException('Pedido no encontrado');
      if (order.status === OrderStatus.CANCELLED) {
        throw new BadRequestException('No se puede cobrar un pedido cancelado');
      }

      const balance = money.sub(order.total, order.paidAmount);
      if (compareMoney(balance, 0) <= 0) {
        throw new BadRequestException('El pedido ya esta pagado en su totalidad');
      }

      // `amount` viene en la moneda del pago; el saldo del pedido esta en la
      // moneda base (USD), por eso se compara con el equivalente convertido.
      const amount = toMoney(dto.amount);
      const conversion = await this.rates.resolvePayment(
        companyId,
        amount,
        dto.currency,
      );
      const { currency, exchangeRate } = conversion;

      // Se ajusta al saldo cuando el exceso es solo el redondeo de convertir a
      // otra moneda (ej. pagar el total en bolivares).
      const baseAmount = fitToBalance(conversion.baseAmount, balance);
      if (baseAmount === null) {
        throw new BadRequestException(
          `El monto (${conversion.baseAmount} USD) excede el saldo pendiente (${balance} USD)`,
        );
      }

      // Toda venta debe poder asociarse a una sesion de caja abierta.
      const session = await this.cash.getOpenSessionOrThrow(companyId, tx);

      const movement = await this.cash.registerMovement(
        companyId,
        {
          sessionId: session.id,
          type: CashMovementType.IN,
          category: CashMovementCategory.SALE,
          paymentMethod: dto.method,
          amount,
          currency,
          baseAmount,
          description: `Cobro pedido ${order.code}`,
          referenceType: 'ORDER',
          referenceId: order.id,
          createdById: userId,
        },
        tx,
      );

      await tx.orderPayment.create({
        data: {
          companyId,
          orderId: order.id,
          amount,
          method: dto.method,
          currency,
          exchangeRate,
          baseAmount,
          cashMovementId: movement.id,
          note: dto.note,
          createdById: userId,
        },
      });

      const paidAmount = money.add(order.paidAmount, baseAmount);
      const paymentStatus =
        compareMoney(paidAmount, order.total) >= 0
          ? PaymentStatus.PAID
          : PaymentStatus.PARTIAL;

      return tx.order.update({
        where: { id: order.id, ...tenantWhere(companyId) },
        data: {
          paidAmount,
          paymentStatus,
          cashSessionId: session.id,
          ...(paymentStatus === PaymentStatus.PAID &&
          order.status !== OrderStatus.COMPLETED
            ? { status: OrderStatus.COMPLETED }
            : {}),
        },
        include: ORDER_DETAIL_INCLUDE,
      });
    });
  }

  // =========================================================================
  //  ESTADOS / CANCELACION
  // =========================================================================

  /** Cambia el estado respetando la maquina de estados. */
  async updateStatus(
    companyId: string,
    id: string,
    dto: UpdateOrderStatusDto,
    userId: string,
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id, ...tenantWhere(companyId) },
      include: { items: true, _count: { select: { payments: true } } },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');

    if (order.status === dto.status) return this.findOne(companyId, id);

    const allowed = ORDER_TRANSITIONS[order.status] ?? [];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Transicion invalida: ${order.status} -> ${dto.status}`,
      );
    }

    if (dto.status === OrderStatus.CANCELLED) {
      if (order._count.payments > 0) {
        throw new BadRequestException(
          'El pedido tiene pagos registrados. Registra la devolucion (REFUND) en caja antes de cancelarlo.',
        );
      }
      return this.restockAndSetCancelled(companyId, order, userId);
    }

    return this.prisma.order.update({
      where: { id, ...tenantWhere(companyId) },
      data: { status: dto.status },
      include: ORDER_DETAIL_INCLUDE,
    });
  }

  /** Elimina un pedido sin pagos, devolviendo el stock consumido. */
  async remove(companyId: string, id: string, userId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, ...tenantWhere(companyId) },
      include: { items: true, _count: { select: { payments: true } } },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    if (order._count.payments > 0) {
      throw new BadRequestException(
        'No se puede eliminar un pedido con pagos registrados',
      );
    }
    if (order.status === OrderStatus.COMPLETED) {
      throw new BadRequestException('No se puede eliminar un pedido completado');
    }

    await this.prisma.$transaction(async (tx) => {
      if (order.status !== OrderStatus.CANCELLED) {
        await this.restockItems(companyId, tx, order, userId);
      }
      await tx.order.delete({ where: { id, ...tenantWhere(companyId) } });
    });

    return { id, deleted: true };
  }

  /**
   * Cancela el pedido y devuelve el stock. El `updateMany` condicionado por
   * estado garantiza que la devolucion de stock ocurra exactamente una vez.
   */
  private async restockAndSetCancelled(
    companyId: string,
    order: OrderWithItems,
    userId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const guard = await tx.order.updateMany({
        where: {
          id: order.id,
          ...tenantWhere(companyId),
          status: { not: OrderStatus.CANCELLED },
        },
        data: { status: OrderStatus.CANCELLED },
      });
      if (guard.count === 0) {
        throw new ConflictException('El pedido ya estaba cancelado');
      }

      await this.restockItems(companyId, tx, order, userId);

      return tx.order.findUniqueOrThrow({
        where: { id: order.id },
        include: ORDER_DETAIL_INCLUDE,
      });
    });
  }

  /** Devuelve al inventario los items de productos con control de stock. */
  private async restockItems(
    companyId: string,
    tx: PrismaClientLike,
    order: OrderWithItems,
    userId: string,
  ) {
    const products = await tx.product.findMany({
      where: {
        id: { in: order.items.map((i) => i.productId) },
        ...tenantWhere(companyId),
      },
      select: { id: true, trackStock: true },
    });
    const tracked = new Set(
      products.filter((p) => p.trackStock).map((p) => p.id),
    );

    for (const item of order.items) {
      if (!tracked.has(item.productId)) continue;
      await this.inventory.applyMovement(
        companyId,
        {
          productId: item.productId,
          type: StockMovementType.IN,
          quantity: item.quantity,
          reason: `Devolucion por cancelacion del pedido ${order.code}`,
          referenceType: StockReferenceType.ORDER,
          referenceId: order.id,
          createdById: userId,
        },
        tx,
      );
    }
  }

  /**
   * Pedido con items que todavia admite cambios en sus productos. Rechaza los
   * estados terminales, igual que "agregar productos".
   */
  private async loadEditableOrder(
    companyId: string,
    id: string,
  ): Promise<OrderWithItems> {
    const order = await this.prisma.order.findFirst({
      where: { id, ...tenantWhere(companyId) },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    if (
      order.status === OrderStatus.COMPLETED ||
      order.status === OrderStatus.CANCELLED
    ) {
      throw new BadRequestException(
        order.status === OrderStatus.CANCELLED
          ? 'No se pueden modificar los productos de un pedido cancelado'
          : 'No se pueden modificar los productos de un pedido completado',
      );
    }
    return order;
  }

  /** Linea del pedido por id (404 si el producto no esta en ese pedido). */
  private findItem(order: OrderWithItems, itemId: string) {
    const item = order.items.find((line) => line.id === itemId);
    if (!item) {
      throw new NotFoundException('El producto no esta en este pedido');
    }
    return item;
  }

  /**
   * Persiste un cambio en las lineas de un pedido existente (corregir la
   * cantidad o quitar productos): recalcula los totales conservando el
   * descuento y el IGV del pedido, valida que el nuevo total no quede por
   * debajo de lo ya pagado, aplica los movimientos de stock indicados y
   * devuelve el detalle actualizado, todo en una sola transaccion.
   */
  private async applyItemChange(
    companyId: string,
    order: OrderWithItems,
    lines: OrderWithItems['items'],
    movements: {
      productId: string;
      type: StockMovementType;
      quantity: number;
      reason: string;
    }[],
    userId: string,
  ) {
    const totals = computeOrderTotals({
      items: lines,
      discount: order.discount,
      taxRate: this.effectiveTaxRate(order),
      tip: order.tip,
    });

    if (compareMoney(totals.total, order.paidAmount) < 0) {
      throw new BadRequestException(
        'El nuevo total no puede ser menor a lo ya pagado por el cliente. Registra la devolucion (REFUND) en caja.',
      );
    }

    const paymentStatus =
      order.paidAmount <= 0
        ? PaymentStatus.UNPAID
        : compareMoney(order.paidAmount, totals.total) >= 0
          ? PaymentStatus.PAID
          : PaymentStatus.PARTIAL;

    // Solo se escriben las lineas que cambiaron de cantidad y las que salen.
    const previous = new Map(order.items.map((line) => [line.id, line]));
    const changed = lines.filter(
      (line) => line.quantity !== previous.get(line.id)?.quantity,
    );
    const removedIds = order.items
      .filter((line) => !lines.some((current) => current.id === line.id))
      .map((line) => line.id);

    const tracked = await this.trackedProductIds(
      companyId,
      movements.map((movement) => movement.productId),
    );

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id: order.id, ...tenantWhere(companyId) },
        data: {
          ...totals,
          paymentStatus,
          items: {
            ...(changed.length > 0
              ? {
                  update: changed.map((line) => ({
                    where: { id: line.id },
                    data: {
                      quantity: line.quantity,
                      total: money.mul(line.unitPrice, line.quantity),
                    },
                  })),
                }
              : {}),
            ...(removedIds.length > 0
              ? { deleteMany: removedIds.map((itemId) => ({ id: itemId })) }
              : {}),
          },
        },
        include: ORDER_DETAIL_INCLUDE,
      });

      // El stock se mueve solo para productos con control de inventario.
      for (const movement of movements) {
        if (movement.quantity <= 0) continue;
        if (!tracked.has(movement.productId)) continue;
        await this.inventory.applyMovement(
          companyId,
          {
            productId: movement.productId,
            type: movement.type,
            quantity: movement.quantity,
            reason: movement.reason,
            referenceType: StockReferenceType.ORDER,
            referenceId: order.id,
            createdById: userId,
          },
          tx,
        );
      }

      return updated;
    });
  }

  /** Ids de los productos que llevan control de inventario. */
  private async trackedProductIds(
    companyId: string,
    productIds: string[],
  ): Promise<Set<string>> {
    const unique = [...new Set(productIds)];
    if (unique.length === 0) return new Set();
    const products = await this.prisma.product.findMany({
      where: { id: { in: unique }, ...tenantWhere(companyId) },
      select: { id: true, trackStock: true },
    });
    return new Set(
      products
        .filter((product) => product.trackStock)
        .map((product) => product.id),
    );
  }

  /** Siguiente codigo secuencial del dia: PED-YYYYMMDD-NNNN (por empresa). */
  private async nextCode(
    companyId: string,
    tx: PrismaClientLike,
  ): Promise<string> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const count = await tx.order.count({
      where: { createdAt: { gte: startOfDay }, ...tenantWhere(companyId) },
    });
    return buildCode('PED', count + 1);
  }
}

