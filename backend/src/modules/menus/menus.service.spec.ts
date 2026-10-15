import { BadRequestException, ConflictException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { RatesService } from '../rates/rates.service';
import {
  inactiveIngredientRefs,
  MenusService,
  servingsAvailable,
} from './menus.service';

const COMPANY_ID = 'company-1';

/** Productos de la empresa: carne por kilo y un insumo inactivo. */
const PRODUCTS: Record<
  string,
  { id: string; name: string; cost: number; active: boolean }
> = {
  carne: { id: 'carne', name: 'Carne', cost: 10, active: true },
  pan: { id: 'pan', name: 'Pan', cost: 2, active: true },
  postre: { id: 'postre', name: 'Postre', cost: 3, active: true },
  viejo: { id: 'viejo', name: 'Insumo viejo', cost: 1, active: false },
};

interface MenuRecord {
  id: string;
  code: string;
  name: string;
  price: number;
  cost: number;
  active: boolean;
  availability: string;
  categoryId: string | null;
  preparationMinutes: number | null;
  description?: string | null;
  imageUrl?: string | null;
}

function menu(overrides: Partial<MenuRecord> = {}): MenuRecord {
  return {
    id: 'm1',
    code: 'MEN-20260101-0001',
    name: 'Parrilla',
    price: 25,
    cost: 5.5,
    active: true,
    availability: 'ALL',
    categoryId: null,
    preparationMinutes: null,
    ...overrides,
  };
}

function createService(
  options: {
    menu?: MenuRecord | null;
    existingWithCode?: { id: string } | null;
    category?: { id: string } | null;
    ingredients?: {
      quantity: number;
      product: {
        id?: string;
        name?: string;
        stock: number;
        trackStock: boolean;
        active?: boolean;
      } | null;
    }[];
  } = {},
) {
  const created: { data: Record<string, unknown> }[] = [];
  const detail = {
    ...(options.menu ?? menu()),
    ingredients: options.ingredients ?? [],
  };

  const productDelegate = {
    findMany: jest.fn(async (args: { where: { id: { in: string[] } } }) =>
      args.where.id.in.filter((id) => PRODUCTS[id]).map((id) => PRODUCTS[id]),
    ),
  };

  const menuDelegate = {
    // La busqueda por `code` es la de unicidad: solo responde si hay un menu con
    // ese codigo (asi la generacion automatica encuentra el codigo libre).
    findFirst: jest.fn(async (args: { where: Record<string, unknown> }) =>
      'code' in args.where
        ? (options.existingWithCode ?? null)
        : options.menu === null
          ? null
          : detail,
    ),
    findMany: jest.fn(
      async (_args: {
        where?: Record<string, unknown>;
        include?: { ingredients?: { select?: Record<string, unknown> } };
      }) => [],
    ),
    create: jest.fn(async (args: { data: Record<string, unknown> }) => {
      created.push(args);
      // La receta escrita viene en `data.ingredients.create`; el menu leido trae
      // sus lineas en `ingredients`, que es lo que consume `decorate`.
      return { ...detail, ...args.data, ingredients: detail.ingredients };
    }),
    update: jest.fn(async (args: { data: Record<string, unknown> }) => ({
      ...detail,
      ...args.data,
    })),
    updateMany: jest.fn(async () => ({ count: 1 })),
    count: jest.fn(async () => 0),
  };

  const categoryDelegate = {
    findFirst: jest.fn(async () => options.category ?? null),
    // Subcategorias de la categoria filtrada en el listado.
    findMany: jest.fn(async () => [{ id: 'mc-child' }]),
  };

  const ingredientDelegate = {
    deleteMany: jest.fn(async () => ({ count: 2 })),
    createMany: jest.fn(async () => ({ count: 2 })),
  };

  /** Cliente de la transaccion: mismos delegados que el cliente normal. */
  const tx = {
    menu: menuDelegate,
    menuIngredient: ingredientDelegate,
  };

  const prisma = {
    product: productDelegate,
    menu: menuDelegate,
    menuCategory: categoryDelegate,
    menuIngredient: ingredientDelegate,
    $transaction: jest.fn(async (arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (client: typeof tx) => Promise<unknown>)(tx)
        : Promise.all(arg as Promise<unknown>[]),
    ),
  };

  // Tasas simuladas: 1 USD = 900 Bs (el bolivar vale 1 Bs).
  const rates = {
    resolveAmount: jest.fn(
      async (_companyId: string, amount: number, currency?: string | null) => ({
        currency: currency ?? 'USD',
        exchangeRate: currency === 'VES' ? 1 : 900,
        baseAmount:
          currency === 'VES' ? Math.round((amount / 900) * 100) / 100 : amount,
      }),
    ),
    toCurrencyAmount: jest.fn(
      async (_companyId: string, amount: number, currency?: string | null) =>
        currency === 'VES' ? amount * 900 : amount,
    ),
  } as unknown as RatesService;

  const service = new MenusService(
    prisma as unknown as PrismaService,
    rates,
  );
  return { service, prisma, created };
}

describe('servingsAvailable (disponibilidad del menu)', () => {
  it('calcula porciones con consumos fraccionarios exactos', () => {
    // 0.9 kg de carne y la receta pide 0.1 kg: alcanza para 9, no para 8.
    expect(
      servingsAvailable([
        { quantity: 0.1, product: { trackStock: true, stock: 0.9 } },
      ]),
    ).toBe(9);
  });

  it('toma el minimo entre los ingredientes controlados', () => {
    expect(
      servingsAvailable([
        { quantity: 0.1, product: { trackStock: true, stock: 1 } },
        { quantity: 2, product: { trackStock: true, stock: 5 } },
      ]),
    ).toBe(2);
  });

  it('ignora los ingredientes sin control de inventario', () => {
    expect(
      servingsAvailable([
        { quantity: 3, product: { trackStock: false, stock: 0 } },
      ]),
    ).toBeNull();
    expect(servingsAvailable([])).toBeNull();
  });

  it('no permite vender cuando no hay stock', () => {
    expect(
      servingsAvailable([
        { quantity: 0.25, product: { trackStock: true, stock: 0 } },
      ]),
    ).toBe(0);
  });
});

describe('MenusService.create', () => {
  it('costea la receta con el costo de cada producto x su cantidad', async () => {
    const { service, created } = createService();

    await service.create(COMPANY_ID, {
      name: 'Parrilla',
      price: 25,
      ingredients: [
        { productId: 'carne', quantity: 0.5 },
        { productId: 'pan', quantity: 2 },
        { productId: 'postre', quantity: 1, section: 'Postre' },
      ],
    });

    // 0.5 x 10 + 2 x 2 + 1 x 3 = 12.00
    expect(created[0].data.cost).toBe(12);
    expect(created[0].data.ingredients).toEqual({
      create: [
        {
          companyId: COMPANY_ID,
          productId: 'carne',
          quantity: 0.5,
          section: 'Principal',
          note: null,
          sortOrder: 0,
        },
        {
          companyId: COMPANY_ID,
          productId: 'pan',
          quantity: 2,
          section: 'Principal',
          note: null,
          sortOrder: 1,
        },
        {
          companyId: COMPANY_ID,
          productId: 'postre',
          quantity: 1,
          section: 'Postre',
          note: null,
          sortOrder: 2,
        },
      ],
    });
  });

  it('convierte el precio escrito en bolivares y guarda el contexto de moneda', async () => {
    const { service, created } = createService();

    await service.create(COMPANY_ID, {
      name: 'Parrilla',
      price: 22500,
      priceCurrency: 'VES',
      ingredients: [{ productId: 'carne', quantity: 0.5 }],
    });

    expect(created[0].data).toMatchObject({
      price: 25,
      priceCurrency: 'VES',
      priceEntered: 22500,
      priceRate: 1,
    });
  });

  it('guarda el precio en USD cuando no se indica moneda', async () => {
    const { service, created } = createService();

    await service.create(COMPANY_ID, {
      name: 'Parrilla',
      price: 25,
      ingredients: [{ productId: 'carne', quantity: 0.5 }],
    });

    expect(created[0].data).toMatchObject({
      price: 25,
      priceCurrency: 'USD',
      priceEntered: 25,
      priceRate: 900,
    });
  });


  it('genera el codigo cuando no se envia', async () => {
    const { service, created } = createService();

    await service.create(COMPANY_ID, {
      name: 'Parrilla',
      price: 25,
      ingredients: [{ productId: 'carne', quantity: 1 }],
    });

    expect(created[0].data.code).toMatch(/^MEN-\d{8}-\d{4}$/);
  });

  it('crea un menu sin receta (costo 0 y sin lineas)', async () => {
    const { service, created } = createService();

    await service.create(COMPANY_ID, {
      name: 'Agua embotellada',
      price: 2,
      ingredients: [],
    });

    // Sin receta no hay costo ni lineas: el menu no descuenta inventario.
    expect(created[0].data.cost).toBe(0);
    expect(created[0].data.ingredients).toBeUndefined();
  });

  it('rechaza un producto repetido en la receta', async () => {
    const { service } = createService();

    await expect(
      service.create(COMPANY_ID, {
        name: 'Parrilla',
        price: 25,
        ingredients: [
          { productId: 'carne', quantity: 1 },
          { productId: 'carne', quantity: 2 },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza un producto inactivo en la receta', async () => {
    const { service } = createService();

    await expect(
      service.create(COMPANY_ID, {
        name: 'Parrilla',
        price: 25,
        ingredients: [{ productId: 'viejo', quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza un producto que no pertenece a la empresa', async () => {
    const { service } = createService();

    await expect(
      service.create(COMPANY_ID, {
        name: 'Parrilla',
        price: 25,
        ingredients: [{ productId: 'ajeno', quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza un codigo de menu ya usado', async () => {
    const { service } = createService({ existingWithCode: { id: 'otro' } });

    await expect(
      service.create(COMPANY_ID, {
        code: 'MEN-20260101-0001',
        name: 'Parrilla',
        price: 25,
        ingredients: [{ productId: 'carne', quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('exige que la categoria de menu exista en la empresa', async () => {
    const { service } = createService({ category: null });

    await expect(
      service.create(COMPANY_ID, {
        name: 'Parrilla',
        price: 25,
        categoryId: 'ajena',
        ingredients: [{ productId: 'carne', quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('MenusService.update', () => {
  it('reemplaza la receta completa y recalcula el costo', async () => {
    const { service, prisma } = createService();

    await service.update(COMPANY_ID, 'm1', {
      ingredients: [{ productId: 'pan', quantity: 3 }],
    });

    expect(prisma.menuIngredient.deleteMany).toHaveBeenCalledWith({
      where: { menuId: 'm1', companyId: COMPANY_ID },
    });
    expect(prisma.menuIngredient.createMany).toHaveBeenCalledWith({
      data: [
        {
          companyId: COMPANY_ID,
          menuId: 'm1',
          productId: 'pan',
          quantity: 3,
          section: 'Principal',
          note: null,
          sortOrder: 0,
        },
      ],
    });
    expect(prisma.menu.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ cost: 6 }) }),
    );
  });

  it('elimina la receta cuando se envia vacia', async () => {
    const { service, prisma } = createService();

    await service.update(COMPANY_ID, 'm1', { ingredients: [] });

    expect(prisma.menuIngredient.deleteMany).toHaveBeenCalledWith({
      where: { menuId: 'm1', companyId: COMPANY_ID },
    });
    expect(prisma.menuIngredient.createMany).not.toHaveBeenCalled();
    expect(prisma.menu.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ cost: 0 }) }),
    );
  });

  it('conserva la receta cuando no se envia', async () => {
    const { service, prisma } = createService();

    await service.update(COMPANY_ID, 'm1', { price: 30 });

    expect(prisma.menuIngredient.deleteMany).not.toHaveBeenCalled();
    expect(prisma.menu.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          price: 30,
          priceCurrency: 'USD',
          priceEntered: 30,
        }),
      }),
    );
  });
});

/**
 * El listado de menus alimenta la tabla Y el formulario de edicion: la receta
 * debe traer lo que el modal necesita para reabrirse (sin `productId` el
 * formulario aparecia vacio y guardar borraba los ingredientes).
 */
describe('MenusService.findAll', () => {
  it('incluye la receta completa (producto, cantidad, seccion y nota)', async () => {
    const { service, prisma } = createService();
    const query = {
      page: 1,
      limit: 20,
      toOrderBy: () => ({ name: 'asc' }),
    } as never;

    await service.findAll(COMPANY_ID, query);

    const include = prisma.menu.findMany.mock.calls[0][0].include;
    expect(include?.ingredients?.select).toEqual(
      expect.objectContaining({
        productId: true,
        quantity: true,
        section: true,
        note: true,
        sortOrder: true,
        product: expect.objectContaining({
          select: expect.objectContaining({ active: true }),
        }),
      }),
    );
  });

  /**
   * Las subcategorias de menu son opcionales, pero filtrar por la principal debe
   * traer tambien lo agrupado en ellas (elegir "Almuerzos" incluye "Sopas").
   */
  it('trae tambien los menus de las subcategorias al filtrar por la principal', async () => {
    const { service, prisma } = createService();
    const query = {
      page: 1,
      limit: 20,
      categoryId: 'mc1',
      toOrderBy: () => ({ name: 'asc' }),
    } as never;

    await service.findAll(COMPANY_ID, query);

    expect(prisma.menuCategory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { parentId: 'mc1', companyId: COMPANY_ID },
      }),
    );
    const where = prisma.menu.findMany.mock.calls[0][0].where as {
      categoryId?: { in: string[] };
    };
    expect(where.categoryId).toEqual({ in: ['mc1', 'mc-child'] });
  });
});

describe('MenusService.remove', () => {
  it('da de baja el menu sin borrarlo (los pedidos lo referencian)', async () => {
    const { service, prisma } = createService();

    await service.remove(COMPANY_ID, 'm1');

    expect(prisma.menu.updateMany).toHaveBeenCalledWith({
      where: { id: 'm1', companyId: COMPANY_ID },
      data: { active: false },
    });
  });
});

/** Ingrediente activo de ejemplo (con control de inventario). */
const CARNE = {
  id: 'carne',
  name: 'Carne',
  stock: 10,
  trackStock: true,
  active: true,
};

/** Insumo que se desactivo despues de armar la receta. */
const INSUMO_VIEJO = {
  id: 'viejo',
  name: 'Insumo viejo',
  stock: 50,
  trackStock: true,
  active: false,
};

describe('inactiveIngredientRefs (ingredientes desactivados)', () => {
  it('no reporta nada cuando todos los productos estan activos', () => {
    expect(inactiveIngredientRefs([{ quantity: 1, product: CARNE }])).toEqual([]);
  });

  it('reporta los productos desactivados que siguen en la receta', () => {
    expect(
      inactiveIngredientRefs([
        { quantity: 1, product: CARNE },
        { quantity: 2, product: INSUMO_VIEJO },
      ]),
    ).toEqual([{ id: 'viejo', name: 'Insumo viejo' }]);
  });

  it('ignora las lineas sin producto', () => {
    expect(inactiveIngredientRefs([{ quantity: 1, product: null }])).toEqual([]);
  });
});

/**
 * Un ingrediente desactivado deja el menu invendible: el listado lo marca como
 * no disponible (aunque el stock alcance) y expone el motivo a la interfaz.
 */
describe('MenusService (ingredientes inactivos)', () => {
  it('bloquea la venta del menu y lista el ingrediente inactivo', async () => {
    const { service } = createService({
      ingredients: [
        { quantity: 1, product: CARNE },
        { quantity: 2, product: INSUMO_VIEJO },
      ],
    });

    const detail = await service.findOne(COMPANY_ID, 'm1');

    expect(detail.inactiveIngredients).toEqual([
      { id: 'viejo', name: 'Insumo viejo' },
    ]);
    expect(detail.available).toBe(false);
    // El stock alcanza para 10 porciones: lo que bloquea es la receta.
    expect(detail.maxServings).toBe(10);
  });

  it('deja el menu disponible cuando todos los ingredientes estan activos', async () => {
    const { service } = createService({
      ingredients: [{ quantity: 1, product: CARNE }],
    });

    const detail = await service.findOne(COMPANY_ID, 'm1');

    expect(detail.inactiveIngredients).toEqual([]);
    expect(detail.available).toBe(true);
  });
});

