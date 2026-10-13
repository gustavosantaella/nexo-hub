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
import type { RatesService } from '../rates/rates.service';
import { OrdersService } from './orders.service';

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
  productId: string;
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
  total: number;
  paidAmount: number;
  items: OrderItemFixture[];
}

/** Linea de ejemplo: 2 cafes a 50 = 100. */
function item(overrides: Partial<OrderItemFixture> = {}): OrderItemFixture {
  return {
    id: 'i1',
    productId: 'p1',
    name: 'Cafe',
    quantity: 2,
    unitPrice: 50,
    total: 100,
    ...overrides,
  };
}

/** Pedido de ejemplo: 2 cafes a 50 = 100, sin impuestos ni pagos. */
function order(overrides: Partial<OrderFixture> = {}): OrderFixture {
  return {
    id: 'o1',
    code: 'PED-20260101-0001',
    status: OrderStatus.PENDING,
    discount: 0,
    subtotal: 100,
    tax: 0,
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

function createService(current: OrderFixture | null) {
  const tx = {
    order: {
      update: jest.fn(async (args: UpdateArgs) => ({
        id: args.where.id,
        ...args.data,
      })),
    },
  };

  const prisma = {
    order: { findUnique: jest.fn(async () => current) },
    product: {
      findMany: jest.fn(async (args: { where: { id: { in: string[] } } }) =>
        args.where.id.in
          .filter((id) => PRODUCTS[id])
          .map((id) => PRODUCTS[id]),
      ),
    },
    $transaction: jest.fn(
      async (cb: (client: typeof tx) => Promise<unknown>) => cb(tx),
    ),
  };

  const inventory = {
    applyMovement: jest.fn(async (_input: unknown, _tx?: unknown) => ({
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
  );

  return { service, prisma, tx, inventory };
}

/** Datos enviados a `tx.order.update` en la primera llamada. */
function updateData(tx: {
  order: { update: jest.Mock };
}): Record<string, unknown> {
  return tx.order.update.mock.calls[0][0].data;
}

interface ItemsWrite {
  create?: {
    productId: string;
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


describe('OrdersService.addItems (agregar productos a un pedido)', () => {
  it('fusiona el producto existente, descuenta stock y recalcula los totales', async () => {
    const { service, tx, inventory } = createService(order());

    await service.addItems(
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
    const movement = inventory.applyMovement.mock.calls[0][0] as {
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
    expect(inventory.applyMovement.mock.calls[0][1]).toBe(tx);
  });

  it('conserva el IGV efectivo del pedido al recalcular', async () => {
    const { service, tx } = createService(
      order({ subtotal: 100, tax: 18, total: 118 }),
    );

    await service.addItems(
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

  it('marca el pago como PARTIAL cuando ya habia un abono', async () => {
    const { service, tx } = createService(order({ paidAmount: 60 }));

    await service.addItems(
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
      service.addItems('o1', { items: [{ productId: 'p1', quantity: 1 }] }, 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it('rechaza agregar productos a un pedido completado', async () => {
    const { service } = createService(order({ status: OrderStatus.COMPLETED }));

    await expect(
      service.addItems('o1', { items: [{ productId: 'p1', quantity: 1 }] }, 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lanza NotFound si el pedido no existe', async () => {
    const { service } = createService(null);

    await expect(
      service.addItems('nope', { items: [{ productId: 'p1', quantity: 1 }] }, 'u1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rechaza productos inactivos', async () => {
    const { service, tx } = createService(order());

    await expect(
      service.addItems('o1', { items: [{ productId: 'p3', quantity: 1 }] }, 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('rechaza productos inexistentes', async () => {
    const { service } = createService(order());

    await expect(
      service.addItems('o1', { items: [{ productId: 'ghost', quantity: 1 }] }, 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('crea una linea nueva cuando el producto no estaba en el pedido', async () => {
    const { service, tx } = createService(order());

    await service.addItems(
      'o1',
      { items: [{ productId: 'p2', quantity: 1 }] },
      'u1',
    );

    expect(itemsWrite(tx).update).toBeUndefined();
    expect(itemsWrite(tx).create).toEqual([
      { productId: 'p2', name: 'Postre', quantity: 1, unitPrice: 30, total: 30 },
    ]);
    expect(updateData(tx).subtotal).toBe(130);
  });

  it('fusiona las cantidades cuando el producto se repite en la peticion', async () => {
    const { service, tx, inventory } = createService(
      order({ items: [], subtotal: 0, total: 0 }),
    );

    await service.addItems(
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
      { productId: 'p1', name: 'Cafe', quantity: 3, unitPrice: 50, total: 150 },
    ]);
    expect(updateData(tx).subtotal).toBe(150);
    // Una sola salida de stock con la cantidad total agregada.
    expect(inventory.applyMovement).toHaveBeenCalledTimes(1);
    expect(inventory.applyMovement.mock.calls[0][0]).toMatchObject({
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
      'o1',
      { items: [{ productId: 'p1', quantity: 1, unitPrice: 40 }] },
      'u1',
    );

    expect(itemsWrite(tx).create).toEqual([
      { productId: 'p1', name: 'Cafe', quantity: 1, unitPrice: 40, total: 40 },
    ]);
    expect(itemsWrite(tx).update).toBeUndefined();
    expect(updateData(tx).subtotal).toBe(140);
  });

  it('rechaza cuando el nuevo total queda por debajo de lo ya pagado', async () => {
    const { service, tx } = createService(order({ paidAmount: 999 }));

    await expect(
      service.addItems('o1', { items: [{ productId: 'p1', quantity: 1 }] }, 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.order.update).not.toHaveBeenCalled();
  });
});

describe('OrdersService.updateItem / removeItem (corregir o quitar productos)', () => {
  it('baja la cantidad y devuelve la diferencia al inventario', async () => {
    const { service, tx, inventory } = createService(order());

    await service.updateItem('o1', 'i1', { quantity: 1 }, 'u1');

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
    expect(inventory.applyMovement.mock.calls[0][0]).toMatchObject({
      productId: 'p1',
      type: StockMovementType.IN,
      quantity: 1,
      referenceType: StockReferenceType.ORDER,
      referenceId: 'o1',
    });
    expect(inventory.applyMovement.mock.calls[0][1]).toBe(tx);
  });

  it('sube la cantidad, consume la diferencia y recalcula el pago', async () => {
    const { service, tx, inventory } = createService(
      order({ paidAmount: 160 }),
    );

    await service.updateItem('o1', 'i1', { quantity: 4 }, 'u1');

    const data = updateData(tx);
    expect(data.total).toBe(200);
    expect(data.paymentStatus).toBe(PaymentStatus.PARTIAL);
    expect(itemsWrite(tx).update).toEqual([
      { where: { id: 'i1' }, data: { quantity: 4, total: 200 } },
    ]);
    expect(inventory.applyMovement.mock.calls[0][0]).toMatchObject({
      productId: 'p1',
      type: StockMovementType.OUT,
      quantity: 2,
    });
  });

  it('conserva el IGV efectivo del pedido al recalcular', async () => {
    const { service, tx } = createService(
      order({ subtotal: 100, tax: 18, total: 118 }),
    );

    await service.updateItem('o1', 'i1', { quantity: 1 }, 'u1');

    const data = updateData(tx);
    expect(data.subtotal).toBe(50);
    expect(data.tax).toBe(9);
    expect(data.total).toBe(59);
  });

  it('no escribe nada si la cantidad pedida es la misma', async () => {
    const { service, tx, inventory } = createService(order());

    await service.updateItem('o1', 'i1', { quantity: 2 }, 'u1');

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

    await service.removeItem('o1', 'i1', 'u1');

    const data = updateData(tx);
    expect(data.subtotal).toBe(30);
    expect(data.total).toBe(30);
    expect(itemsWrite(tx).deleteMany).toEqual([{ id: 'i1' }]);
    expect(itemsWrite(tx).update).toBeUndefined();
    expect(inventory.applyMovement).toHaveBeenCalledTimes(1);
    expect(inventory.applyMovement.mock.calls[0][0]).toMatchObject({
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

    await service.removeItem('o1', 'i1', 'u1');

    expect(inventory.applyMovement).not.toHaveBeenCalled();
  });

  it('rechaza quitar el ultimo producto del pedido', async () => {
    const { service, tx } = createService(order());

    await expect(
      service.removeItem('o1', 'i1', 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('rechaza modificar los productos de un pedido cancelado o completado', async () => {
    const cancelled = createService(order({ status: OrderStatus.CANCELLED }));

    await expect(
      cancelled.service.removeItem('o1', 'i1', 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(cancelled.inventory.applyMovement).not.toHaveBeenCalled();

    const completed = createService(order({ status: OrderStatus.COMPLETED }));

    await expect(
      completed.service.updateItem('o1', 'i1', { quantity: 3 }, 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(completed.inventory.applyMovement).not.toHaveBeenCalled();
  });

  it('lanza NotFound si el producto no esta en el pedido', async () => {
    const { service } = createService(order());

    await expect(
      service.removeItem('o1', 'ghost', 'u1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.updateItem('o1', 'ghost', { quantity: 1 }, 'u1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rechaza dejar el total por debajo de lo ya pagado', async () => {
    const { service, tx } = createService(order({ paidAmount: 120 }));

    await expect(
      service.updateItem('o1', 'i1', { quantity: 1 }, 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.order.update).not.toHaveBeenCalled();
  });
});

