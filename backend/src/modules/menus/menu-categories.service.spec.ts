import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { MenuCategoriesRepository } from './menu-categories.repository';
import { MenuCategoriesService } from './menu-categories.service';

const COMPANY_ID = 'company-1';

interface MenuCategoryRow {
  id: string;
  companyId: string;
  name: string;
  sortOrder: number;
  parentId: string | null;
  active: boolean;
}

/** Carta de la empresa: "Almuerzos" con su subcategoria "Sopas". */
const CATEGORIES: MenuCategoryRow[] = [
  {
    id: 'mc-almuerzos',
    companyId: COMPANY_ID,
    name: 'Almuerzos',
    sortOrder: 1,
    parentId: null,
    active: true,
  },
  {
    id: 'mc-sopas',
    companyId: COMPANY_ID,
    name: 'Sopas',
    sortOrder: 2,
    parentId: 'mc-almuerzos',
    active: true,
  },
  {
    id: 'mc-combos',
    companyId: COMPANY_ID,
    name: 'Combos',
    sortOrder: 2,
    parentId: null,
    active: true,
  },
  {
    id: 'otra-empresa',
    companyId: 'company-2',
    name: 'Almuerzos',
    sortOrder: 1,
    parentId: null,
    active: true,
  },
];

/** Comprueba un `where` de Prisma contra una fila (soporta `not`). */
function matches(
  row: Record<string, unknown>,
  where: Record<string, unknown>,
): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && 'not' in value) {
      return row[key] !== (value as { not: unknown }).not;
    }
    return row[key] === value;
  });
}

/** Prisma simulado: filtra de verdad por el `where` que arma el servicio. */
function createService(rows: MenuCategoryRow[] = CATEGORIES) {
  const created: Record<string, unknown>[] = [];
  const updated: { data: Record<string, unknown> }[] = [];

  const delegate = {
    findFirst: jest.fn(async (args: { where?: Record<string, unknown> }) => {
      const found = rows.find((row) =>
        matches(row as unknown as Record<string, unknown>, args?.where ?? {}),
      );
      return found
        ? { id: found.id, name: found.name, parentId: found.parentId }
        : null;
    }),
    findMany: jest.fn(
      async (args: {
        where?: Record<string, unknown>;
        include?: Record<string, unknown>;
      }) =>
        rows
          .filter((row) =>
            matches(row as unknown as Record<string, unknown>, args?.where ?? {}),
          )
          .map((row) => ({
            id: row.id,
            name: row.name,
            sortOrder: row.sortOrder,
            parentId: row.parentId,
          })),
    ),
    create: jest.fn(async (args: { data: Record<string, unknown> }) => {
      created.push(args.data);
      return { id: 'mc-new', ...args.data };
    }),
    count: jest.fn(async (args: { where?: Record<string, unknown> }) =>
      rows.filter((row) =>
        matches(row as unknown as Record<string, unknown>, args?.where ?? {}),
      ).length,
    ),
    updateMany: jest.fn(
      async (args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        updated.push(args);
        return { count: 1 };
      },
    ),
    deleteMany: jest.fn(async () => ({ count: 1 })),
  };

  const prisma = {
    menuCategory: delegate,
    $transaction: jest.fn(async (arg: unknown) =>
      Promise.all(arg as Promise<unknown>[]),
    ),
  };

  return {
    service: new MenuCategoriesService(
      new MenuCategoriesRepository(prisma as unknown as PrismaService),
    ),
    delegate,
    created,
    updated,
  };
}

describe('MenuCategoriesService (subcategorias de la carta)', () => {
  it('crea una subcategoria de menu cuando se elige una principal', async () => {
    const { service, created } = createService();

    await service.create(COMPANY_ID, {
      name: 'Cremas',
      parentId: 'mc-almuerzos',
    });

    expect(created[0]).toMatchObject({
      name: 'Cremas',
      parentId: 'mc-almuerzos',
      companyId: COMPANY_ID,
      active: true,
    });
  });

  it('deja la categoria como principal cuando no se envia padre', async () => {
    const { service, created } = createService();

    await service.create(COMPANY_ID, { name: 'Desayunos' });

    expect(created[0].parentId).toBeNull();
  });

  it('rechaza como padre una categoria de otra empresa', async () => {
    const { service, created } = createService();

    await expect(
      service.create(COMPANY_ID, { name: 'Cremas', parentId: 'otra-empresa' }),
    ).rejects.toThrow(BadRequestException);
    expect(created).toHaveLength(0);
  });

  it('rechaza un segundo nivel de subcategorias', async () => {
    const { service } = createService();

    await expect(
      service.create(COMPANY_ID, { name: 'De pollo', parentId: 'mc-sopas' }),
    ).rejects.toThrow('Solo se permite un nivel de subcategorias');
  });

  it('no deja que una categoria sea su propia principal ni colgar con hijas', async () => {
    const { service, updated } = createService();

    await expect(
      service.update(COMPANY_ID, 'mc-combos', { parentId: 'mc-combos' }),
    ).rejects.toThrow(
      'Una categoria no puede ser su propia categoria principal',
    );
    await expect(
      service.update(COMPANY_ID, 'mc-almuerzos', { parentId: 'mc-combos' }),
    ).rejects.toThrow(
      'Esta categoria tiene subcategorias: no puede ser subcategoria de otra',
    );
    expect(updated).toHaveLength(0);
  });

  it('vuelve principal a una subcategoria cuando el padre va vacio', async () => {
    const { service, updated } = createService();

    await service.update(COMPANY_ID, 'mc-sopas', { parentId: null });

    expect(updated[0].data.parentId).toBeNull();
  });

  it('filtra las subcategorias de una principal en el listado', async () => {
    const { service, delegate } = createService();

    const result = await service.findAll(COMPANY_ID, {
      page: 1,
      limit: 20,
      parentId: 'mc-almuerzos',
      toOrderBy: () => ({ sortOrder: 'asc' }),
    } as never);

    const args = delegate.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({
      companyId: COMPANY_ID,
      parentId: 'mc-almuerzos',
    });
    const include = args.include as {
      _count?: { select: Record<string, unknown> };
    };
    expect(include._count?.select).toEqual(
      expect.objectContaining({
        menus: { where: { companyId: COMPANY_ID } },
        subcategories: { where: { companyId: COMPANY_ID } },
      }),
    );
    expect(result.meta.total).toBe(1);
  });

  it('ordena las opciones por sortOrder con cada subcategoria bajo su principal', async () => {
    const { service } = createService();

    const options = await service.findOptions(COMPANY_ID);

    expect(options.map((option) => option.name)).toEqual([
      'Almuerzos',
      'Sopas',
      'Combos',
    ]);
  });
});
