import { BadRequestException, ConflictException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { MenusService, servingsAvailable } from './menus.service';

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
      product: { trackStock: boolean; stock: number } | null;
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

  const service = new MenusService(prisma as unknown as PrismaService);
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

  it('genera el codigo cuando no se envia', async () => {
    const { service, created } = createService();

    await service.create(COMPANY_ID, {
      name: 'Parrilla',
      price: 25,
      ingredients: [{ productId: 'carne', quantity: 1 }],
    });

    expect(created[0].data.code).toMatch(/^MEN-\d{8}-\d{4}$/);
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

  it('conserva la receta cuando no se envia', async () => {
    const { service, prisma } = createService();

    await service.update(COMPANY_ID, 'm1', { price: 30 });

    expect(prisma.menuIngredient.deleteMany).not.toHaveBeenCalled();
    expect(prisma.menu.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { price: 30 } }),
    );
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

