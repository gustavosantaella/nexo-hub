import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  BASE_CURRENCY_CODE,
  normalizeCurrencyCode,
} from '../../common/constants/currencies';
import {
  CashMovementCategory,
  CashMovementType,
  OrderStatus,
  OrderType,
  PAYMENT_PROOF_METHODS,
  PaymentMethod,
  PaymentStatus,
  Role,
  StockMovementType,
  StockReferenceType,
  type OrderStatus as OrderStatusT,
} from '../../common/constants/enums';
import { buildCode } from '../../common/utils/code.util';
import {
  blendConsumption,
  parseConsumption,
  serializeConsumption,
  type ConsumptionPart,
} from '../../common/utils/consumption.util';
import {
  compareMoney,
  fitToBalance,
  fromCents,
  money,
  toCents,
  toMoney,
} from '../../common/utils/money.util';
import { normalizeNullableId } from '../../common/utils/normalize.util';
import { buildPaginatedResult } from '../../common/utils/pagination.util';
import { mulQty, sumQty } from '../../common/utils/quantity.util';
import type { PrismaClientLike } from '../../prisma/prisma.service';
import { CashService } from '../cash/cash.service';
import { InventoryService } from '../inventory/inventory.service';
import { MenusService, type MenuRecipe } from '../menus/menus.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  RatesService,
  normalizeRateKey,
  type RateHistory,
  type RateHistoryEntry,
} from '../rates/rates.service';
import {
  AddOrderItemsDto,
  AddOrderPaymentDto,
  CreateOrderDto,
  OrderItemDto,
  UpdateOrderDto,
  UpdateOrderItemDto,
} from './dto/order.dto';
import { OrderQueryDto, UpdateOrderStatusDto } from './dto/order-query.dto';
import {
  OrdersRepository,
  type OrderStatusContext,
  type OrderWithItems,
} from './orders.repository';

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
  /** Costo de delivery en USD (0 cuando el pedido no lo tiene). */
  deliveryFee: number;
  total: number;
}

/** Contexto de moneda con el que se cargo el costo de delivery de un pedido. */
export interface OrderDeliveryFee {
  /** Monto ya convertido a la moneda base (USD). */
  base: number;
  /** Lo que escribio el operador en `currency`. */
  entered: number;
  currency: string;
  /** Bolivares por 1 unidad de `currency` al momento de guardar. */
  rate: number | null;
  rateKey: string | null;
}

/**
 * Parte de un cobro o de un vuelto, ya resuelta con su tasa.
 *
 * `amount` esta en `currency` (lo que entrego/recibio el cliente) y
 * `baseAmount` es su equivalente en USD. Se guardan juntas en el JSON del pago
 * para poder auditar un cobro mixto aunque las tasas cambien despues.
 */
export interface PaymentBreakdownLine {
  method: PaymentMethod;
  currency: string;
  amount: number;
  exchangeRate: number | null;
  rateKey: string | null;
  baseAmount: number;
}

/** JSON de las partes del cobro/vuelto con el dinero en centavos. */
export function encodePaymentLines(
  lines: readonly PaymentBreakdownLine[],
): string | null {
  if (lines.length === 0) return null;
  return JSON.stringify(
    lines.map((line) => ({
      ...line,
      amount: toCents(line.amount),
      baseAmount: toCents(line.baseAmount),
    })),
  );
}

/** Lee el JSON de partes/vuelto y devuelve los montos en decimales. */
export function parsePaymentLines(raw: unknown): PaymentBreakdownLine[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map((item) => ({
        method: String(item.method ?? PaymentMethod.CASH) as PaymentMethod,
        currency: String(item.currency ?? BASE_CURRENCY_CODE),
        amount: fromCents(Number(item.amount) || 0),
        exchangeRate:
          item.exchangeRate === null || item.exchangeRate === undefined
            ? null
            : Number(item.exchangeRate),
        rateKey: item.rateKey ? String(item.rateKey) : null,
        baseAmount: fromCents(Number(item.baseAmount) || 0),
      }));
  } catch {
    return [];
  }
}

/** Item resuelto: nombre y precio congelados (snapshot) + consumo de inventario. */
interface ResolvedOrderItem {
  /** Producto suelto vendido (`null` si la linea es un menu). */
  productId: string | null;
  /** Menu vendido (`null` si la linea es un producto suelto). */
  menuId: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
  /**
   * Cuanto consume del inventario UNA unidad de esta linea, en la unidad de cada
   * producto: un producto se consume a si mismo (1) y un menu, su receta.
   */
  consumption: { productId: string; quantity: number }[];
}

/**
 * Linea final de un pedido al agregar productos.
 * Una linea por `productId` (o `menuId`) + `unitPrice`: los productos repetidos
 * se suman en una sola linea en vez de crear filas nuevas.
 */
interface MergedOrderLine {
  /** `id` del item existente que se actualiza (ausente si la linea es nueva). */
  itemId?: string;
  /** Items existentes duplicados que se consolidan en esta linea y se borran. */
  removeIds: string[];
  /** Cantidad que la linea tenia guardada (0 si la linea es nueva). */
  originalQuantity: number;
  productId: string | null;
  menuId: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
  /**
   * Consumo de inventario de UNA unidad de la linea, congelado al vender. Si el
   * menu ya estaba en el pedido, la cantidad nueva se pondera con el tramo
   * anterior para que la devolucion siga siendo exacta.
   */
  consumption: ConsumptionPart[] | null;
}

/**
 * Calculo unico de totales de un pedido: descuento + IGV sobre el neto y, al
 * final, la propina y el costo de delivery (ninguno de los dos paga IGV).
 */
export function computeOrderTotals(input: {
  items: { quantity: number; unitPrice: number }[];
  discount?: number;
  taxRate?: number;
  tip?: number;
  deliveryFee?: number;
}): OrderTotals {
  const subtotal = money.sum(
    input.items.map((i) => money.mul(i.unitPrice, i.quantity)),
  );
  const discount = Math.min(toMoney(input.discount ?? 0), subtotal);
  const taxable = money.sub(subtotal, discount);
  const tax = money.mul(taxable, toMoney(input.taxRate ?? 0) / 100);
  const tip = toMoney(input.tip ?? 0);
  const deliveryFee = toMoney(input.deliveryFee ?? 0);
  return {
    subtotal,
    discount,
    tax,
    tip,
    deliveryFee,
    total: money.add(money.add(taxable, tax), money.add(tip, deliveryFee)),
  };
}

/**
 * Serializa el HISTORIAL DE TASAS para guardarlo en la columna de texto del
 * cobro (`OrderPayment.ratesHistory`): SQLite no tiene columnas JSON, asi que la
 * foto de las tasas del dia viaja como JSON en texto y se lee con
 * `parseRatesHistory`.
 */
export function encodeRatesHistory(history: RateHistory): string {
  return JSON.stringify(history);
}

/**
 * Lee el historial de tasas guardado en un cobro.
 *
 * Tolera valores vacios o corruptos (devuelve `null` y nunca lanza) y descarta
 * las tasas que no reconoce: la lectura de un pedido viejo no puede romperse
 * porque su historial quedo a medias.
 */
export function parseRatesHistory(value: unknown): RateHistory | null {
  if (value === null || value === undefined) return null;

  let parsed: unknown = value;
  if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw) return null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const row = parsed as Record<string, unknown>;
  if (!Array.isArray(row.rates)) return null;

  const rates: RateHistoryEntry[] = [];
  for (const item of row.rates) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const key = normalizeRateKey(
      typeof entry.key === 'string' ? entry.key : null,
    );
    const rate = Number(entry.rate);
    if (!key || !Number.isFinite(rate) || rate <= 0) continue;
    rates.push({
      key,
      currency: entry.currency === 'EUR' ? 'EUR' : 'USD',
      source: entry.source === 'CUSTOM' ? 'CUSTOM' : 'BCV',
      rate,
      date: typeof entry.date === 'string' && entry.date ? entry.date : null,
    });
  }

  return {
    capturedAt: typeof row.capturedAt === 'string' ? row.capturedAt : '',
    bcvDate: typeof row.bcvDate === 'string' && row.bcvDate ? row.bcvDate : null,
    stale: row.stale === true,
    activeKey:
      normalizeRateKey(typeof row.activeKey === 'string' ? row.activeKey : null) ??
      'BCV_USD',
    rates,
  };
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly orders: OrdersRepository,
    private readonly inventory: InventoryService,
    private readonly cash: CashService,
    private readonly rates: RatesService,
    private readonly menus: MenusService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  /** Crea el pedido, descuenta stock y guarda el snapshot de precios. */
  async create(companyId: string, dto: CreateOrderDto, userId: string) {
    const items = await this.resolveItems(companyId, dto.items);
    const deliveryFee = await this.resolveDeliveryFee(companyId, {
      amount: dto.deliveryFee,
      currency: dto.deliveryFeeCurrency,
      rateKey: dto.deliveryFeeRateKey,
    });

    const totals = computeOrderTotals({
      items,
      discount: dto.discount,
      taxRate: dto.taxRate,
      tip: dto.tip,
      deliveryFee: deliveryFee?.base,
    });

    return this.orders.transaction(async (tx) => {
      const order = await this.orders.create(
        {
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
          ...this.deliveryFeeWrite(deliveryFee),
          total: totals.total,
          createdById: userId,
          items: {
            create: items.map((item) => ({
              companyId,
              productId: item.productId,
              menuId: item.menuId,
              name: item.name,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              total: item.total,
              // Consumo congelado: cancelar o corregir el pedido devuelve
              // exactamente lo descontado hoy, no lo que diga la receta despues.
              consumption: serializeConsumption(item.consumption),
            })),
          },
        },
        tx,
      );

      // El stock se consume al registrar la venta (trazable con referenceId).
      // Los menus se expanden a su receta: una sola salida por producto.
      await this.applyConsumption(companyId, tx, {
        order,
        consumption: this.consumptionOf(items),
        type: StockMovementType.OUT,
        reason: `Pedido ${order.code}`,
        userId,
      });

      return this.withRatesHistory(order);
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
    const order = await this.orders.findWithItems(companyId, id);
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
      deliveryFee: order.deliveryFee,
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
    // Un menu aporta la cantidad de cada ingrediente de su receta.
    const stockOut = this.consumptionOf(newItems);

    return this.orders.transaction(async (tx) => {
      const updated = await this.orders.update(
        companyId,
        id,
        {
          ...totals,
          paymentStatus,
          items: {
            ...(toCreate.length > 0
              ? {
                  create: toCreate.map((line) => ({
                    companyId,
                    productId: line.productId,
                    menuId: line.menuId,
                    name: line.name,
                    quantity: line.quantity,
                    unitPrice: line.unitPrice,
                    total: line.total,
                    consumption: serializeConsumption(line.consumption),
                  })),
                }
              : {}),
            ...(toUpdate.length > 0
              ? {
                  update: toUpdate.map((line) => ({
                    where: { id: line.itemId },
                    data: {
                      quantity: line.quantity,
                      total: line.total,
                      // El consumo de la linea se pondero con la receta vigente
                      // del tramo agregado (ver `mergeLines`).
                      ...(line.consumption
                        ? { consumption: serializeConsumption(line.consumption) }
                        : {}),
                    },
                  })),
                }
              : {}),
            ...(toDelete.length > 0
              ? { deleteMany: toDelete.map((itemId) => ({ id: itemId })) }
              : {}),
          },
        },
        tx,
      );

      // El stock de los productos agregados se consume igual que al crear.
      await this.applyConsumption(companyId, tx, {
        order,
        consumption: stockOut,
        type: StockMovementType.OUT,
        reason: `Pedido ${order.code}`,
        userId,
      });

      return this.withRatesHistory(updated);
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

    const recipes = await this.loadItemRecipes(companyId, [item]);

    return this.applyItemChange(
      companyId,
      order,
      lines,
      this.itemMovements({
        item,
        units: Math.abs(delta),
        type: delta > 0 ? StockMovementType.OUT : StockMovementType.IN,
        reason:
          delta > 0
            ? `Pedido ${order.code}`
            : `Devolucion por corregir la cantidad del pedido ${order.code}`,
        recipes,
      }),
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
    const recipes = await this.loadItemRecipes(companyId, [item]);

    return this.applyItemChange(
      companyId,
      order,
      lines,
      this.itemMovements({
        item,
        units: item.quantity,
        type: StockMovementType.IN,
        reason: `Devolucion por quitar un producto del pedido ${order.code}`,
        recipes,
      }),
      userId,
    );
  }

  /**
   * Arma las lineas finales del pedido fusionando los productos repetidos.
   *
   * La clave de fusion es la referencia (`productId` o `menuId`) + `unitPrice`
   * (en centavos, para comparar con exactitud): el mismo producto al mismo precio
   * ocupa una sola linea con las cantidades sumadas. Tambien recorre las lineas
   * existentes, por lo que consolida duplicados previos (esas filas vuelven en
   * `removeIds` para borrarlas y que los totales sigan cuadrando con la base).
   */
  private mergeLines(
    existing: OrderWithItems['items'],
    added: ResolvedOrderItem[],
  ): MergedOrderLine[] {
    const lines = new Map<string, MergedOrderLine>();

    for (const item of existing) {
      const key = this.lineKey(item.menuId, item.productId, item.unitPrice);
      const current = lines.get(key);
      if (!current) {
        lines.set(key, {
          itemId: item.id,
          removeIds: [],
          originalQuantity: item.quantity,
          productId: item.productId,
          menuId: item.menuId,
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.total,
          consumption: parseConsumption(item.consumption),
        });
        continue;
      }
      // Fila duplicada del mismo producto y precio: se consolida en la primera.
      const previousQuantity = current.quantity;
      current.quantity += item.quantity;
      current.total = money.mul(current.unitPrice, current.quantity);
      current.consumption = blendConsumption({
        existing: current.consumption,
        existingQuantity: previousQuantity,
        added: parseConsumption(item.consumption),
        addedQuantity: item.quantity,
      });
      current.removeIds.push(item.id);
    }

    for (const item of added) {
      const key = this.lineKey(item.menuId, item.productId, item.unitPrice);
      const current = lines.get(key);
      if (!current) {
        lines.set(key, {
          removeIds: [],
          originalQuantity: 0,
          productId: item.productId,
          menuId: item.menuId,
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.total,
          consumption: blendConsumption({
            existing: null,
            existingQuantity: 0,
            added: item.consumption,
            addedQuantity: item.quantity,
          }),
        });
        continue;
      }
      // El producto ya estaba en el pedido: se suma la cantidad. El consumo se
      // pondera por unidades para que la devolucion devuelva el total real,
      // aunque la receta haya cambiado entre una carga y otra.
      const previousQuantity = current.quantity;
      current.quantity += item.quantity;
      current.total = money.mul(current.unitPrice, current.quantity);
      current.consumption = blendConsumption({
        existing: current.consumption,
        existingQuantity: previousQuantity,
        added: item.consumption,
        addedQuantity: item.quantity,
      });
    }

    return [...lines.values()];
  }

  /** Clave de fusion de una linea: referencia (producto o menu) + precio. */
  private lineKey(
    menuId: string | null,
    productId: string | null,
    unitPrice: number,
  ): string {
    return `${menuId ? 'm' : 'p'}:${menuId ?? productId}|${toCents(unitPrice)}`;
  }

  /**
   * Valida las lineas (productos sueltos y menus) y arma los items con el
   * snapshot de nombre y precio mas el consumo de inventario de cada uno. Se usa
   * al crear el pedido y al agregar mas productos.
   */
  private async resolveItems(
    companyId: string,
    lines: OrderItemDto[],
  ): Promise<ResolvedOrderItem[]> {
    for (const line of lines) {
      if (!line.productId && !line.menuId) {
        throw new BadRequestException(
          'Cada linea del pedido debe indicar un producto o un menu',
        );
      }
      if (line.productId && line.menuId) {
        throw new BadRequestException(
          'Una linea del pedido no puede ser producto y menu a la vez',
        );
      }
    }

    const productIds = [
      ...new Set(lines.filter((line) => !line.menuId).map((line) => line.productId!)),
    ];
    const menuIds = [
      ...new Set(lines.filter((line) => !!line.menuId).map((line) => line.menuId!)),
    ];

    const products = productIds.length
      ? await this.orders.findSaleProducts(companyId, productIds)
      : [];
    const recipes = await this.menus.loadRecipes(companyId, menuIds);

    if (products.length !== productIds.length) {
      const found = new Set(products.map((product) => product.id));
      const missing = productIds.filter((id) => !found.has(id));
      throw new BadRequestException(
        `Producto(s) no encontrado(s): ${missing.join(', ')}`,
      );
    }

    const byId = new Map(products.map((product) => [product.id, product]));
    return lines.map((line) => {
      const quantity = line.quantity;

      if (line.menuId) {
        const recipe = recipes.get(line.menuId);
        if (!recipe) {
          throw new BadRequestException(`Menu no encontrado: ${line.menuId}`);
        }
        if (!recipe.active) {
          throw new BadRequestException(
            `El menu "${recipe.name}" esta inactivo y no puede venderse`,
          );
        }
        // La receta es opcional: un menu sin ingredientes se cobra a su precio
        // y no descuenta inventario (su consumo queda vacio). Bloquear la venta
        // obligaba a cargar una receta solo para poder cobrar el plato.
        // Un ingrediente desactivado despues de armar la receta deja el menu
        // invendible: se avisa cual es para que se corrija la receta.
        const inactive = recipe.ingredients.filter(
          (ingredient) => ingredient.active === false,
        );
        if (inactive.length > 0) {
          const names = inactive
            .map((ingredient) => `"${ingredient.productName ?? ingredient.productId}"`)
            .join(', ');
          throw new BadRequestException(
            `El menu "${recipe.name}" usa ${names}, un producto inactivo. Actualiza la receta para poder venderlo.`,
          );
        }
        const unitPrice = toMoney(line.unitPrice ?? recipe.price);
        return {
          productId: null,
          menuId: recipe.id,
          name: recipe.name,
          quantity,
          unitPrice,
          total: money.mul(unitPrice, quantity),
          consumption: recipe.ingredients.map((ingredient) => ({
            productId: ingredient.productId,
            quantity: ingredient.quantity,
          })),
        };
      }

      const product = byId.get(line.productId!)!;
      if (!product.active) {
        throw new BadRequestException(
          `El producto "${product.name}" esta inactivo y no puede venderse`,
        );
      }
      const unitPrice = toMoney(line.unitPrice ?? product.price);
      return {
        productId: product.id,
        menuId: null,
        name: product.name,
        quantity,
        unitPrice,
        total: money.mul(unitPrice, quantity),
        // Un producto suelto se consume a si mismo: 1 unidad por unidad vendida.
        consumption: [{ productId: product.id, quantity: 1 }],
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

  /**
   * Costo de delivery de la peticion convertido a USD (moneda base).
   *
   * Sigue la misma convencion del catalogo (productos/menus): el monto se escribe
   * en `currency` y, si se indica, se convierte con la tasa `rateKey`. La interfaz
   * de pedidos captura el costo en dolares (moneda base), asi que lo normal es que
   * `currency` sea USD y no haya nada que convertir; el resto de la convencion
   * queda para que la API acepte el costo en cualquier moneda del sistema. En
   * todos los casos se guarda el monto ya en USD mas el contexto (moneda, monto
   * escrito, tasa aplicada y clave de tasa) para volver a mostrarlo tal cual.
   *
   * Devuelve `null` cuando no hay costo (sin monto o en 0): asi el pedido queda
   * con `deliveryFee = 0` y sin contexto de moneda.
   */
  private async resolveDeliveryFee(
    companyId: string,
    input: { amount?: number; currency?: string | null; rateKey?: string | null },
  ): Promise<OrderDeliveryFee | null> {
    const amount = toMoney(input.amount ?? 0);
    if (amount <= 0) return null;

    const currency = normalizeCurrencyCode(input.currency) || BASE_CURRENCY_CODE;
    const rateKey = normalizeRateKey(input.rateKey);

    // En la moneda base (USD) el monto ya esta en dolares: no hay nada que
    // convertir ni tasa que resolver.
    if (currency === BASE_CURRENCY_CODE) {
      return { base: amount, entered: amount, currency, rate: null, rateKey };
    }

    const conversion = await this.rates.resolveAmount(
      companyId,
      amount,
      currency,
      rateKey,
    );
    return {
      base: toMoney(conversion.baseAmount),
      entered: amount,
      currency: conversion.currency,
      rate: conversion.exchangeRate,
      rateKey,
    };
  }

  /** Columnas del costo de delivery (sin costo se deja el contexto vacio). */
  private deliveryFeeWrite(fee: OrderDeliveryFee | null) {
    return {
      deliveryFee: fee?.base ?? 0,
      deliveryFeeEntered: fee?.entered ?? null,
      deliveryFeeCurrency: fee?.currency ?? BASE_CURRENCY_CODE,
      deliveryFeeRate: fee?.rate ?? null,
      deliveryFeeRateKey: fee?.rateKey ?? null,
    };
  }

  // =========================================================================
  //  HISTORIAL DE TASAS DE LOS COBROS
  // =========================================================================

  /**
   * Decodifica el historial de tasas de los cobros de un pedido.
   *
   * La columna `ratesHistory` guarda la foto de las tasas en JSON de texto
   * (SQLite no tiene columnas JSON) y la API entrega el objeto ya leido, igual
   * que hace el codec de dinero con los montos. Un pedido sin pagos -o con un
   * historial corrupto, que `parseRatesHistory` degrada a `null`- pasa intacto.
   */
  private withRatesHistory<T>(order: T): T {
    const payments = (order as { payments?: unknown } | null)?.payments;
    if (!Array.isArray(payments)) return order;

    const decoded = payments.map((payment: unknown) => {
      if (!payment || typeof payment !== 'object') return payment;
      const row = payment as Record<string, unknown>;
      return {
        ...row,
        ratesHistory: parseRatesHistory(row.ratesHistory),
        // El desglose del cobro y del vuelto se guarda como JSON de texto (SQLite
        // no tiene columnas JSON): la API lo entrega ya leido, con los montos en
        // decimales, igual que el codec de dinero.
        parts: parsePaymentLines(row.parts),
        change: parsePaymentLines(row.change),
      };
    });

    return { ...(order as object), payments: decoded } as T;
  }

  // =========================================================================
  //  CONSULTAS
  // =========================================================================

  async findAll(companyId: string, query: OrderQueryDto) {
    const { items, total } = await this.orders.findPage(companyId, query);
    return buildPaginatedResult(items, total, query.page, query.limit);
  }

  /** Pedidos activos (no terminados) para el tablero operativo. */
  findActiveOrders(companyId: string) {
    return this.orders.findActive(companyId);
  }

  async findOne(companyId: string, id: string) {
    const order = await this.orders.findDetail(companyId, id);
    if (!order) throw new NotFoundException('Pedido no encontrado');
    return this.withRatesHistory(order);
  }

  /** Actualiza datos editables y recalcula totales sobre los items existentes. */
  async update(companyId: string, id: string, dto: UpdateOrderDto) {
    const order = await this.orders.findWithItems(companyId, id);
    if (!order) throw new NotFoundException('Pedido no encontrado');
    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('No se puede editar un pedido cancelado');
    }

    const deliveryFee = await this.resolveDeliveryFee(companyId, {
      amount: dto.deliveryFee,
      currency: dto.deliveryFeeCurrency,
      rateKey: dto.deliveryFeeRateKey,
    });

    const totals = computeOrderTotals({
      items: order.items,
      discount: dto.discount ?? order.discount,
      taxRate: dto.taxRate ?? this.effectiveTaxRate(order),
      tip: dto.tip ?? order.tip,
      // Sin `deliveryFee` en la peticion se conserva lo que ya tenia el pedido;
      // enviarlo (aunque sea 0) reemplaza el costo y sus datos de moneda.
      deliveryFee:
        dto.deliveryFee !== undefined
          ? (deliveryFee?.base ?? 0)
          : order.deliveryFee,
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

    const updated = await this.orders.update(companyId, id, {
      ...(dto.customerId !== undefined
        ? { customerId: normalizeNullableId(dto.customerId) }
        : {}),
      ...(dto.tableNumber !== undefined ? { tableNumber: dto.tableNumber } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      ...totals,
      ...(dto.deliveryFee !== undefined
        ? this.deliveryFeeWrite(deliveryFee)
        : {}),
      paymentStatus,
    });

    return this.withRatesHistory(updated);
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
   *
   * El cobro guarda ademas el HISTORIAL DE TASAS del dia: la tasa de cobro
   * elegida (`rateKey`) y la foto de TODAS las tasas vigentes en ese momento
   * (`ratesHistory`), para poder auditar el cobro despues aunque las tasas cambien.
   */
  async addPayment(
    companyId: string,
    orderId: string,
    dto: AddOrderPaymentDto,
    userId: string,
  ) {
    const paid = await this.orders.transaction(async (tx) => {
      const order = await this.orders.findDetail(companyId, orderId, tx);
      if (!order) throw new NotFoundException('Pedido no encontrado');
      if (order.status === OrderStatus.CANCELLED) {
        throw new BadRequestException('No se puede cobrar un pedido cancelado');
      }

      const balance = money.sub(order.total, order.paidAmount);
      if (compareMoney(balance, 0) <= 0) {
        throw new BadRequestException('El pedido ya esta pagado en su totalidad');
      }

      // `rateKey` es la tasa de cobro elegida por el operador (el cajero envia la
      // configurada por la empresa); sin ella se usa la activa del sistema.
      const rateKey = normalizeRateKey(dto.rateKey);
      if (dto.method === PaymentMethod.MIXED && !dto.parts?.length) {
        throw new BadRequestException(
          'El pago mixto requiere el desglose de las partes (parts)',
        );
      }
      const inputParts =
        dto.parts && dto.parts.length > 0
          ? dto.parts
          : [
              {
                amount: dto.amount,
                method: dto.method,
                currency: dto.currency,
                rateKey: dto.rateKey,
              },
            ];
      const inputChange = dto.change ?? [];

      // Transferencias y pagos moviles se respaldan con la referencia bancaria
      // (4-6 digitos) y, opcionalmente, la foto del comprobante. La referencia
      // es obligatoria si CUALQUIER parte del cobro usa uno de esos metodos.
      const needsProof = inputParts.some((part) =>
        PAYMENT_PROOF_METHODS.includes(part.method),
      );
      const paymentReference = needsProof
        ? (dto.paymentReference ?? '').trim()
        : null;
      if (needsProof && !/^\d{4,6}$/.test(paymentReference ?? '')) {
        throw new BadRequestException(
          'La referencia del comprobante debe tener entre 4 y 6 digitos',
        );
      }
      const paymentPhotoUrl = needsProof ? (dto.paymentPhotoUrl ?? null) : null;

      // Cada parte se convierte con SU moneda y SU tasa: en un pago mixto el
      // cliente puede entregar dolares en efectivo y bolivares por transferencia.
      const parts: PaymentBreakdownLine[] = [];
      for (const part of inputParts) {
        const partAmount = toMoney(part.amount);
        if (partAmount <= 0) {
          throw new BadRequestException('Cada parte del pago debe ser mayor a 0');
        }
        if (part.method === PaymentMethod.MIXED) {
          throw new BadRequestException(
            'Cada parte del pago debe tener un metodo concreto (no MIXTO)',
          );
        }
        const partRateKey = normalizeRateKey(part.rateKey) ?? rateKey;
        const conversion = await this.rates.resolvePayment(
          companyId,
          partAmount,
          part.currency,
          partRateKey,
        );
        parts.push({
          method: part.method,
          currency: conversion.currency,
          amount: partAmount,
          exchangeRate: conversion.exchangeRate,
          rateKey: partRateKey,
          baseAmount: conversion.baseAmount,
        });
      }

      // El vuelto tambien se convierte parte por parte: puede entregarse en otra
      // moneda y por otro metodo distinto al del pago.
      const changes: PaymentBreakdownLine[] = [];
      for (const change of inputChange) {
        const changeAmount = toMoney(change.amount);
        if (changeAmount <= 0) continue;
        if (change.method === PaymentMethod.MIXED) {
          throw new BadRequestException(
            'Cada parte del vuelto debe tener un metodo concreto (no MIXTO)',
          );
        }
        const changeRateKey = normalizeRateKey(change.rateKey) ?? rateKey;
        const conversion = await this.rates.resolvePayment(
          companyId,
          changeAmount,
          change.currency,
          changeRateKey,
        );
        changes.push({
          method: change.method,
          currency: conversion.currency,
          amount: changeAmount,
          exchangeRate: conversion.exchangeRate,
          rateKey: changeRateKey,
          baseAmount: conversion.baseAmount,
        });
      }

      const grossBase = money.sum(parts.map((part) => part.baseAmount));
      let changeBase = money.sum(changes.map((change) => change.baseAmount));
      if (compareMoney(changeBase, grossBase) > 0) {
        throw new BadRequestException('El vuelto no puede superar lo entregado por el cliente');
      }
      const computedApplied = money.sub(grossBase, changeBase);

      // El cajero cobra el precio que ve en pantalla: con la tasa de cobro el cobro
      // en divisas (o en bolivares, el precio de la pantalla) puede valer mas que el
      // total del pedido —que esta en dolares— sin que sea un exceso real. Se ajusta
      // al saldo cuando el exceso es solo el redondeo de convertir a otra moneda.
      const limit = await this.rates.chargeBalance(companyId, balance, rateKey);
      const baseAmount = fitToBalance(computedApplied, limit);
      if (baseAmount === null) {
        throw new BadRequestException(
          `El monto aplicado (${computedApplied} USD) excede el saldo pendiente (${limit} USD)`,
        );
      }

      // Si la conversion deja una diferencia de redondeo, se absorbe en el ultimo
      // vuelto (o en la ultima parte del pago si no hubo vuelto). Asi el neto de
      // los movimientos de caja coincide EXACTAMENTE con lo aplicado al pedido.
      const rounding = money.sub(computedApplied, baseAmount);
      if (compareMoney(rounding, 0) !== 0) {
        if (changes.length > 0) {
          const last = changes[changes.length - 1];
          last.baseAmount = money.add(last.baseAmount, rounding);
          changeBase = money.add(changeBase, rounding);
        } else {
          const last = parts[parts.length - 1];
          last.baseAmount = money.sub(last.baseAmount, rounding);
        }
      }

      // Toda venta debe poder asociarse a una sesion de caja abierta.
      const session = await this.cash.getOpenSessionOrThrow(companyId, tx);

      // Foto de TODAS las tasas vigentes al cobrar (BCV dolar, BCV euro y la
      // personalizada del local), no solo la aplicada: asi el cobro queda
      // auditable con las tasas que existian ese dia.
      const ratesHistory = await this.rates.ratesHistory(companyId);

      // Ingresos: una entrada por cada parte del pago (metodo + moneda).
      const partMovements = [];
      for (const [index, part] of parts.entries()) {
        const movement = await this.cash.registerMovement(
          companyId,
          {
            sessionId: session.id,
            type: CashMovementType.IN,
            category: CashMovementCategory.SALE,
            paymentMethod: part.method,
            amount: part.amount,
            currency: part.currency,
            baseAmount: part.baseAmount,
            description:
              parts.length > 1
                ? `Cobro pedido ${order.code} (parte ${index + 1}/${parts.length})`
                : `Cobro pedido ${order.code}`,
            referenceType: 'ORDER',
            referenceId: order.id,
            // Solo la parte cobrada por banco/billetera lleva el comprobante.
            ...(PAYMENT_PROOF_METHODS.includes(part.method)
              ? {
                  paymentReference,
                  paymentPhotoUrl: paymentPhotoUrl ?? undefined,
                }
              : {}),
            createdById: userId,
          },
          tx,
        );
        partMovements.push(movement);
      }

      // Egresos: el vuelto se registra como movimientos propios para que se vea
      // en la caja con su metodo y su moneda, y para que el arqueo descuente lo
      // que realmente salio del cajon.
      for (const [index, change] of changes.entries()) {
        await this.cash.registerMovement(
          companyId,
          {
            sessionId: session.id,
            type: CashMovementType.OUT,
            category: CashMovementCategory.CHANGE,
            paymentMethod: change.method,
            amount: change.amount,
            currency: change.currency,
            baseAmount: change.baseAmount,
            description:
              changes.length > 1
                ? `Vuelto pedido ${order.code} (parte ${index + 1}/${changes.length})`
                : `Vuelto pedido ${order.code}`,
            referenceType: 'ORDER',
            referenceId: order.id,
            createdById: userId,
          },
          tx,
        );
      }

      // Monto visible del pago: si todo se movio en una sola moneda se conserva
      // esa moneda; en un mixto multimoneda el resumen va en USD (moneda base) y
      // el detalle exacto queda en `parts`/`change`.
      const currencies = new Set(
        [...parts, ...changes].map((line) => line.currency),
      );
      const singleCurrency = currencies.size === 1 ? [...currencies][0] : null;
      const paymentCurrency = singleCurrency ?? BASE_CURRENCY_CODE;
      const paymentAmount = singleCurrency
        ? money.sub(
            money.sum(parts.map((part) => part.amount)),
            money.sum(changes.map((change) => change.amount)),
          )
        : baseAmount;
      if (compareMoney(paymentAmount, 0) <= 0) {
        throw new BadRequestException('El monto aplicado al pedido debe ser mayor a 0');
      }

      const method =
        (dto.parts?.length ?? 0) > 1 || dto.method === PaymentMethod.MIXED
          ? PaymentMethod.MIXED
          : parts[0].method;

      await this.orders.createPayment(
        {
          companyId,
          orderId: order.id,
          amount: paymentAmount,
          method,
          currency: paymentCurrency,
          exchangeRate:
            parts.length === 1 && changes.length === 0
              ? parts[0].exchangeRate
              : null,
          // Tasa elegida por el cajero (`null` = la activa del sistema) y la
          // foto de todas las tasas del dia, en JSON de texto.
          rateKey,
          ratesHistory: encodeRatesHistory(ratesHistory),
          baseAmount,
          parts: encodePaymentLines(parts),
          change: encodePaymentLines(changes),
          changeBaseAmount: changeBase,
          cashMovementId: partMovements[0]?.id,
          paymentReference: paymentReference ?? undefined,
          paymentPhotoUrl: paymentPhotoUrl ?? undefined,
          note: dto.note,
          createdById: userId,
        },
        tx,
      );

      const paidAmount = money.add(order.paidAmount, baseAmount);
      const paymentStatus =
        compareMoney(paidAmount, order.total) >= 0
          ? PaymentStatus.PAID
          : PaymentStatus.PARTIAL;

      const updated = await this.orders.update(
        companyId,
        order.id,
        {
          paidAmount,
          paymentStatus,
          cashSessionId: session.id,
          ...(paymentStatus === PaymentStatus.PAID &&
          order.status !== OrderStatus.COMPLETED
            ? { status: OrderStatus.COMPLETED }
            : {}),
        },
        tx,
      );

      return this.withRatesHistory(updated);
    });

    const payments = paid.payments ?? [];
    const payment = payments[payments.length - 1];
    if (payment) {
      void this.notifications?.notifySale(
        companyId,
        {
          orderCode: paid.code,
          total: paid.total,
          paidNow: payment.amount,
          paidTotal: paid.paidAmount,
          paymentCurrency: payment.currency,
          method: payment.method,
          rates: parseRatesHistory(payment.ratesHistory),
          paymentReference: payment.paymentReference,
          paymentPhotoUrl: payment.paymentPhotoUrl,
          items: (paid.items ?? []).map((item) => ({
            name: item.name,
            quantity: item.quantity,
          })),
        },
        userId,
      );
    }

    return paid;
  }

  // =========================================================================
  //  ESTADOS / CANCELACION
  // =========================================================================

  /**
   * Emite el OTP que autoriza al cajero a cancelar. Lo recibe el administrador
   * por Telegram; sin chat vinculado el backend rechaza la solicitud.
   */
  async requestCancellationOtp(
    companyId: string,
    id: string,
    userId: string,
  ) {
    const order = await this.orders.findStatusContext(companyId, id);
    if (!order) throw new NotFoundException('Pedido no encontrado');
    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('El pedido ya está cancelado');
    }
    if (order._count.payments > 0) {
      throw new BadRequestException(
        'El pedido tiene pagos registrados. Registra la devolución (REFUND) en caja antes de cancelarlo.',
      );
    }
    const allowed = ORDER_TRANSITIONS[order.status] ?? [];
    if (!allowed.includes(OrderStatus.CANCELLED)) {
      throw new BadRequestException(
        `No se puede cancelar un pedido en estado ${order.status}`,
      );
    }
    if (!this.notifications) {
      throw new BadRequestException(
        'Las notificaciones no están disponibles en este servidor.',
      );
    }

    return this.notifications.requestCancellationOtp(companyId, {
      orderId: order.id,
      orderCode: order.code,
      total: order.total,
      requestedById: userId,
      items: order.items.map((item) => ({
        name: item.name,
        quantity: item.quantity,
      })),
    });
  }

  /** Cambia el estado respetando la maquina de estados. */
  async updateStatus(
    companyId: string,
    id: string,
    dto: UpdateOrderStatusDto,
    userId: string,
    role?: Role,
  ) {
    const order = await this.orders.findStatusContext(companyId, id);
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

      // El cajero no cancela por su cuenta: necesita el codigo que el
      // administrador recibio por Telegram (vigente 10 minutos, de un solo uso).
      let otpId: string | null = null;
      if (role === Role.CASHIER) {
        if (!this.notifications) {
          throw new BadRequestException(
            'Las notificaciones no están disponibles: no se puede validar el código.',
          );
        }
        if (!dto.code) {
          throw new BadRequestException(
            'Para cancelar un pedido necesitas el código de autorización del administrador.',
          );
        }
        otpId = await this.notifications.validateCancellationCode(
          companyId,
          order.id,
          dto.code,
        );
        if (!otpId) {
          throw new BadRequestException(
            'El código de cancelación es incorrecto o venció. Solicita uno nuevo.',
          );
        }
      }

      const cancelled = await this.restockAndSetCancelled(companyId, order, userId);

      if (otpId && this.notifications) {
        await this.notifications
          .consumeCancellationCode(otpId)
          .catch(() => undefined);
      }
      void this.notifications?.notifyCancellation(
        companyId,
        {
          orderCode: cancelled.code,
          total: cancelled.total,
          usedOtp: otpId !== null,
          items: cancelled.items.map((item) => ({
            name: item.name,
            quantity: item.quantity,
          })),
        },
        userId,
      );

      return cancelled;
    }

    const updated = await this.orders.updateStatus(companyId, id, dto.status);

    return this.withRatesHistory(updated);
  }

  /** Elimina un pedido sin pagos, devolviendo el stock consumido. */
  async remove(companyId: string, id: string, userId: string) {
    const order = await this.orders.findWithPayments(companyId, id);
    if (!order) throw new NotFoundException('Pedido no encontrado');
    if (order._count.payments > 0) {
      throw new BadRequestException(
        'No se puede eliminar un pedido con pagos registrados',
      );
    }
    if (order.status === OrderStatus.COMPLETED) {
      throw new BadRequestException('No se puede eliminar un pedido completado');
    }

    await this.orders.transaction(async (tx) => {
      if (order.status !== OrderStatus.CANCELLED) {
        await this.restockItems(companyId, tx, order, userId);
      }
      await this.orders.delete(companyId, id, tx);
    });

    return { id, deleted: true };
  }

  /**
   * Cancela el pedido y devuelve el stock. El `updateMany` condicionado por
   * estado garantiza que la devolucion de stock ocurra exactamente una vez.
   */
  private async restockAndSetCancelled(
    companyId: string,
    order: OrderStatusContext,
    userId: string,
  ) {
    return this.orders.transaction(async (tx) => {
      const guard = await this.orders.markCancelled(companyId, order.id, tx);
      if (guard.count === 0) {
        throw new ConflictException('El pedido ya estaba cancelado');
      }

      await this.restockItems(companyId, tx, order, userId);

      const updated = await this.orders.findDetailById(order.id, tx);

      return this.withRatesHistory(updated);
    });
  }

  /**
   * Devuelve al inventario todo lo consumido por los items del pedido: los
   * productos con control de stock y, en los menus, cada ingrediente de la receta
   * por las unidades vendidas. Se agrega por producto (una sola entrada).
   */
  private async restockItems(
    companyId: string,
    tx: PrismaClientLike,
    order: OrderWithItems,
    userId: string,
  ) {
    const recipes = await this.loadItemRecipes(companyId, order.items, tx);

    const consumption = new Map<string, number>();
    for (const item of order.items) {
      for (const part of this.itemConsumption(item, recipes)) {
        const quantity = mulQty(part.quantity, item.quantity);
        if (quantity <= 0) continue;
        consumption.set(
          part.productId,
          sumQty([consumption.get(part.productId) ?? 0, quantity]),
        );
      }
    }

    await this.applyConsumption(companyId, tx, {
      order,
      consumption,
      type: StockMovementType.IN,
      reason: `Devolucion por cancelacion del pedido ${order.code}`,
      userId,
    });
  }

  /** Consumo total del pedido por producto (menus expandidos a su receta). */
  private consumptionOf(items: ResolvedOrderItem[]): Map<string, number> {
    const totals = new Map<string, number>();
    for (const item of items) {
      for (const part of item.consumption) {
        const quantity = mulQty(part.quantity, item.quantity);
        if (quantity <= 0) continue;
        totals.set(
          part.productId,
          sumQty([totals.get(part.productId) ?? 0, quantity]),
        );
      }
    }
    return totals;
  }

  /**
   * Consumo unitario de una linea YA guardada en el pedido.
   *
   * La linea trae congelado lo que desconto al venderse (`consumption`), asi que
   * ese snapshot manda: la devolucion es exacta aunque la receta del menu haya
   * cambiado. Solo las lineas sin snapshot (pedidos anteriores a esa columna o
   * lineas sin receta) se resuelven con la receta vigente.
   */
  private itemConsumption(
    item: {
      productId: string | null;
      menuId: string | null;
      name: string;
      consumption: string | null;
    },
    recipes: Map<string, MenuRecipe>,
  ): { productId: string; quantity: number }[] {
    const snapshot = parseConsumption(item.consumption);
    if (snapshot) return snapshot;

    if (item.menuId) {
      const recipe = recipes.get(item.menuId);
      if (!recipe) {
        throw new BadRequestException(
          `No se encontro la receta del menu "${item.name}": revisa el menu antes de continuar`,
        );
      }
      return recipe.ingredients.map((ingredient) => ({
        productId: ingredient.productId,
        quantity: ingredient.quantity,
      }));
    }
    return item.productId ? [{ productId: item.productId, quantity: 1 }] : [];
  }

  /** Movimientos de una linea del pedido (producto suelto o menu). */
  private itemMovements(input: {
    item: {
      productId: string | null;
      menuId: string | null;
      name: string;
      consumption: string | null;
    };
    units: number;
    type: StockMovementType;
    reason: string;
    recipes: Map<string, MenuRecipe>;
  }) {
    return this.itemConsumption(input.item, input.recipes)
      .map((part) => ({
        productId: part.productId,
        type: input.type,
        quantity: mulQty(part.quantity, input.units),
        reason: input.reason,
      }))
      .filter((movement) => movement.quantity > 0);
  }

  /** Recetas de los menus referenciados por las lineas SIN consumo congelado. */
  private loadItemRecipes(
    companyId: string,
    items: { menuId: string | null; consumption: string | null }[],
    tx?: PrismaClientLike,
  ): Promise<Map<string, MenuRecipe>> {
    const menuIds = items
      .filter((item) => !parseConsumption(item.consumption))
      .map((item) => item.menuId)
      .filter((menuId): menuId is string => !!menuId);
    return this.menus.loadRecipes(companyId, menuIds, tx);
  }

  /**
   * Aplica el consumo de inventario de una venta. Solo mueve los productos con
   * control de stock (`trackProduct`), igual que antes: un menu con un ingrediente
   * sin control simplemente no genera movimiento para ese ingrediente.
   */
  private async applyConsumption(
    companyId: string,
    tx: PrismaClientLike,
    input: {
      order: { id: string; code: string };
      consumption: Map<string, number>;
      type: StockMovementType;
      reason: string;
      userId: string;
    },
  ) {
    const entries = [...input.consumption].filter(([, quantity]) => quantity > 0);
    if (entries.length === 0) return;

    const tracked = await this.trackedProductIds(
      companyId,
      entries.map(([productId]) => productId),
      tx,
    );

    for (const [productId, quantity] of entries) {
      if (!tracked.has(productId)) continue;
      await this.inventory.applyMovement(
        companyId,
        {
          productId,
          type: input.type,
          quantity,
          reason: input.reason,
          referenceType: StockReferenceType.ORDER,
          referenceId: input.order.id,
          createdById: input.userId,
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
    const order = await this.orders.findWithItems(companyId, id);
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
      deliveryFee: order.deliveryFee,
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

    return this.orders.transaction(async (tx) => {
      const updated = await this.orders.update(
        companyId,
        order.id,
        {
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
        tx,
      );

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

      return this.withRatesHistory(updated);
    });
  }

  /** Ids de los productos que llevan control de inventario. */
  private async trackedProductIds(
    companyId: string,
    productIds: string[],
    tx?: PrismaClientLike,
  ): Promise<Set<string>> {
    const ids = await this.orders.findTrackedProductIds(
      companyId,
      productIds,
      tx,
    );
    return new Set(ids);
  }

  /** Siguiente codigo secuencial del dia: PED-YYYYMMDD-NNNN (por empresa). */
  private async nextCode(
    companyId: string,
    tx: PrismaClientLike,
  ): Promise<string> {
    const count = await this.orders.countToday(companyId, tx);
    return buildCode('PED', count + 1);
  }
}

