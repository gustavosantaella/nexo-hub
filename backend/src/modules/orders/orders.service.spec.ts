import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  OrderStatus,
  OrderType,
  PaymentMethod,
  PaymentStatus,
  StockMovementType,
  StockReferenceType,
} from '../../common/constants/enums';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CashService } from '../cash/cash.service';
import type { InventoryService } from '../inventory/inventory.service';
import type { MenusService } from '../menus/menus.service';
import type { RatesService, RateHistory } from '../rates/rates.service';
import {
  OrdersService,
  computeOrderTotals,
  encodeRatesHistory,
  parseRatesHistory,
} from './orders.service';

const COMPANY_ID = 'company-1';

/**
 * Historial de tasas de ejemplo: TODAS las tasas vigentes del dia (BCV dolar y
 * euro + la personalizada del local), tal como lo arma `RatesService`.
 */
const RATES_HISTORY: RateHistory = {
  capturedAt: '2026-10-13T20:54:00.203Z',
  bcvDate: '2026-10-13',
  stale: false,
  activeKey: 'CUSTOM_USD',
  rates: [
    {
      key: 'BCV_USD',
      currency: 'USD',
      source: 'BCV',
      rate: 876.7976,
      date: '2026-10-13',
    },
    {
      key: 'BCV_EUR',
      currency: 'EUR',
      source: 'BCV',
      rate: 982.00454402,
      date: '2026-10-13',
    },
    {
      key: 'CUSTOM_USD',
      currency: 'USD',
      source: 'CUSTOM',
      rate: 905.5,
      date: null,
    },
  ],
};

/** Catalogo de productos simulado (precios en la moneda base, decimales). */
const PRODUCTS: Record<
  string,
  { id: string; name: string; price: number; active: boolean; trackStock: boolean }
> = {
  p1: { id: 'p1', name: 'Cafe', price: 50, active: true, trackStock: true },
  p2: { id: 'p2', name: 'Postre', price: 30, active: true, trackStock: false },
  p3: {
    id: 'p3',
    name: 'Descontinuado',
    price: 10,
    active: false,
    trackStock: true,
  },
};

interface OrderItemFixture {
  id: string;
  productId: string | null;
  menuId: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
  /** Consumo congelado al vender (`null` = linea sin snapshot). */
  consumption: string | null;
}

interface OrderFixture {
  id: string;
  code: string;
  status: string;
  discount: number;
  subtotal: number;
  tax: number;
  tip: number;
  /** Costo de delivery en USD (0 = pedido sin delivery). */
  deliveryFee: number;
  total: number;
  paidAmount: number;
  items: OrderItemFixture[];
  /** Pagos registrados (bloquean la cancelacion cuando hay alguno). */
  payments?: {
    id: string;
    amount: number;
    method: string;
    currency: string;
    exchangeRate?: number | null;
    /** Tasa elegida para el cobro (`null` = la activa del sistema). */
    rateKey?: string | null;
    /** Historial de tasas del dia, tal como lo guarda la columna (JSON texto). */
    ratesHistory?: string | null;
    baseAmount: number;
    createdAt: string;
  }[];
  _count?: { payments: number };
}

/** Linea de ejemplo: 2 cafes a 50 = 100. */
function item(overrides: Partial<OrderItemFixture> = {}): OrderItemFixture {
  return {
    id: 'i1',
    productId: 'p1',
    menuId: null,
    name: 'Cafe',
    quantity: 2,
    unitPrice: 50,
    total: 100,
    // Sin snapshot por defecto: los tests de lineas viejas resuelven la receta
    // vigente y los nuevos fijan su propio consumo congelado.
    consumption: null,
    ...overrides,
  };
}

/** Pedido de ejemplo: 2 cafes a 50 = 100, sin impuestos, propina ni pagos. */
function order(overrides: Partial<OrderFixture> = {}): OrderFixture {
  return {
    id: 'o1',
    code: 'PED-20260101-0001',
    status: OrderStatus.PENDING,
    discount: 0,
    subtotal: 100,
    tax: 0,
    tip: 0,
    deliveryFee: 0,
    total: 100,
    paidAmount: 0,
    items: [item()],
    ...overrides,
  };
}

interface UpdateArgs {
  where: { id: string };
  data: Record<string, unknown>;
}

/** Menus simulados: receta (producto + cantidad por unidad vendida). */
interface MenuFixture {
  id: string;
  code: string;
  name: string;
  price: number;
  active: boolean;
  ingredients: {
    productId: string;
    quantity: number;
    productName?: string;
    active?: boolean;
  }[];
}

const MENUS: Record<string, MenuFixture> = {
  // Parrilla: medio cafe (controlado) y un postre (sin control de inventario).
  m1: {
    id: 'm1',
    code: 'MEN-1',
    name: 'Parrilla',
    price: 120,
    active: true,
    ingredients: [
      { productId: 'p1', quantity: 0.5, productName: 'Cafe', active: true },
      { productId: 'p2', quantity: 1, productName: 'Postre', active: true },
    ],
  },
  m2: {
    id: 'm2',
    code: 'MEN-2',
    name: 'Menu retirado',
    price: 20,
    active: false,
    ingredients: [{ productId: 'p1', quantity: 1 }],
  },
  // Receta armada con un producto que despues se desactivo: no se puede vender.
  m3: {
    id: 'm3',
    code: 'MEN-3',
    name: 'Menu con insumo viejo',
    price: 15,
    active: true,
    ingredients: [
      { productId: 'p3', quantity: 1, productName: 'Descontinuado', active: false },
    ],
  },
};

function createService(
  current: OrderFixture | null,
  rates: Partial<RatesService> = {},
  cash: Partial<CashService> = {},
) {
  const trackedProducts = jest.fn(
    async (args: { where: { id: { in: string[] } } }) =>
      args.where.id.in
        .filter((id) => PRODUCTS[id])
        .map((id) => PRODUCTS[id]),
  );

  const tx = {
    order: {
      update: jest.fn(async (args: UpdateArgs) => ({
        id: args.where.id,
        ...args.data,
      })),
      // `create` y `count` alimentan `nextCode` al registrar el pedido.
      create: jest.fn(async (args: { data: Record<string, unknown> }) => ({
        id: 'o1',
        ...args.data,
      })),
      count: jest.fn(async () => 0),
      // Cancelar y eliminar el pedido devuelven stock y releen el pedido.
      updateMany: jest.fn(async () => ({ count: 1 })),
      findUniqueOrThrow: jest.fn(async () => ({ ...current, items: current?.items ?? [] })),
      delete: jest.fn(async () => ({ id: current?.id ?? 'o1' })),
      // Los cobros releen el pedido dentro de la transaccion.
      findFirst: jest.fn(async () => current),
    },
    orderPayment: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) => ({
        id: 'pay1',
        ...args.data,
      })),
    },
    product: { findMany: trackedProducts },
  };

  const prisma = {
    order: {
      findFirst: jest.fn(async () => current),
      // `update` de datos editables (cliente, mesa, notas, propina, delivery).
      update: jest.fn(async (args: UpdateArgs) => ({
        id: args.where.id,
        ...args.data,
      })),
      findUnique: jest.fn(async () => current),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    product: { findMany: trackedProducts },
    $transaction: jest.fn(
      async (cb: (client: typeof tx) => Promise<unknown>) => cb(tx),
    ),
  };

  /** `loadRecipes` solo resuelve los menus activos del catalogo simulado. */
  const menus = {
    loadRecipes: jest.fn(async (_companyId: string, menuIds: string[]) => {
      const found = menuIds
        .filter((id) => MENUS[id])
        .map((id) => MENUS[id]);
      return new Map(
        found.map((menu) => [
          menu.id,
          {
            id: menu.id,
            code: menu.code,
            name: menu.name,
            price: menu.price,
            active: menu.active,
            ingredients: menu.ingredients,
          },
        ]),
      );
    }),
  };

  const inventory = {
    applyMovement: jest.fn(async (_companyId: string, _input: unknown, _tx?: unknown) => ({
      movement: { id: 'mv1' },
      stockBefore: 10,
      stockAfter: 9,
    })),
  };

  const service = new OrdersService(
    prisma as unknown as PrismaService,
    inventory as unknown as InventoryService,
    cash as unknown as CashService,
    // Cada test declara solo las tasas que usa: todo cobro guarda ademas el
    // historial de tasas del dia, asi que viene simulado por defecto.
    { ratesHistory: jest.fn(async () => RATES_HISTORY), ...rates } as unknown as RatesService,
    menus as unknown as MenusService,
  );

  return { service, prisma, tx, inventory, menus, cash };
}

/** Datos enviados a `tx.order.update` en la primera llamada. */
function updateData(tx: {
  order: { update: jest.Mock };
}): Record<string, unknown> {
  return tx.order.update.mock.calls[0][0].data;
}

interface ItemsWrite {
  create?: {
    productId: string | null;
    menuId?: string | null;
    name: string;
    quantity: number;
    unitPrice: number;
    total: number;
    /** Consumo congelado que se persiste con la linea. */
    consumption?: string | null;
  }[];
  update?: {
    where: { id: string };
    data: {
      quantity: number;
      total: number;
      /** Consumo ponderado (solo cuando la linea tiene snapshot). */
      consumption?: string | null;
    };
  }[];
  deleteMany?: { id: string }[];
}

/** Escritura anidada de items que se envia al actualizar el pedido. */
function itemsWrite(tx: { order: { update: jest.Mock } }): ItemsWrite {
  return (updateData(tx).items ?? {}) as ItemsWrite;
}


describe('computeOrderTotals (propina opcional)', () => {
  it('suma la propina al total sin aplicarle IGV', () => {
    const totals = computeOrderTotals({
      items: [{ quantity: 2, unitPrice: 50 }],
      taxRate: 18,
      tip: 10,
    });

    expect(totals.subtotal).toBe(100);
    expect(totals.tax).toBe(18);
    expect(totals.tip).toBe(10);
    expect(totals.total).toBe(128);
  });

  it('deja la propina en cero cuando el pedido no la trae', () => {
    const totals = computeOrderTotals({
      items: [{ quantity: 1, unitPrice: 25 }],
    });

    expect(totals.tip).toBe(0);
    expect(totals.total).toBe(25);
  });
});

describe('computeOrderTotals (costo de delivery opcional)', () => {
  it('suma el delivery al total sin aplicarle IGV', () => {
    const totals = computeOrderTotals({
      items: [{ quantity: 1, unitPrice: 100 }],
      taxRate: 10,
      deliveryFee: 5,
    });

    expect(totals.subtotal).toBe(100);
    expect(totals.tax).toBe(10);
    expect(totals.deliveryFee).toBe(5);
    // 100 + 10% de IGV + 5 de delivery (el delivery no paga IGV).
    expect(totals.total).toBe(115);
  });

  it('suma propina y delivery juntos al final del total', () => {
    const totals = computeOrderTotals({
      items: [{ quantity: 2, unitPrice: 50 }],
      taxRate: 18,
      tip: 10,
      deliveryFee: 3.5,
    });

    expect(totals.tip).toBe(10);
    expect(totals.deliveryFee).toBe(3.5);
    expect(totals.total).toBe(131.5);
  });

  it('deja el delivery en cero cuando el pedido no lo trae', () => {
    const totals = computeOrderTotals({
      items: [{ quantity: 1, unitPrice: 25 }],
    });

    expect(totals.deliveryFee).toBe(0);
    expect(totals.total).toBe(25);
  });
});

describe('OrdersService.addItems (agregar productos a un pedido)', () => {
  it('aisla la busqueda del pedido a la empresa activa', async () => {
    const { service, tx, prisma } = createService(order());

    await service.addItems(
      COMPANY_ID,
      'o1',
      { items: [{ productId: 'p1', quantity: 1 }] },
      'u1',
    );

    // La lectura del pedido y la escritura filtran por companyId.
    expect(prisma.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'o1', companyId: COMPANY_ID }),
      }),
    );
    expect(tx.order.update.mock.calls[0][0].where).toEqual({
      id: 'o1',
      companyId: COMPANY_ID,
    });
  });

  it('fusiona el producto existente, descuenta stock y recalcula los totales', async () => {
    const { service, tx, inventory } = createService(order());

    await service.addItems(
      COMPANY_ID,
      'o1',
      { items: [{ productId: 'p1', quantity: 1 }] },
      'u1',
    );

    const data = updateData(tx);
    // 100 existentes + 50 nuevos = 150 (sin IGV).
    expect(data.subtotal).toBe(150);
    expect(data.tax).toBe(0);
    expect(data.total).toBe(150);
    expect(data.paymentStatus).toBe(PaymentStatus.UNPAID);

    // El producto ya estaba en el pedido: la cantidad se suma en su linea.
    expect(itemsWrite(tx).create).toBeUndefined();
    // La linea sin snapshot hereda el consumo del tramo agregado.
    expect(itemsWrite(tx).update).toEqual([
      {
        where: { id: 'i1' },
        data: {
          quantity: 3,
          total: 150,
          consumption: '[{"productId":"p1","quantity":1}]',
        },
      },
    ]);

    expect(inventory.applyMovement).toHaveBeenCalledTimes(1);
    const movement = inventory.applyMovement.mock.calls[0][1] as {
      productId: string;
      type: string;
      quantity: number;
      referenceType: string;
      referenceId: string;
    };
    expect(movement).toMatchObject({
      productId: 'p1',
      type: StockMovementType.OUT,
      quantity: 1,
      referenceType: StockReferenceType.ORDER,
      referenceId: 'o1',
    });
    // El movimiento participa de la misma transaccion.
    expect(inventory.applyMovement.mock.calls[0][2]).toBe(tx);
  });

  it('conserva el IGV efectivo del pedido al recalcular', async () => {
    const { service, tx } = createService(
      order({ subtotal: 100, tax: 18, total: 118 }),
    );

    await service.addItems(
      COMPANY_ID,
      'o1',
      { items: [{ productId: 'p1', quantity: 1 }] },
      'u1',
    );

    const data = updateData(tx);
    // IGV 18% sobre el nuevo neto de 150 => 27.
    expect(data.subtotal).toBe(150);
    expect(data.tax).toBe(27);
    expect(data.total).toBe(177);
  });

  it('conserva la propina del pedido al recalcular los totales', async () => {
    const { service, tx } = createService(order({ tip: 10, total: 110 }));

    await service.addItems(
      COMPANY_ID,
      'o1',
      { items: [{ productId: 'p1', quantity: 1 }] },
      'u1',
    );

    const data = updateData(tx);
    // 100 existentes + 50 nuevos + 10 de propina (sin IGV).
    expect(data.tip).toBe(10);
    expect(data.subtotal).toBe(150);
    expect(data.total).toBe(160);
  });

  it('conserva el costo de delivery del pedido al recalcular los totales', async () => {
    const { service, tx } = createService(order({ deliveryFee: 3, total: 103 }));

    await service.addItems(
      COMPANY_ID,
      'o1',
      { items: [{ productId: 'p1', quantity: 1 }] },
      'u1',
    );

    const data = updateData(tx);
    // 100 existentes + 50 nuevos + 3 de delivery (sin IGV): el costo no se pierde.
    expect(data.deliveryFee).toBe(3);
    expect(data.total).toBe(153);
  });

  it('marca el pago como PARTIAL cuando ya habia un abono', async () => {
    const { service, tx } = createService(order({ paidAmount: 60 }));

    await service.addItems(
      COMPANY_ID,
      'o1',
      { items: [{ productId: 'p1', quantity: 1 }] },
      'u1',
    );

    const data = updateData(tx);
    expect(data.total).toBe(150);
    expect(data.paymentStatus).toBe(PaymentStatus.PARTIAL);
  });

  it('no descuenta stock de productos sin control de inventario', async () => {
    const { service, tx, inventory } = createService(order());

    await service.addItems(
      COMPANY_ID,
      'o1',
      { items: [{ productId: 'p2', quantity: 1 }] },
      'u1',
    );

    expect(updateData(tx).total).toBe(130);
    expect(inventory.applyMovement).not.toHaveBeenCalled();
  });

  it('rechaza agregar productos a un pedido cancelado', async () => {
    const { service, prisma } = createService(
      order({ status: OrderStatus.CANCELLED }),
    );

    await expect(
      service.addItems(COMPANY_ID, 'o1', { items: [{ productId: 'p1', quantity: 1 }] }, 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it('rechaza agregar productos a un pedido completado', async () => {
    const { service } = createService(order({ status: OrderStatus.COMPLETED }));

    await expect(
      service.addItems(COMPANY_ID, 'o1', { items: [{ productId: 'p1', quantity: 1 }] }, 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lanza NotFound si el pedido no existe', async () => {
    const { service } = createService(null);

    await expect(
      service.addItems(COMPANY_ID, 'nope', { items: [{ productId: 'p1', quantity: 1 }] }, 'u1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rechaza productos inactivos', async () => {
    const { service, tx } = createService(order());

    await expect(
      service.addItems(COMPANY_ID, 'o1', { items: [{ productId: 'p3', quantity: 1 }] }, 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('rechaza productos inexistentes', async () => {
    const { service } = createService(order());

    await expect(
      service.addItems(COMPANY_ID, 'o1', { items: [{ productId: 'ghost', quantity: 1 }] }, 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('crea una linea nueva cuando el producto no estaba en el pedido', async () => {
    const { service, tx } = createService(order());

    await service.addItems(
      COMPANY_ID,
      'o1',
      { items: [{ productId: 'p2', quantity: 1 }] },
      'u1',
    );

    expect(itemsWrite(tx).update).toBeUndefined();
    expect(itemsWrite(tx).create).toEqual([
      {
        companyId: COMPANY_ID,
        productId: 'p2',
        menuId: null,
        name: 'Postre',
        quantity: 1,
        unitPrice: 30,
        total: 30,
        // Un producto suelto se consume a si mismo: 1 unidad por unidad vendida.
        consumption: '[{"productId":"p2","quantity":1}]',
      },
    ]);
    expect(updateData(tx).subtotal).toBe(130);
  });

  it('fusiona las cantidades cuando el producto se repite en la peticion', async () => {
    const { service, tx, inventory } = createService(
      order({ items: [], subtotal: 0, total: 0 }),
    );

    await service.addItems(
      COMPANY_ID,
      'o1',
      {
        items: [
          { productId: 'p1', quantity: 1 },
          { productId: 'p1', quantity: 2 },
        ],
      },
      'u1',
    );

    expect(itemsWrite(tx).create).toEqual([
      {
        companyId: COMPANY_ID,
        productId: 'p1',
        menuId: null,
        name: 'Cafe',
        quantity: 3,
        unitPrice: 50,
        total: 150,
        consumption: '[{"productId":"p1","quantity":1}]',
      },
    ]);
    expect(updateData(tx).subtotal).toBe(150);
    // Una sola salida de stock con la cantidad total agregada.
    expect(inventory.applyMovement).toHaveBeenCalledTimes(1);
    expect(inventory.applyMovement.mock.calls[0][1]).toMatchObject({
      productId: 'p1',
      quantity: 3,
    });
  });

  it('consolida las lineas duplicadas que ya existian en el pedido', async () => {
    const { service, tx } = createService(
      order({
        items: [item(), item({ id: 'i2', quantity: 1, total: 50 })],
        subtotal: 150,
        total: 150,
      }),
    );

    await service.addItems(
      COMPANY_ID,
      'o1',
      { items: [{ productId: 'p1', quantity: 1 }] },
      'u1',
    );

    expect(itemsWrite(tx).update).toEqual([
      {
        where: { id: 'i1' },
        data: {
          quantity: 4,
          total: 200,
          // La fila consolidada aporta su propio tramo de consumo.
          consumption: '[{"productId":"p1","quantity":1}]',
        },
      },
    ]);
    expect(itemsWrite(tx).create).toBeUndefined();
    // La fila repetida se borra para que la suma de lineas cuadre con el total.
    expect(itemsWrite(tx).deleteMany).toEqual([{ id: 'i2' }]);
    expect(updateData(tx).subtotal).toBe(200);
  });

  it('mantiene una linea aparte si el producto se agrega a otro precio', async () => {
    const { service, tx } = createService(order());

    await service.addItems(
      COMPANY_ID,
      'o1',
      { items: [{ productId: 'p1', quantity: 1, unitPrice: 40 }] },
      'u1',
    );

    expect(itemsWrite(tx).create).toEqual([
      {
        companyId: COMPANY_ID,
        productId: 'p1',
        menuId: null,
        name: 'Cafe',
        quantity: 1,
        unitPrice: 40,
        total: 40,
        consumption: '[{"productId":"p1","quantity":1}]',
      },
    ]);
    expect(itemsWrite(tx).update).toBeUndefined();
    expect(updateData(tx).subtotal).toBe(140);
  });

  it('rechaza cuando el nuevo total queda por debajo de lo ya pagado', async () => {
    const { service, tx } = createService(order({ paidAmount: 999 }));

    await expect(
      service.addItems(COMPANY_ID, 'o1', { items: [{ productId: 'p1', quantity: 1 }] }, 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.order.update).not.toHaveBeenCalled();
  });
});

describe('OrdersService.create (costo de delivery)', () => {
  it('guarda el delivery convertido a USD junto a su contexto de moneda', async () => {
    /** Conversion simulada: 1 USD = 36.5 VES (BCV). */
    const rates = {
      resolveAmount: jest.fn(async () => ({
        currency: 'VES',
        exchangeRate: 36.5,
        baseAmount: 7.4,
      })),
    };
    const { service, tx } = createService(null, rates);

    await service.create(
      COMPANY_ID,
      {
        type: OrderType.DELIVERY,
        deliveryFee: 270,
        deliveryFeeCurrency: 'VES',
        deliveryFeeRateKey: 'BCV_USD',
        items: [{ productId: 'p1', quantity: 2 }],
      },
      'u1',
    );

    const data = tx.order.create.mock.calls[0][0].data;
    // 2 cafes a 50 = 100 USD de items + 7.4 USD de delivery (sin IGV).
    expect(data.subtotal).toBe(100);
    expect(data.deliveryFee).toBe(7.4);
    expect(data.deliveryFeeEntered).toBe(270);
    expect(data.deliveryFeeCurrency).toBe('VES');
    expect(data.deliveryFeeRate).toBe(36.5);
    expect(data.deliveryFeeRateKey).toBe('BCV_USD');
    expect(data.total).toBe(107.4);
  });

  it('deja el delivery en cero y sin contexto cuando el pedido no lo trae', async () => {
    const { service, tx } = createService(null);

    await service.create(
      COMPANY_ID,
      { items: [{ productId: 'p2', quantity: 1 }] },
      'u1',
    );

    const data = tx.order.create.mock.calls[0][0].data;
    // 1 postre a 30: sin costo de delivery el pedido queda limpio.
    expect(data.deliveryFee).toBe(0);
    expect(data.deliveryFeeEntered).toBeNull();
    expect(data.deliveryFeeCurrency).toBe('USD');
    expect(data.deliveryFeeRate).toBeNull();
    expect(data.deliveryFeeRateKey).toBeNull();
    expect(data.total).toBe(30);
  });
});


describe('OrdersService.update (costo de delivery)', () => {
  /** Conversion simulada: 1 USD = 36.5 VES (BCV). */
  const rates = {
    resolveAmount: jest.fn(async () => ({
      currency: 'VES',
      exchangeRate: 36.5,
      baseAmount: 7.4,
    })),
  };

  it('convierte el delivery a la moneda base y lo guarda con su contexto', async () => {
    const { service, prisma } = createService(order(), rates);

    await service.update(COMPANY_ID, 'o1', {
      deliveryFee: 270,
      deliveryFeeCurrency: 'VES',
      deliveryFeeRateKey: 'BCV_USD',
    });

    expect(rates.resolveAmount).toHaveBeenCalledWith(
      COMPANY_ID,
      270,
      'VES',
      'BCV_USD',
    );

    const data = prisma.order.update.mock.calls[0][0].data;
    // 100 de items + 7.4 de delivery en USD: el total del pedido es en dolares.
    expect(data.deliveryFee).toBe(7.4);
    expect(data.deliveryFeeEntered).toBe(270);
    expect(data.deliveryFeeCurrency).toBe('VES');
    expect(data.deliveryFeeRate).toBe(36.5);
    expect(data.deliveryFeeRateKey).toBe('BCV_USD');
    expect(data.total).toBe(107.4);
  });

  it('no resuelve ninguna tasa cuando el costo ya viene en USD', async () => {
    const { service, prisma } = createService(order(), { resolveAmount: jest.fn() });

    await service.update(COMPANY_ID, 'o1', { deliveryFee: 3 });

    expect(prisma.order.update.mock.calls[0][0].data.deliveryFee).toBe(3);
    expect(prisma.order.update.mock.calls[0][0].data.total).toBe(103);
  });

  it('conserva el delivery del pedido cuando la peticion no lo menciona', async () => {
    const { service, prisma } = createService(order({ deliveryFee: 3, total: 103 }));

    await service.update(COMPANY_ID, 'o1', { notes: 'Sin cebolla' });

    const data = prisma.order.update.mock.calls[0][0].data;
    expect(data.deliveryFee).toBe(3);
    expect(data.total).toBe(103);
    expect(data.notes).toBe('Sin cebolla');
  });

  it('quita el delivery y su contexto cuando se envia en cero', async () => {
    const { service, prisma } = createService(order({ deliveryFee: 3, total: 103 }));

    await service.update(COMPANY_ID, 'o1', { deliveryFee: 0 });

    const data = prisma.order.update.mock.calls[0][0].data;
    expect(data.deliveryFee).toBe(0);
    expect(data.deliveryFeeEntered).toBeNull();
    expect(data.deliveryFeeRate).toBeNull();
    expect(data.deliveryFeeRateKey).toBeNull();
    expect(data.total).toBe(100);
  });
});


describe('OrdersService.addPayment (tasa de cobro del cajero)', () => {
  /** Conversion simulada: 1 USD = 36.5 VES. */
  const rates = {
    resolvePayment: jest.fn(async () => ({
      currency: 'VES',
      exchangeRate: 36.5,
      baseAmount: 100,
    })),
    /** Sin tasa de cobro el saldo que se puede cobrar es el del pedido. */
    chargeBalance: jest.fn(async (_companyId: string, balance: number) => balance),
  };

  /** Caja abierta: todo cobro impacta un movimiento de ingreso. */
  const cash = {
    getOpenSessionOrThrow: jest.fn(async () => ({ id: 's1' })),
    registerMovement: jest.fn(async () => ({ id: 'mv1' })),
  } as unknown as Partial<CashService>;

  beforeEach(() => {
    rates.resolvePayment.mockClear();
  });

  it('cobra con la tasa de cobro configurada por la empresa', async () => {
    const { service, tx } = createService(order(), rates, cash);

    await service.addPayment(
      COMPANY_ID,
      'o1',
      {
        amount: 3650,
        method: PaymentMethod.CASH,
        currency: 'VES',
        rateKey: 'CUSTOM_USD',
      },
      'u1',
    );

    expect(rates.resolvePayment).toHaveBeenCalledWith(
      COMPANY_ID,
      3650,
      'VES',
      'CUSTOM_USD',
    );

    const payment = tx.orderPayment.create.mock.calls[0][0].data;
    expect(payment.exchangeRate).toBe(36.5);
    expect(payment.baseAmount).toBe(100);
    expect(payment.currency).toBe('VES');
    // El cobro guarda con que tasa se cobro y la foto del dia completa.
    expect(payment.rateKey).toBe('CUSTOM_USD');
    expect(JSON.parse(String(payment.ratesHistory))).toEqual(RATES_HISTORY);
  });

  it('guarda TODAS las tasas del dia en el cobro (no solo la aplicada)', async () => {
    const { service, tx } = createService(order(), rates, cash);

    await service.addPayment(
      COMPANY_ID,
      'o1',
      {
        amount: 3650,
        method: PaymentMethod.CASH,
        currency: 'VES',
        rateKey: 'CUSTOM_USD',
      },
      'u1',
    );

    const payment = tx.orderPayment.create.mock.calls[0][0].data;
    const history = parseRatesHistory(payment.ratesHistory);
    expect(history?.rates.map((rate) => rate.key)).toEqual([
      'BCV_USD',
      'BCV_EUR',
      'CUSTOM_USD',
    ]);
    expect(history?.bcvDate).toBe('2026-10-13');
    expect(history?.activeKey).toBe('CUSTOM_USD');
    expect(history?.stale).toBe(false);
  });

  it('sin tasa elegida el cobro queda sin clave (la activa del sistema)', async () => {
    const { service, tx } = createService(order(), rates, cash);

    await service.addPayment(
      COMPANY_ID,
      'o1',
      { amount: 3650, method: PaymentMethod.CASH, currency: 'VES' },
      'u1',
    );

    const payment = tx.orderPayment.create.mock.calls[0][0].data;
    expect(payment.rateKey).toBeNull();
    expect(parseRatesHistory(payment.ratesHistory)?.rates).toHaveLength(3);
  });

  it('entrega el historial del cobro ya decodificado al leer el pedido', async () => {
    const { service } = createService(
      order({
        payments: [
          {
            id: 'pay1',
            amount: 3650,
            method: PaymentMethod.CASH,
            currency: 'VES',
            exchangeRate: 36.5,
            rateKey: 'CUSTOM_USD',
            ratesHistory: encodeRatesHistory(RATES_HISTORY),
            baseAmount: 100,
            createdAt: '2026-10-13T20:55:00.000Z',
          },
        ],
        paidAmount: 100,
      }),
    );

    const found = await service.findOne(COMPANY_ID, 'o1');

    expect(found.payments?.[0].ratesHistory).toEqual(RATES_HISTORY);
    expect(found.payments?.[0].rateKey).toBe('CUSTOM_USD');
    // El resto del cobro se conserva tal cual.
    expect(found.payments?.[0].baseAmount).toBe(100);
  });

  it('sin tasa elegida cobra con la tasa activa del sistema', async () => {
    const { service } = createService(order(), rates, cash);

    await service.addPayment(
      COMPANY_ID,
      'o1',
      { amount: 3650, method: PaymentMethod.CASH, currency: 'VES' },
      'u1',
    );

    // `null` deja que el modulo de tasas use la personalizada del dolar o el BCV.
    expect(rates.resolvePayment).toHaveBeenCalledWith(COMPANY_ID, 3650, 'VES', null);
  });

  it('descarta una tasa inventada y cobra con la activa', async () => {
    const { service } = createService(order(), rates, cash);

    await service.addPayment(
      COMPANY_ID,
      'o1',
      {
        amount: 3650,
        method: PaymentMethod.CASH,
        currency: 'VES',
        rateKey: 'MALA',
      },
      'u1',
    );

    expect(rates.resolvePayment).toHaveBeenCalledWith(COMPANY_ID, 3650, 'VES', null);
  });

  /**
   * El cajero cobra el precio que LEE en pantalla (los bolivares del pedido) y lo
   * pasa a la moneda del pago con la tasa de cobro: con el BCV por debajo de la
   * tasa personalizada del local, el cobro en divisas vale mas que el total del
   * pedido y no es un exceso.
   */
  it('acepta el cobro en divisas que vale el precio en bolivares de la pantalla', async () => {
    const posRates = {
      resolvePayment: jest.fn(async () => ({
        currency: 'USD',
        exchangeRate: null,
        baseAmount: 110,
      })),
      chargeBalance: jest.fn(async () => 110),
    };
    const { service, tx } = createService(order(), posRates, cash);

    await service.addPayment(
      COMPANY_ID,
      'o1',
      {
        amount: 110,
        method: PaymentMethod.CASH,
        currency: 'USD',
        rateKey: 'BCV_USD',
      },
      'u1',
    );

    expect(posRates.chargeBalance).toHaveBeenCalledWith(COMPANY_ID, 100, 'BCV_USD');
    const payment = tx.orderPayment.create.mock.calls[0][0].data;
    expect(payment.baseAmount).toBe(110);
  });

  it('rechaza el cobro que supera el precio en pantalla', async () => {
    const posRates = {
      resolvePayment: jest.fn(async () => ({
        currency: 'USD',
        exchangeRate: null,
        baseAmount: 130,
      })),
      chargeBalance: jest.fn(async () => 110),
    };
    const { service } = createService(order(), posRates, cash);

    await expect(
      service.addPayment(
        COMPANY_ID,
        'o1',
        {
          amount: 130,
          method: PaymentMethod.CASH,
          currency: 'USD',
          rateKey: 'BCV_USD',
        },
        'u1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('OrdersService.updateItem / removeItem (corregir o quitar productos)', () => {
  it('baja la cantidad y devuelve la diferencia al inventario', async () => {
    const { service, tx, inventory } = createService(order());

    await service.updateItem(COMPANY_ID, 'o1', 'i1', { quantity: 1 }, 'u1');

    const data = updateData(tx);
    expect(data.subtotal).toBe(50);
    expect(data.tax).toBe(0);
    expect(data.total).toBe(50);
    expect(data.paymentStatus).toBe(PaymentStatus.UNPAID);

    expect(itemsWrite(tx).update).toEqual([
      { where: { id: 'i1' }, data: { quantity: 1, total: 50 } },
    ]);
    expect(itemsWrite(tx).create).toBeUndefined();
    expect(itemsWrite(tx).deleteMany).toBeUndefined();

    // Una sola entrada de stock con la unidad quitada, en la misma transaccion.
    expect(inventory.applyMovement).toHaveBeenCalledTimes(1);
    expect(inventory.applyMovement.mock.calls[0][1]).toMatchObject({
      productId: 'p1',
      type: StockMovementType.IN,
      quantity: 1,
      referenceType: StockReferenceType.ORDER,
      referenceId: 'o1',
    });
    expect(inventory.applyMovement.mock.calls[0][2]).toBe(tx);
  });

  it('sube la cantidad, consume la diferencia y recalcula el pago', async () => {
    const { service, tx, inventory } = createService(
      order({ paidAmount: 160 }),
    );

    await service.updateItem(COMPANY_ID, 'o1', 'i1', { quantity: 4 }, 'u1');

    const data = updateData(tx);
    expect(data.total).toBe(200);
    expect(data.paymentStatus).toBe(PaymentStatus.PARTIAL);
    expect(itemsWrite(tx).update).toEqual([
      { where: { id: 'i1' }, data: { quantity: 4, total: 200 } },
    ]);
    expect(inventory.applyMovement.mock.calls[0][1]).toMatchObject({
      productId: 'p1',
      type: StockMovementType.OUT,
      quantity: 2,
    });
  });

  it('conserva el IGV efectivo del pedido al recalcular', async () => {
    const { service, tx } = createService(
      order({ subtotal: 100, tax: 18, total: 118 }),
    );

    await service.updateItem(COMPANY_ID, 'o1', 'i1', { quantity: 1 }, 'u1');

    const data = updateData(tx);
    expect(data.subtotal).toBe(50);
    expect(data.tax).toBe(9);
    expect(data.total).toBe(59);
  });

  it('no escribe nada si la cantidad pedida es la misma', async () => {
    const { service, tx, inventory } = createService(order());

    await service.updateItem(COMPANY_ID, 'o1', 'i1', { quantity: 2 }, 'u1');

    expect(tx.order.update).not.toHaveBeenCalled();
    expect(inventory.applyMovement).not.toHaveBeenCalled();
  });

  it('quita un producto y devuelve su stock al inventario', async () => {
    const { service, tx, inventory } = createService(
      order({
        items: [
          item(),
          item({
            id: 'i2',
            productId: 'p2',
            name: 'Postre',
            quantity: 1,
            unitPrice: 30,
            total: 30,
          }),
        ],
        subtotal: 130,
        total: 130,
      }),
    );

    await service.removeItem(COMPANY_ID, 'o1', 'i1', 'u1');

    const data = updateData(tx);
    expect(data.subtotal).toBe(30);
    expect(data.total).toBe(30);
    expect(itemsWrite(tx).deleteMany).toEqual([{ id: 'i1' }]);
    expect(itemsWrite(tx).update).toBeUndefined();
    expect(inventory.applyMovement).toHaveBeenCalledTimes(1);
    expect(inventory.applyMovement.mock.calls[0][1]).toMatchObject({
      productId: 'p1',
      type: StockMovementType.IN,
      quantity: 2,
      referenceId: 'o1',
    });
  });

  it('no devuelve stock de productos sin control de inventario', async () => {
    const { service, inventory } = createService(
      order({
        items: [
          item({ productId: 'p2', name: 'Postre' }),
          item({ id: 'i2', name: 'Cafe', quantity: 1, unitPrice: 50, total: 50 }),
        ],
        subtotal: 150,
        total: 150,
      }),
    );

    await service.removeItem(COMPANY_ID, 'o1', 'i1', 'u1');

    expect(inventory.applyMovement).not.toHaveBeenCalled();
  });

  it('rechaza quitar el ultimo producto del pedido', async () => {
    const { service, tx } = createService(order());

    await expect(
      service.removeItem(COMPANY_ID, 'o1', 'i1', 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('rechaza modificar los productos de un pedido cancelado o completado', async () => {
    const cancelled = createService(order({ status: OrderStatus.CANCELLED }));

    await expect(
      cancelled.service.removeItem(COMPANY_ID, 'o1', 'i1', 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(cancelled.inventory.applyMovement).not.toHaveBeenCalled();

    const completed = createService(order({ status: OrderStatus.COMPLETED }));

    await expect(
      completed.service.updateItem(COMPANY_ID, 'o1', 'i1', { quantity: 3 }, 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(completed.inventory.applyMovement).not.toHaveBeenCalled();
  });

  it('lanza NotFound si el producto no esta en el pedido', async () => {
    const { service } = createService(order());

    await expect(
      service.removeItem(COMPANY_ID, 'o1', 'ghost', 'u1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.updateItem(COMPANY_ID, 'o1', 'ghost', { quantity: 1 }, 'u1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rechaza dejar el total por debajo de lo ya pagado', async () => {
    const { service, tx } = createService(order({ paidAmount: 120 }));

    await expect(
      service.updateItem(COMPANY_ID, 'o1', 'i1', { quantity: 1 }, 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.order.update).not.toHaveBeenCalled();
  });
});

/**
 * Menu (plato con receta): vender un menu descuenta del inventario cada
 * ingrediente segun su cantidad; los productos sin control de inventario y los
 * menus inactivos no generan movimientos.
 */
describe('OrdersService (menus con receta)', () => {
  it('al vender un menu descuenta cada ingrediente de su receta', async () => {
    const { service, tx, inventory, menus } = createService(order());

    await service.addItems(
      COMPANY_ID,
      'o1',
      { items: [{ menuId: 'm1', quantity: 2 }] },
      'u1',
    );

    // La receta se resuelve por empresa antes de descontar.
    expect(menus.loadRecipes).toHaveBeenCalledWith(COMPANY_ID, ['m1']);

    // La linea guarda la referencia al menu (no a un producto) y su precio.
    expect(itemsWrite(tx).create).toEqual([
      {
        companyId: COMPANY_ID,
        productId: null,
        menuId: 'm1',
        name: 'Parrilla',
        quantity: 2,
        unitPrice: 120,
        total: 240,
        // La receta se congela en la linea: `p2` va aunque no tenga control de
        // inventario, para que la devolucion repita exactamente lo descontado.
        consumption:
          '[{"productId":"p1","quantity":0.5},{"productId":"p2","quantity":1}]',
      },
    ]);

    // 2 parrillas x 0.5 de cafe = 1 unidad; el postre (sin control) no se mueve.
    expect(inventory.applyMovement).toHaveBeenCalledTimes(1);
    expect(inventory.applyMovement.mock.calls[0][1]).toMatchObject({
      productId: 'p1',
      type: StockMovementType.OUT,
      quantity: 1,
      referenceType: StockReferenceType.ORDER,
      referenceId: 'o1',
    });
  });

  it('respeta el precio que se envia para el menu', async () => {
    const { service, tx } = createService(order());

    await service.addItems(
      COMPANY_ID,
      'o1',
      { items: [{ menuId: 'm1', quantity: 1, unitPrice: 99.5 }] },
      'u1',
    );

    expect(itemsWrite(tx).create?.[0]).toMatchObject({
      menuId: 'm1',
      unitPrice: 99.5,
      total: 99.5,
    });
  });

  it('rechaza un menu inexistente', async () => {
    const { service } = createService(order());

    await expect(
      service.addItems(COMPANY_ID, 'o1', { items: [{ menuId: 'nope', quantity: 1 }] }, 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza un menu inactivo', async () => {
    const { service } = createService(order());

    await expect(
      service.addItems(COMPANY_ID, 'o1', { items: [{ menuId: 'm2', quantity: 1 }] }, 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza una linea sin producto ni menu', async () => {
    const { service } = createService(order());

    await expect(
      service.addItems(COMPANY_ID, 'o1', { items: [{ quantity: 1 }] }, 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('quitar un menu del pedido devuelve sus ingredientes al inventario', async () => {
    const { service, tx, inventory } = createService(
      order({
        items: [
          item({
            id: 'i9',
            productId: null,
            menuId: 'm1',
            name: 'Parrilla',
            quantity: 2,
            unitPrice: 120,
            total: 240,
          }),
          item(),
        ],
      }),
    );

    await service.removeItem(COMPANY_ID, 'o1', 'i9', 'u1');

    // Se devuelven las unidades consumidas por las 2 parrillas: 2 x 0.5 = 1.
    expect(inventory.applyMovement).toHaveBeenCalledTimes(1);
    expect(inventory.applyMovement).toHaveBeenCalledWith(
      COMPANY_ID,
      expect.objectContaining({
        productId: 'p1',
        type: StockMovementType.IN,
        quantity: 1,
      }),
      tx,
    );
  });
});
/**
 * La receta de cada linea queda CONGELADA al vender (`OrderItem.consumption`):
 * cancelar el pedido, quitar la linea o corregir la cantidad devuelve lo que
 * realmente se desconto, aunque la receta del menu haya cambiado despues.
 */
describe('OrdersService (consumo de inventario congelado)', () => {
  /** Linea de menu cuyo consumo ya no coincide con la receta vigente (0.5). */
  function frozenMenuItem(
    overrides: Partial<OrderItemFixture> = {},
  ): OrderItemFixture {
    return item({
      productId: null,
      menuId: 'm1',
      name: 'Parrilla',
      quantity: 2,
      unitPrice: 120,
      total: 240,
      consumption: '[{"productId":"p1","quantity":0.25}]',
      ...overrides,
    });
  }

  it('quitar la linea devuelve el consumo congelado, no la receta actual', async () => {
    const { service, inventory, menus } = createService(
      order({
        items: [item(), frozenMenuItem({ id: 'i2' })],
        subtotal: 340,
        total: 340,
      }),
    );

    await service.removeItem(COMPANY_ID, 'o1', 'i2', 'u1');

    // 2 unidades x 0.25 congelado = 0.5 (con la receta vigente serian 1).
    expect(inventory.applyMovement).toHaveBeenCalledTimes(1);
    expect(inventory.applyMovement.mock.calls[0][1]).toMatchObject({
      productId: 'p1',
      type: StockMovementType.IN,
      quantity: 0.5,
    });
    // La linea ya trae su consumo: no hay receta que resolver.
    expect(menus.loadRecipes.mock.calls[0][1]).toEqual([]);
  });

  it('corregir la cantidad devuelve el consumo congelado de la diferencia', async () => {
    const { service, inventory } = createService(
      order({ items: [frozenMenuItem()], subtotal: 240, total: 240 }),
    );

    await service.updateItem(COMPANY_ID, 'o1', 'i1', { quantity: 1 }, 'u1');

    expect(inventory.applyMovement.mock.calls[0][1]).toMatchObject({
      productId: 'p1',
      type: StockMovementType.IN,
      quantity: 0.25,
    });
  });

  it('al subir la cantidad descuenta el tramo nuevo con el consumo congelado', async () => {
    const { service, inventory } = createService(
      order({ items: [frozenMenuItem()], subtotal: 240, total: 240 }),
    );

    await service.updateItem(COMPANY_ID, 'o1', 'i1', { quantity: 3 }, 'u1');

    expect(inventory.applyMovement.mock.calls[0][1]).toMatchObject({
      productId: 'p1',
      type: StockMovementType.OUT,
      quantity: 0.25,
    });
  });

  it('cancelar el pedido devuelve el consumo congelado de cada linea', async () => {
    const { service, inventory, menus } = createService(
      order({
        items: [item(), frozenMenuItem()],
        subtotal: 340,
        total: 340,
        _count: { payments: 0 },
      }),
    );

    await service.updateStatus(
      COMPANY_ID,
      'o1',
      { status: OrderStatus.CANCELLED },
      'u1',
    );

    // Cafe suelto 2 x 1 + menu 2 x 0.25 = 2.5 en una sola devolucion por producto.
    expect(inventory.applyMovement).toHaveBeenCalledTimes(1);
    expect(inventory.applyMovement.mock.calls[0][1]).toMatchObject({
      productId: 'p1',
      type: StockMovementType.IN,
      quantity: 2.5,
    });
    expect(menus.loadRecipes).toHaveBeenCalledWith(COMPANY_ID, [], expect.anything());
  });

  it('pondera el consumo al agregar cantidad a una linea de menu existente', async () => {
    const { service, tx } = createService(
      order({ items: [frozenMenuItem()], subtotal: 240, total: 240 }),
    );

    await service.addItems(
      COMPANY_ID,
      'o1',
      { items: [{ menuId: 'm1', quantity: 2 }] },
      'u1',
    );

    // (2 x 0.25 congelado + 2 x 0.5 vigente) / 4 unidades = 0.375 por unidad.
    expect(itemsWrite(tx).update).toEqual([
      {
        where: { id: 'i1' },
        data: {
          quantity: 4,
          total: 480,
          consumption:
            '[{"productId":"p1","quantity":0.375},{"productId":"p2","quantity":0.5}]',
        },
      },
    ]);
  });

  it('rechaza vender un menu cuya receta usa un producto inactivo', async () => {
    const { service, tx } = createService(
      order({ items: [], subtotal: 0, total: 0 }),
    );

    await expect(
      service.addItems(
        COMPANY_ID,
        'o1',
        { items: [{ menuId: 'm3', quantity: 1 }] },
        'u1',
      ),
    ).rejects.toThrow(/Descontinuado/);
    expect(tx.order.update).not.toHaveBeenCalled();
  });
});

describe('historial de tasas del cobro (JSON de la columna)', () => {
  it('serializa el historial y lo vuelve a leer tal cual', () => {
    const raw = encodeRatesHistory(RATES_HISTORY);

    expect(typeof raw).toBe('string');
    expect(parseRatesHistory(raw)).toEqual(RATES_HISTORY);
    // Un historial ya decodificado (objeto) tambien se acepta.
    expect(parseRatesHistory(RATES_HISTORY)).toEqual(RATES_HISTORY);
  });

  it('devuelve null cuando el historial esta vacio o corrupto', () => {
    expect(parseRatesHistory(null)).toBeNull();
    expect(parseRatesHistory(undefined)).toBeNull();
    expect(parseRatesHistory('')).toBeNull();
    expect(parseRatesHistory('{ no es json')).toBeNull();
    // Sin la lista de tasas no es un historial valido.
    expect(parseRatesHistory('{"capturedAt":"2026-10-13T20:54:00.203Z"}')).toBeNull();
  });

  it('descarta las tasas que no reconoce y completa los datos faltantes', () => {
    const parsed = parseRatesHistory(
      JSON.stringify({
        activeKey: 'MALA',
        rates: [
          { key: 'BCV_USD', source: 'BCV', rate: '876.7976', date: '2026-10-13' },
          { key: 'MALA', rate: 1 },
          { key: 'BCV_EUR', rate: 0 },
        ],
      }),
    );

    expect(parsed?.rates).toEqual([
      {
        key: 'BCV_USD',
        currency: 'USD',
        source: 'BCV',
        rate: 876.7976,
        date: '2026-10-13',
      },
    ]);
    // Sin clave valida el historial cae en la tasa por defecto del sistema.
    expect(parsed?.activeKey).toBe('BCV_USD');
    expect(parsed?.stale).toBe(false);
    expect(parsed?.bcvDate).toBeNull();
  });
});


