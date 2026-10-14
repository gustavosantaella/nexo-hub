import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  OrderStatus,
  PaymentStatus,
  StockMovementType,
  StockReferenceType,
} from '../../common/constants/enums';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CashService } from '../cash/cash.service';
import type { InventoryService } from '../inventory/inventory.service';
import type { MenusService } from '../menus/menus.service';
import type { RatesService } from '../rates/rates.service';
import { OrdersService, computeOrderTotals } from './orders.service';

const COMPANY_ID = 'company-1';

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
}

interface OrderFixture {
  id: string;
  code: string;
  status: string;
  discount: number;
  subtotal: number;
  tax: number;
  tip: number;
  total: number;
  paidAmount: number;
  items: OrderItemFixture[];
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
  ingredients: { productId: string; quantity: number }[];
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
      { productId: 'p1', quantity: 0.5 },
      { productId: 'p2', quantity: 1 },
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
};

function createService(current: OrderFixture | null) {
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
    },
    product: { findMany: trackedProducts },
  };

  const prisma = {
    order: { findFirst: jest.fn(async () => current) },
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
    {} as unknown as CashService,
    {} as unknown as RatesService,
    menus as unknown as MenusService,
  );

  return { service, prisma, tx, inventory, menus };
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
  }[];
  update?: { where: { id: string }; data: { quantity: number; total: number } }[];
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
    expect(itemsWrite(tx).update).toEqual([
      { where: { id: 'i1' }, data: { quantity: 3, total: 150 } },
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
      { where: { id: 'i1' }, data: { quantity: 4, total: 200 } },
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

