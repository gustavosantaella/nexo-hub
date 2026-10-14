import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { InventoryService } from '../inventory/inventory.service';
import type { RatesService } from '../rates/rates.service';
import { ProductsService } from './products.service';

const COMPANY_ID = 'company-1';

/** Producto de ejemplo que ya existe en la empresa activa. */
const PRODUCT = {
  id: 'p1',
  companyId: COMPANY_ID,
  sku: 'BEB-001',
  name: 'Gaseosa 500ml',
  price: 4,
  priceCurrency: 'USD',
  priceEntered: 4,
  priceRate: 900,
  cost: 2,
  costCurrency: 'USD',
  costEntered: 2,
  costRate: 900,
  unitCost: 2,
  unitCostEntered: 2,
  unitCostCurrency: 'USD',
  unitCostRate: 900,
  // Precio de venta de la unidad suelta (0 = sin definir: se reparte la caja).
  unitPrice: 0,
  unitPriceEntered: null as number | null,
  unitPriceCurrency: 'USD',
  unitPriceRate: null as number | null,
  stock: 10,
  minStock: 2,
  unit: 'UND',
  unitsPerBox: 1,
  trackStock: true,
  active: true,
  categoryId: 'cat1',
  supplierId: null,
  imageUrl: null,
  // Tasa elegida para cada monto (producto anterior a esas columnas = `null`).
  priceRateKey: null as string | null,
  costRateKey: null as string | null,
  unitCostRateKey: null as string | null,
};

interface UpdateArgs {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
}

/**
 * Prisma simulado: `findFirst` resuelve el producto (o `null`) y `update` es un
 * espia para poder inspeccionar el `where`/`data` que arma el servicio.
 */
function createService(
  product: typeof PRODUCT | null = PRODUCT,
  ratesOverride: Partial<Record<keyof RatesService, jest.Mock>> = {},
  /** Menus que usan el producto como ingrediente (para la baja logica). */
  menuIngredients: { menu: { id: string; code: string; name: string } }[] = [],
) {
  const prisma = {
    product: {
      // La busqueda por `sku` (unicidad / generacion) no encuentra nada; el
      // producto se resuelve por id (lo que usa `findOne`).
      findFirst: jest.fn(async (args?: { where?: Record<string, unknown> }) =>
        args?.where && 'sku' in args.where ? null : product,
      ),
      create: jest.fn(async (args: { data: Record<string, unknown> }) => ({
        ...product,
        ...args.data,
      })),
      update: jest.fn(async (args: UpdateArgs) => ({ ...product, ...args.data })),
      updateMany: jest.fn(async () => ({ count: 1 })),
      findMany: jest.fn(async (_args: { where: Record<string, unknown> }) =>
        product ? [product] : [],
      ),
      count: jest.fn(async () => (product ? 1 : 0)),
    },
    // Recetas que referencian al producto (solo los menus ACTIVOS bloquean).
    menuIngredient: {
      findMany: jest.fn(async () => menuIngredients),
    },
    category: {
      findFirst: jest.fn(async () => ({ id: 'cat1' })),
      // Subcategorias de la categoria filtrada en el listado.
      findMany: jest.fn(async () => [{ id: 'cat1-child' }]),
    },
    supplier: {
      findFirst: jest.fn(async () => ({ id: 'sup1' })),
    },
    $transaction: jest.fn(async (arg: unknown) =>
      Promise.all(arg as Promise<unknown>[]),
    ),
  };
  const inventory = {
    applyMovement: jest.fn(async () => ({
      movement: { id: 'mv1' },
      stockBefore: 0,
      stockAfter: 1,
    })),
  } as unknown as InventoryService;
  // Tasas simuladas: 1 USD = 900 Bs y la moneda local vale 1 Bs.
  const rates = {
    resolveAmount: jest.fn(
      async (_companyId: string, amount: number, currency?: string | null) => ({
        currency: currency ?? 'USD',
        exchangeRate: currency === 'VES' ? 1 : 900,
        baseAmount: currency === 'VES' ? Math.round((amount / 900) * 100) / 100 : amount,
      }),
    ),
    toCurrencyAmount: jest.fn(
      async (_companyId: string, amount: number, currency?: string | null) =>
        currency === 'VES' ? amount * 900 : amount,
    ),
    ...ratesOverride,
  } as unknown as RatesService;
  const service = new ProductsService(
    prisma as unknown as PrismaService,
    inventory,
    rates,
  );
  return { service, prisma, inventory, rates };
}

describe('ProductsService.update', () => {
  /**
   * Regresion: `updateMany` no admite escrituras de relacion, asi que enlazar
   * la categoria/proveedor debe hacerse con `update` (filtrado por empresa),
   * de lo contrario el PATCH respondia 500 (PrismaClientValidationError).
   */
  it('enlaza la categoria con `update` (no `updateMany`) para no romper el PATCH', async () => {
    const { service, prisma } = createService();

    await service.update(COMPANY_ID, 'p1', { categoryId: 'cat1' });

    expect(prisma.product.updateMany).not.toHaveBeenCalled();
    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1', companyId: COMPANY_ID },
        data: expect.objectContaining({
          category: { connect: { id: 'cat1' } },
        }),
      }),
    );
  });

  it('desconecta la categoria cuando llega como `null`', async () => {
    const { service, prisma } = createService();

    // El frontend envia `null` para quitar la categoria (el DTO lo acepta con
    // `@IsOptional`, aunque su tipo declare solo `string`).
    await service.update(COMPANY_ID, 'p1', {
      categoryId: null as unknown as string,
    });

    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ category: { disconnect: true } }),
      }),
    );
  });

  it('normaliza una foto vacia a `null`', async () => {
    const { service, prisma } = createService();

    await service.update(COMPANY_ID, 'p1', { imageUrl: '   ' });

    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ imageUrl: null }),
      }),
    );
  });

  it('guarda las unidades por caja como escalar (no como dinero)', async () => {
    const { service, prisma } = createService();

    await service.update(COMPANY_ID, 'p1', { unitsPerBox: 24 });

    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ unitsPerBox: 24 }),
      }),
    );
  });

  it('rechaza el producto que no pertenece a la empresa activa', async () => {
    const { service, prisma } = createService(null);

    await expect(
      service.update(COMPANY_ID, 'ajeno', { name: 'Otro' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.product.update).not.toHaveBeenCalled();
  });
});

describe('ProductsService (moneda de los precios)', () => {
  it('crea el producto con el precio en USD y su contexto de moneda', async () => {
    const { service, prisma } = createService();

    await service.create(COMPANY_ID, { name: 'Pizza', price: 12 } as never);

    expect(prisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          price: 12,
          priceCurrency: 'USD',
          priceEntered: 12,
          priceRate: 900,
        }),
      }),
    );
  });

  it('convierte a USD el precio escrito en bolivares y guarda lo que se escribio', async () => {
    const { service, prisma } = createService();

    await service.create(COMPANY_ID, {
      name: 'Pizza',
      price: 9000,
      priceCurrency: 'VES',
      cost: 4500,
      costCurrency: 'VES',
    } as never);

    const data = prisma.product.create.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    // 9.000 Bs a 900 Bs/USD son 10 USD.
    expect(data).toMatchObject({
      price: 10,
      priceCurrency: 'VES',
      priceEntered: 9000,
      priceRate: 1,
      cost: 5,
      costCurrency: 'VES',
      costEntered: 4500,
    });
    // El costo unitario se reparte (1 unidad) y sale del costo en bolivares.
    expect(data.unitCost).toBe(5);
    expect(data.unitCostEntered).toBe(4500);
    expect(data.unitCostCurrency).toBe('VES');
    expect(data.unitCostRate).toBe(1);
  });

  /**
   * El precio de venta de la unidad suelta es independiente del precio de la
   * presentacion: se guarda en USD con SU moneda y SU tasa (si el DTO no lo manda,
   * queda en 0 = sin definir y la venta suelta reparte el precio de la caja).
   */
  it('guarda el precio unitario en su propia moneda y tasa', async () => {
    const { service, prisma } = createService();

    await service.create(COMPANY_ID, {
      name: 'Malta (caja 24)',
      price: 72,
      priceCurrency: 'USD',
      cost: 60,
      unitPrice: 3150,
      unitPriceCurrency: 'VES',
      unitPriceRateKey: 'BCV_EUR',
      unit: 'CAJA',
      unitsPerBox: 24,
    } as never);

    const data = prisma.product.create.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    // 3.150 Bs a 900 Bs/USD son 3,5 USD: el precio de la CAJA no se toca.
    expect(data).toMatchObject({
      price: 72,
      priceCurrency: 'USD',
      unitPrice: 3.5,
      unitPriceEntered: 3150,
      unitPriceCurrency: 'VES',
      unitPriceRate: 1,
      unitPriceRateKey: 'BCV_EUR',
    });
  });

  it('deja el precio unitario en 0 cuando el producto no lo define', async () => {
    const { service, prisma } = createService();

    await service.create(COMPANY_ID, {
      name: 'Malta (caja 24)',
      price: 24,
      unit: 'CAJA',
      unitsPerBox: 24,
    } as never);

    const data = prisma.product.create.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    // Sin precio unitario no se inventa un reparto: la interfaz lo deriva.
    expect(data.unitPrice).toBe(0);
    expect(data.price).toBe(24);
  });

  it('reparte el costo unitario entre las unidades de la caja', async () => {
    const { service, prisma } = createService();

    await service.create(COMPANY_ID, {
      name: 'Malta (caja 24)',
      price: 24,
      cost: 12,
      unit: 'CAJA',
      unitsPerBox: 24,
    } as never);

    const data = prisma.product.create.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    expect(data.cost).toBe(12);
    expect(data.unitCost).toBe(0.5);
  });

  /**
   * Cada monto del catalogo tiene su propia moneda: el costo de la presentacion y
   * el costo unitario se pueden escribir en monedas distintas (ej. la caja viene
   * cotizada en dolares y la unidad suelta en bolivares).
   */
  it('guarda el costo unitario en su propia moneda (distinta a la presentacion)', async () => {
    const { service, prisma } = createService();

    await service.create(COMPANY_ID, {
      name: 'Malta (caja 24)',
      price: 24,
      cost: 12,
      costCurrency: 'USD',
      unitCost: 450,
      unitCostCurrency: 'VES',
      unit: 'CAJA',
      unitsPerBox: 24,
    } as never);

    const data = prisma.product.create.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    expect(data).toMatchObject({
      cost: 12,
      costCurrency: 'USD',
      costEntered: 12,
      costRate: 900,
      // 450 Bs a 900 Bs/USD son 0,50 USD por unidad suelta.
      unitCost: 0.5,
      unitCostEntered: 450,
      unitCostCurrency: 'VES',
      unitCostRate: 1,
    });
  });

  it('valora el stock inicial con el costo unitario (no el de la caja)', async () => {
    const { service, inventory } = createService();

    await service.create(COMPANY_ID, {
      name: 'Malta (caja 24)',
      price: 24,
      cost: 12,
      stock: 48,
      unit: 'CAJA',
      unitsPerBox: 24,
    } as never);

    expect(inventory.applyMovement).toHaveBeenCalledWith(
      COMPANY_ID,
      expect.objectContaining({ quantity: 48, unitCost: 0.5 }),
    );
  });

  it('guarda el costo unitario escrito por el usuario y recalcula la presentacion', async () => {
    const { service, prisma } = createService();

    await service.update(COMPANY_ID, 'p1', {
      unitCost: 1.25,
      unitsPerBox: 24,
    });

    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          unitCost: 1.25,
          unitCostEntered: 1.25,
          unitCostCurrency: 'USD',
          unitCostRate: 900,
          cost: 30,
          costCurrency: 'USD',
          costRate: 900,
        }),
      }),
    );
  });

  /**
   * Los dos costos viajan juntos desde el formulario (cada uno con SU moneda): el
   * servicio no debe pisar ninguno de los dos montos.
   */
  it('respeta los dos montos y sus monedas cuando llegan juntos', async () => {
    const { service, prisma } = createService();

    await service.update(COMPANY_ID, 'p1', {
      cost: 12,
      costCurrency: 'USD',
      unitCost: 450,
      unitCostCurrency: 'VES',
      unitsPerBox: 24,
    });

    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cost: 12,
          costEntered: 12,
          costCurrency: 'USD',
          unitCost: 0.5,
          unitCostEntered: 450,
          unitCostCurrency: 'VES',
          unitCostRate: 1,
        }),
      }),
    );
  });

  it('deriva la presentacion en la moneda del costo unitario cuando solo llega ese monto', async () => {
    const { service, prisma } = createService();

    await service.update(COMPANY_ID, 'p1', {
      unitCost: 450,
      unitCostCurrency: 'VES',
      unitsPerBox: 24,
    });

    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          // 450 Bs (0,50 USD) x 24 unidades = 12.000 Bs.
          unitCost: 0.5,
          unitCostEntered: 450,
          unitCostCurrency: 'VES',
          cost: 12,
          costEntered: 10800,
          costCurrency: 'VES',
          costRate: 1,
        }),
      }),
    );
  });

  it('deriva el costo unitario del costo de la presentacion', async () => {
    const { service, prisma } = createService();

    await service.update(COMPANY_ID, 'p1', { cost: 30, unitsPerBox: 10 });

    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ unitCost: 3, unitCostEntered: 3 }),
      }),
    );
  });

  it('re-expresa el precio cuando solo cambia la moneda', async () => {
    const { service, prisma } = createService();

    await service.update(COMPANY_ID, 'p1', { priceCurrency: 'VES' });

    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          priceCurrency: 'VES',
          price: 4,
          priceEntered: 3600,
          priceRate: 1,
        }),
      }),
    );
  });

  /**
   * El operador tambien elige la TASA con la que se convierte cada monto: el
   * servicio la manda al motor de tasas (es la que hace la conversion) y la
   * guarda para que el formulario la recupere al reabrirse.
   */
  it('guarda la tasa elegida de cada monto y la usa para convertir', async () => {
    const { service, prisma, rates } = createService();

    await service.create(COMPANY_ID, {
      name: 'Malta (caja 24)',
      price: 900,
      priceCurrency: 'VES',
      priceRateKey: 'BCV_EUR',
      cost: 12,
      costRateKey: 'BCV_USD',
      unitCost: 450,
      unitCostCurrency: 'VES',
      unitCostRateKey: 'CUSTOM_USD',
      unit: 'CAJA',
      unitsPerBox: 24,
    } as never);

    const data = prisma.product.create.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    expect(data).toMatchObject({
      priceRateKey: 'BCV_EUR',
      costRateKey: 'BCV_USD',
      unitCostRateKey: 'CUSTOM_USD',
    });
    // Cada monto viaja con SU tasa (son independientes).
    expect(rates.resolveAmount).toHaveBeenCalledWith(
      COMPANY_ID,
      900,
      'VES',
      'BCV_EUR',
    );
    expect(rates.resolveAmount).toHaveBeenCalledWith(
      COMPANY_ID,
      450,
      'VES',
      'CUSTOM_USD',
    );
  });

  it('se queda con la tasa guardada cuando el DTO no manda ninguna', async () => {
    const { service, prisma, rates } = createService({
      ...PRODUCT,
      priceCurrency: 'VES',
      priceEntered: 3600,
      priceRate: 1,
      priceRateKey: 'BCV_EUR',
    });

    await service.update(COMPANY_ID, 'p1', { price: 9000 });

    expect(rates.resolveAmount).toHaveBeenCalledWith(
      COMPANY_ID,
      9000,
      'VES',
      'BCV_EUR',
    );
    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          priceEntered: 9000,
          priceRateKey: 'BCV_EUR',
        }),
      }),
    );
  });

  it('recalcula el monto cuando solo cambia la tasa elegida', async () => {
    const { service, prisma, rates } = createService({
      ...PRODUCT,
      priceCurrency: 'VES',
      priceEntered: 3600,
      priceRate: 1,
      priceRateKey: 'BCV_USD',
    });

    // Mismo monto y misma moneda: solo la tasa cambia el equivalente en USD.
    await service.update(COMPANY_ID, 'p1', { priceRateKey: 'BCV_EUR' });

    // Al no venir el monto, se re-expresa el valor guardado con la tasa nueva.
    expect(rates.toCurrencyAmount).toHaveBeenCalledWith(
      COMPANY_ID,
      4,
      'VES',
      'BCV_EUR',
    );
    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          price: 4,
          priceRateKey: 'BCV_EUR',
        }),
      }),
    );
  });

  it('cambia la tasa del costo unitario sin reinterpretar la presentacion', async () => {
    const { service, prisma } = createService({
      ...PRODUCT,
      cost: 12,
      unitCost: 0.5,
      unitCostCurrency: 'VES',
      unitCostEntered: 450,
      unitCostRate: 1,
      unitCostRateKey: 'BCV_USD',
      unit: 'CAJA',
      unitsPerBox: 24,
    });

    await service.update(COMPANY_ID, 'p1', { unitCostRateKey: 'BCV_EUR' });

    const data = prisma.product.update.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    expect(data.unitCostRateKey).toBe('BCV_EUR');
    expect(data.unitCostEntered).toBe(450);
    // La presentacion conserva SU costo: las tasas son independientes por monto.
    expect(data.cost).toBeUndefined();
    expect(data.costRateKey).toBeUndefined();
  });

  /**
   * El precio de venta de la unidad suelta se edita por su lado: cambiar cuanto se
   * cobra la suelta NO recalcula el precio de la caja (son dos decisiones del
   * operador) ni toca el costo.
   */
  it('cambia el precio unitario sin tocar el de la presentacion', async () => {
    const { service, prisma } = createService({
      ...PRODUCT,
      price: 72,
      priceEntered: 72,
      unit: 'CAJA',
      unitsPerBox: 24,
    });

    await service.update(COMPANY_ID, 'p1', { unitPrice: 3.5 });

    const data = prisma.product.update.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    expect(data.unitPrice).toBe(3.5);
    expect(data.unitPriceEntered).toBe(3.5);
    expect(data.unitPriceCurrency).toBe('USD');
    expect(data.unitPriceRate).toBe(900);
    expect(data.price).toBeUndefined();
    expect(data.cost).toBeUndefined();
  });

  it('convierte a USD el precio unitario escrito en bolivares', async () => {
    const { service, prisma } = createService({
      ...PRODUCT,
      price: 72,
      unit: 'CAJA',
      unitsPerBox: 24,
    });

    await service.update(COMPANY_ID, 'p1', {
      unitPrice: 3150,
      unitPriceCurrency: 'VES',
      unitPriceRateKey: 'BCV_USD',
    });

    const data = prisma.product.update.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    // 3.150 Bs a 900 Bs/USD son 3,5 USD.
    expect(data.unitPrice).toBe(3.5);
    expect(data.unitPriceEntered).toBe(3150);
    expect(data.unitPriceCurrency).toBe('VES');
    expect(data.unitPriceRate).toBe(1);
    expect(data.unitPriceRateKey).toBe('BCV_USD');
  });

  it('vuelve a 0 el precio unitario cuando el producto deja de ser presentacion', async () => {
    const { service, prisma } = createService({
      ...PRODUCT,
      price: 72,
      unit: 'CAJA',
      unitsPerBox: 24,
      unitPrice: 3.5,
      unitPriceEntered: 3.5,
      unitPriceRate: 900,
    });

    await service.update(COMPANY_ID, 'p1', { unitPrice: 0, unitsPerBox: 1 });

    const data = prisma.product.update.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    // Sin precio unitario la interfaz vuelve a repartir `price / unitsPerBox`.
    expect(data.unitPrice).toBe(0);
    expect(data.unitPriceEntered).toBe(0);
  });
});

/**
 * Baja logica: desactivar un producto no lo quita de las recetas que ya lo usan,
 * pero esos menus quedan sin poder venderse. El API avisa en `affectedMenus`.
 */
describe('ProductsService.remove', () => {
  it('avisa que menus activos quedan sin poder venderse', async () => {
    const { service, prisma } = createService(PRODUCT, {}, [
      { menu: { id: 'm1', code: 'MEN-0001', name: 'Parrilla' } },
      { menu: { id: 'm2', code: 'MEN-0002', name: 'Combo' } },
    ]);

    const result = await service.remove(COMPANY_ID, 'p1');

    expect(result).toEqual({
      count: 1,
      affectedMenus: [
        { id: 'm1', code: 'MEN-0001', name: 'Parrilla' },
        { id: 'm2', code: 'MEN-0002', name: 'Combo' },
      ],
    });
    // Solo los menus ACTIVOS se reportan: los inactivos no se venden igual.
    expect(prisma.menuIngredient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { productId: 'p1', companyId: COMPANY_ID, menu: { active: true } },
      }),
    );
    expect(prisma.product.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', companyId: COMPANY_ID },
      data: { active: false },
    });
  });

  it('desactiva el producto sin afectar menus cuando no esta en ninguna receta', async () => {
    const { service } = createService();

    await expect(service.remove(COMPANY_ID, 'p1')).resolves.toEqual({
      count: 1,
      affectedMenus: [],
    });
  });

  it('rechaza el producto que no pertenece a la empresa activa', async () => {
    const { service, prisma } = createService(null);

    await expect(service.remove(COMPANY_ID, 'p1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.product.updateMany).not.toHaveBeenCalled();
  });
});

describe('ProductsService.findAll', () => {
  /**
   * Las subcategorias son opcionales, pero filtrar por la principal debe traer
   * tambien lo agrupado en ellas (elegir "Bebidas" incluye "Refrescos").
   */
  it('trae tambien los productos de las subcategorias al filtrar por la principal', async () => {
    const { service, prisma } = createService();
    const query = {
      page: 1,
      limit: 20,
      categoryId: 'cat1',
      toOrderBy: () => ({ name: 'asc' }),
    } as never;

    await service.findAll(COMPANY_ID, query);

    expect(prisma.category.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { parentId: 'cat1', companyId: COMPANY_ID },
      }),
    );
    expect(prisma.product.findMany.mock.calls[0][0].where.categoryId).toEqual({
      in: ['cat1', 'cat1-child'],
    });
  });
});
