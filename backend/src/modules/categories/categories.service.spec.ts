import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { CategoriesService } from './categories.service';

const COMPANY_ID = 'company-1';

interface CategoryRow {
  id: string;
  companyId: string;
  name: string;
  parentId: string | null;
  active: boolean;
}

/** Categorias de la empresa: "Bebidas" con su subcategoria "Refrescos". */
const CATEGORIES: CategoryRow[] = [
  {
    id: 'cat-bebidas',
    companyId: COMPANY_ID,
    name: 'Bebidas',
    parentId: null,
    active: true,
  },
  {
    id: 'cat-refrescos',
    companyId: COMPANY_ID,
    name: 'Refrescos',
    parentId: 'cat-bebidas',
    active: true,
  },
  {
    id: 'cat-comidas',
    companyId: COMPANY_ID,
    name: 'Comidas',
    parentId: null,
    active: true,
  },
  {
    id: 'otra-empresa',
    companyId: 'company-2',
    name: 'Bebidas',
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

/**
 * Prisma simulado con una tabla en memoria: `findFirst`/`findMany` filtran de
 * verdad por el `where` que arma el servicio, asi las pruebas cubren las reglas
 * de la jerarquia (padre principal, un solo nivel, aislamiento por empresa).
 */
function createService(rows: CategoryRow[] = CATEGORIES) {
  const created: Record<string, unknown>[] = [];
  const updated: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }[] = [];

  const find = (where: Record<string, unknown>) =>
    rows.find((row) =>
      matches(row as unknown as Record<string, unknown>, where),
    );

  const delegate = {
    findFirst: jest.fn(async (args: { where?: Record<string, unknown> }) => {
      const found = find(args?.where ?? {});
      if (!found) return null;
      return { id: found.id, name: found.name, parentId: found.parentId };
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
          .map((row) => ({ id: row.id, name: row.name, parentId: row.parentId })),
    ),
    create: jest.fn(async (args: { data: Record<string, unknown> }) => {
      created.push(args.data);
      return { id: 'cat-new', ...args.data };
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
    category: delegate,
    $transaction: jest.fn(async (arg: unknown) =>
      Promise.all(arg as Promise<unknown>[]),
    ),
  };

  return {
    service: new CategoriesService(prisma as unknown as PrismaService),
    delegate,
    created,
    updated,
  };
}

describe('CategoriesService.create', () => {
  it('crea una subcategoria cuando se elige una categoria principal', async () => {
    const { service, created } = createService();

    await service.create(COMPANY_ID, {
      name: 'Cervezas',
      parentId: 'cat-bebidas',
    });

    expect(created[0]).toMatchObject({
      name: 'Cervezas',
      parentId: 'cat-bebidas',
      companyId: COMPANY_ID,
      active: true,
    });
  });

  it('crea la categoria como principal cuando no se envia padre', async () => {
    const { service, created } = createService();

    await service.create(COMPANY_ID, { name: 'Limpieza' });

    // La subcategoria es opcional: sin `parentId` la fila queda como principal.
    expect(created[0].parentId).toBeNull();
  });

  it('rechaza como padre una categoria de otra empresa', async () => {
    const { service, created } = createService();

    await expect(
      service.create(COMPANY_ID, { name: 'Cervezas', parentId: 'otra-empresa' }),
    ).rejects.toThrow(BadRequestException);
    expect(created).toHaveLength(0);
  });

  it('rechaza un segundo nivel de subcategorias', async () => {
    const { service } = createService();

    await expect(
      service.create(COMPANY_ID, {
        name: 'Gaseosas',
        parentId: 'cat-refrescos',
      }),
    ).rejects.toThrow('Solo se permite un nivel de subcategorias');
  });

  it('mantiene el nombre unico por empresa', async () => {
    const { service } = createService();

    await expect(
      service.create(COMPANY_ID, { name: 'Refrescos' }),
    ).rejects.toThrow(ConflictException);
  });
});

describe('CategoriesService.update', () => {
  it('convierte una categoria principal en subcategoria', async () => {
    const { service, updated } = createService();

    await service.update(COMPANY_ID, 'cat-comidas', { parentId: 'cat-bebidas' });

    expect(updated[0].data.parentId).toBe('cat-bebidas');
  });

  it('vuelve principal a una subcategoria cuando el padre va vacio', async () => {
    const { service, updated } = createService();

    await service.update(COMPANY_ID, 'cat-refrescos', { parentId: '' });

    expect(updated[0].data.parentId).toBeNull();
  });

  it('no deja que una categoria sea su propia principal', async () => {
    const { service } = createService();

    await expect(
      service.update(COMPANY_ID, 'cat-comidas', { parentId: 'cat-comidas' }),
    ).rejects.toThrow(
      'Una categoria no puede ser su propia categoria principal',
    );
  });

  it('no deja colgar una categoria que ya tiene subcategorias', async () => {
    const { service, updated } = createService();

    await expect(
      service.update(COMPANY_ID, 'cat-bebidas', { parentId: 'cat-comidas' }),
    ).rejects.toThrow(
      'Esta categoria tiene subcategorias: no puede ser subcategoria de otra',
    );
    expect(updated).toHaveLength(0);
  });

  it('avisa cuando la categoria no existe', async () => {
    const { service } = createService();

    await expect(
      service.update(COMPANY_ID, 'cat-inexistente', { name: 'Otra' }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('CategoriesService.findAll', () => {
  it('filtra las subcategorias de una principal y trae el padre y los conteos', async () => {
    const { service, delegate } = createService();

    const result = await service.findAll(COMPANY_ID, {
      page: 1,
      limit: 20,
      parentId: 'cat-bebidas',
      toOrderBy: () => ({ name: 'asc' }),
    } as never);

    const args = delegate.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({
      companyId: COMPANY_ID,
      parentId: 'cat-bebidas',
    });
    // El listado necesita el nombre del padre y cuantas hijas tiene cada fila.
    const include = args.include as {
      parent?: unknown;
      _count?: { select: Record<string, unknown> };
    };
    expect(include.parent).toEqual({ select: { id: true, name: true } });
    expect(include._count?.select).toEqual(
      expect.objectContaining({
        products: { where: { companyId: COMPANY_ID } },
        subcategories: { where: { companyId: COMPANY_ID } },
      }),
    );
    expect(result.meta.total).toBe(1);
  });
});

describe('CategoriesService.findOptions', () => {
  it('deja cada subcategoria debajo de su principal', async () => {
    const { service } = createService();

    const options = await service.findOptions(COMPANY_ID);

    expect(options.map((option) => option.name)).toEqual([
      'Bebidas',
      'Refrescos',
      'Comidas',
    ]);
  });
});
