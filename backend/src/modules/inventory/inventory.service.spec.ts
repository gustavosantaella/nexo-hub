import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { RatesService } from '../rates/rates.service';
import { InventoryService } from './inventory.service';

const COMPANY_ID = 'company-1';

/** Caja de 24 unidades que se controla en unidades sueltas. */
const CAJA = {
  id: 'p-caja',
  name: 'Malta (caja 24)',
  stock: 48,
  unit: 'CAJA',
  unitsPerBox: 24,
};

/** Carne que se controla en kilos (las recetas consumen 0.1 = 100 g). */
const CARNE = {
  id: 'p-carne',
  name: 'Carne',
  stock: 5,
  unit: 'KG',
  unitsPerBox: 1,
};

function createService(
  product: typeof CAJA | typeof CARNE | null = CAJA,
  ratesOverride: Partial<Record<keyof RatesService, jest.Mock>> = {},
) {
  const prisma = {
    product: {
      findFirst: jest.fn(async () => product),
      findMany: jest.fn(async () => [] as unknown[]),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    stockMovement: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) => ({
        id: 'mv1',
        ...args.data,
      })),
    },
  };
  // Tasas simuladas: 1 USD = 900 Bs.
  const rates = {
    resolveAmount: jest.fn(
      async (_companyId: string, amount: number, currency?: string | null) => ({
        currency: currency ?? 'USD',
        exchangeRate: currency === 'VES' ? 1 : 900,
        baseAmount:
          currency === 'VES' ? Math.round((amount / 900) * 100) / 100 : amount,
      }),
    ),
    ...ratesOverride,
  } as unknown as RatesService;

  const service = new InventoryService(
    prisma as unknown as PrismaService,
    rates,
  );
  return { service, prisma };
}

/** `data` del movimiento creado en la ultima llamada. */
function movementData(prisma: { stockMovement: { create: jest.Mock } }) {
  return prisma.stockMovement.create.mock.calls[0][0].data as Record<
    string,
    unknown
  >;
}

/** `data` del `updateMany` del producto en la ultima llamada. */
function productData(prisma: { product: { updateMany: jest.Mock } }) {
  return prisma.product.updateMany.mock.calls[0][0].data as Record<
    string,
    unknown
  >;
}

/** Argumentos del listado de stock en la ultima llamada. */
function stockQuery(prisma: { product: { findMany: jest.Mock } }) {
  return prisma.product.findMany.mock.calls[0][0] as {
    select: Record<string, unknown>;
  };
}

describe('InventoryService (unidades de entrada)', () => {
  it('descuenta 2 cajas de 24 como 48 unidades', async () => {
    const { service, prisma } = createService();

    const result = await service.applyMovement(COMPANY_ID, {
      productId: 'p-caja',
      type: 'OUT',
      inputUnit: 'CAJA',
      inputQuantity: 2,
    });

    expect(result.stockAfter).toBe(0);
    expect(movementData(prisma)).toMatchObject({
      quantity: 48,
      stockAfter: 0,
      inputUnit: 'CAJA',
      inputQuantity: 2,
    });
    expect(productData(prisma)).toMatchObject({ stock: 0 });
  });

  it('descuenta 750 g de un producto medido en kilos', async () => {
    const { service, prisma } = createService(CARNE);

    const result = await service.applyMovement(COMPANY_ID, {
      productId: 'p-carne',
      type: 'OUT',
      inputUnit: 'G',
      inputQuantity: 750,
    });

    expect(result.stockAfter).toBe(4.25);
    expect(movementData(prisma)).toMatchObject({
      quantity: 0.75,
      inputUnit: 'G',
      inputQuantity: 750,
    });
  });

  it('sigue aceptando la cantidad canonica en la unidad del producto', async () => {
    const { service, prisma } = createService();

    await service.applyMovement(COMPANY_ID, {
      productId: 'p-caja',
      type: 'OUT',
      quantity: 8,
    });

    // Sin `inputUnit` la cantidad se interpreta en unidades de stock (sueltas).
    expect(movementData(prisma)).toMatchObject({
      quantity: 8,
      inputUnit: 'UND',
      inputQuantity: 8,
    });
  });

  it('rechaza el movimiento sin cantidad', async () => {
    const { service } = createService();

    await expect(
      service.applyMovement(COMPANY_ID, { productId: 'p-caja', type: 'OUT' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza un producto de otra empresa', async () => {
    const { service } = createService(null);

    await expect(
      service.applyMovement(COMPANY_ID, {
        productId: 'ajeno',
        type: 'IN',
        quantity: 1,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('impide dejar el stock negativo', async () => {
    const { service } = createService();

    await expect(
      service.applyMovement(COMPANY_ID, {
        productId: 'p-caja',
        type: 'OUT',
        inputUnit: 'CAJA',
        inputQuantity: 3,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('InventoryService (costo unitario con moneda)', () => {
  it('convierte el costo unitario escrito en bolivares y revaloriza la caja', async () => {
    const { service, prisma } = createService();

    await service.create(COMPANY_ID, {
      productId: 'p-caja',
      type: 'IN',
      inputUnit: 'CAJA',
      inputQuantity: 1,
      unitCost: 9000,
      unitCostCurrency: 'VES',
    });

    expect(movementData(prisma)).toMatchObject({
      unitCost: 10,
      unitCostCurrency: 'VES',
      unitCostRate: 1,
      unitCostEntered: 9000,
      quantity: 24,
    });
    // El costo de la presentacion es el unitario x 24 y el stock sube a 72.
    expect(productData(prisma)).toMatchObject({
      stock: 72,
      unitCost: 10,
      cost: 240,
      costCurrency: 'VES',
    });
  });

  it('no toca el costo del producto en las salidas', async () => {
    const { service, prisma } = createService();

    await service.applyMovement(COMPANY_ID, {
      productId: 'p-caja',
      type: 'OUT',
      quantity: 1,
    });

    expect(productData(prisma)).toEqual({ stock: 47 });
  });
});

describe('InventoryService (precio unitario de la entrada)', () => {
  it('ajusta a cuanto se vende la unidad suelta al ingresar mercaderia', async () => {
    const { service, prisma } = createService();

    await service.create(COMPANY_ID, {
      productId: 'p-caja',
      type: 'IN',
      inputUnit: 'CAJA',
      inputQuantity: 1,
      unitPrice: 3150,
      unitPriceCurrency: 'VES',
    });

    // Entra 1 caja (24 unidades) y el precio unitario se guarda en USD con lo
    // que escribio el operador y la tasa usada.
    expect(movementData(prisma)).toMatchObject({ quantity: 24, stockAfter: 72 });
    expect(productData(prisma)).toMatchObject({
      stock: 72,
      unitPrice: 3.5,
      unitPriceEntered: 3150,
      unitPriceCurrency: 'VES',
      unitPriceRate: 1,
    });
    // El precio de la presentacion vive en el catalogo: aqui no se toca.
    expect('price' in productData(prisma)).toBe(false);
  });

  it('deja el precio unitario como estaba cuando no se envia', async () => {
    const { service, prisma } = createService();

    await service.create(COMPANY_ID, {
      productId: 'p-caja',
      type: 'IN',
      inputUnit: 'CAJA',
      inputQuantity: 1,
      unitCost: 5,
    });

    const data = productData(prisma);
    expect('unitPrice' in data).toBe(false);
    expect(data).toMatchObject({ stock: 72, unitCost: 5, cost: 120 });
  });

  it('ignora el precio unitario en las salidas y los ajustes', async () => {
    const { service, prisma } = createService();

    await service.applyMovement(COMPANY_ID, {
      productId: 'p-caja',
      type: 'OUT',
      quantity: 1,
      unitPrice: 3.5,
    });

    expect(productData(prisma)).toEqual({ stock: 47 });
  });
});

describe('InventoryService (stock para el formulario de movimientos)', () => {
  it('devuelve la presentacion y el precio de la unidad suelta', async () => {
    const { service, prisma } = createService();
    prisma.product.findMany.mockResolvedValue([
      {
        id: 'p-caja',
        sku: 'MALTIN-24',
        name: 'Malta (caja 24)',
        stock: 48,
        minStock: 24,
        unit: 'CAJA',
        unitsPerBox: 24,
        unitPrice: 1.5,
        cost: 0.5,
        price: 24,
        category: { id: 'c1', name: 'Bebidas' },
      },
    ]);

    const items = await service.getStockLevels(COMPANY_ID, {});

    // Sin `unitsPerBox` el formulario no puede convertir cajas <-> unidades ni
    // repartir el precio; sin `unitPrice` no sabe a cuanto se vende la suelta.
    expect(stockQuery(prisma).select).toMatchObject({
      unitsPerBox: true,
      unitPrice: true,
    });
    expect(items[0]).toMatchObject({
      unitsPerBox: 24,
      unitPrice: 1.5,
      stockValue: 24,
      isLowStock: false,
    });
  });
});
