import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { toSkip } from '../../common/utils/pagination.util';
import { tenantWhere } from '../../common/utils/tenant.util';
import { PrismaService, type PrismaClientLike } from '../../prisma/prisma.service';
import { MenuQueryDto } from './dto/menu-query.dto';

/** Detalle completo de un menu: receta con su producto y la categoria. */
const MENU_DETAIL_INCLUDE = {
  category: { select: { id: true, name: true, color: true } },
  ingredients: {
    include: {
      product: {
        select: {
          id: true,
          name: true,
          sku: true,
          unit: true,
          price: true,
          cost: true,
          stock: true,
          trackStock: true,
          // Un producto desactivado despues de armar la receta deja el menu
          // invendible: la interfaz y el motor de pedidos lo necesitan.
          active: true,
        },
      },
    },
    orderBy: { sortOrder: 'asc' },
  },
} satisfies Prisma.MenuInclude;

/** Listado: receta minima para calcular disponibilidad sin traer todo. */
const MENU_LIST_INCLUDE = {
  category: { select: { id: true, name: true, color: true } },
  ingredients: {
    select: {
      // La receta del listado la reusa el formulario de edicion: sin
      // `productId` (ni la nota/seccion) editar un menu desde la tabla borraba
      // los ingredientes al abrir el modal.
      productId: true,
      quantity: true,
      section: true,
      note: true,
      sortOrder: true,
      product: {
        select: { id: true, name: true, stock: true, trackStock: true, active: true },
      },
    },
    orderBy: { sortOrder: 'asc' },
  },
} satisfies Prisma.MenuInclude;

/** Opciones para el POS / pedidos: catalogo vendible con su receta. */
const MENU_OPTION_SELECT = {
  id: true,
  code: true,
  name: true,
  description: true,
  imageUrl: true,
  price: true,
  cost: true,
  availability: true,
  preparationMinutes: true,
  categoryId: true,
  category: { select: { id: true, name: true, color: true } },
  ingredients: {
    select: {
      quantity: true,
      section: true,
      product: {
        select: {
          id: true,
          name: true,
          unit: true,
          stock: true,
          trackStock: true,
          active: true,
        },
      },
    },
  },
} satisfies Prisma.MenuSelect;

/** Receta cruda que consume el motor de pedidos (`loadRecipes`). */
const MENU_RECIPE_SELECT = {
  id: true,
  code: true,
  name: true,
  price: true,
  active: true,
  ingredients: {
    select: {
      productId: true,
      quantity: true,
      // El producto viaja con su estado para que el motor de pedidos pueda
      // rechazar la venta de un menu con ingredientes desactivados.
      product: { select: { name: true, active: true } },
    },
  },
} satisfies Prisma.MenuSelect;

export type MenuDetail = Prisma.MenuGetPayload<{
  include: typeof MENU_DETAIL_INCLUDE;
}>;

export type MenuListRow = Prisma.MenuGetPayload<{
  include: typeof MENU_LIST_INCLUDE;
}>;

export type MenuOption = Prisma.MenuGetPayload<{
  select: typeof MENU_OPTION_SELECT;
}>;

/** Producto de la receta con el costo para costear el menu. */
const RECIPE_PRODUCT_SELECT = {
  id: true,
  name: true,
  cost: true,
  active: true,
} satisfies Prisma.ProductSelect;

/**
 * Acceso a datos de menus. Toda consulta/escritura de Prisma del modulo vive
 * aqui: el servicio conserva las validaciones (codigo unico, categoria de la
 * empresa, receta valida) y el costeo, pero no conoce el cliente de base de
 * datos.
 */
@Injectable()
export class MenusRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(tx?: PrismaClientLike): PrismaClientLike {
    return tx ?? this.prisma;
  }

  /** Ejecuta una unidad de trabajo dentro de una transaccion de base de datos. */
  transaction<T>(work: (tx: PrismaClientLike) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => work(tx));
  }

  /** Crea el menu con su receta y devuelve el detalle completo. */
  create(data: Prisma.MenuUncheckedCreateInput): Promise<MenuDetail> {
    return this.prisma.menu.create({
      data,
      include: MENU_DETAIL_INCLUDE,
    });
  }

  /** Pagina del listado con la receta minima para calcular disponibilidad. */
  async findPage(
    companyId: string,
    query: MenuQueryDto,
    categoryIds?: string[],
  ): Promise<{ items: MenuListRow[]; total: number }> {
    const where = this.listWhere(companyId, query, categoryIds);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.menu.findMany({
        where,
        include: MENU_LIST_INCLUDE,
        orderBy: query.toOrderBy(['name', 'price', 'createdAt'], { name: 'asc' }),
        skip: toSkip(query.page, query.limit),
        take: query.limit,
      }),
      this.prisma.menu.count({ where }),
    ]);

    return { items, total };
  }

  /** Menus activos listos para vender (grilla del POS y buscador de pedidos). */
  findOptions(companyId: string): Promise<MenuOption[]> {
    return this.prisma.menu.findMany({
      where: { active: true, ...tenantWhere(companyId) },
      select: MENU_OPTION_SELECT,
      orderBy: [{ name: 'asc' }],
    });
  }

  findDetail(companyId: string, id: string): Promise<MenuDetail | null> {
    return this.prisma.menu.findFirst({
      where: { id, ...tenantWhere(companyId) },
      include: MENU_DETAIL_INCLUDE,
    });
  }

  /** Ficha actual del menu (para comparar codigo y moneda del precio). */
  findCurrent(companyId: string, id: string) {
    return this.prisma.menu.findFirst({
      where: { id, ...tenantWhere(companyId) },
    });
  }

  updateMenu(
    companyId: string,
    id: string,
    data: Prisma.MenuUncheckedUpdateInput,
    tx?: PrismaClientLike,
  ) {
    return this.client(tx).menu.update({
      where: { id, ...tenantWhere(companyId) },
      data,
    });
  }

  /**
   * Reemplaza la receta del menu: borra las lineas actuales y, si queda algo,
   * las vuelve a crear (con `[]` el menu queda sin receta).
   */
  async replaceIngredients(
    companyId: string,
    menuId: string,
    rows: Omit<Prisma.MenuIngredientCreateManyInput, 'companyId' | 'menuId'>[],
    tx?: PrismaClientLike,
  ) {
    const client = this.client(tx);

    await client.menuIngredient.deleteMany({
      where: { menuId, ...tenantWhere(companyId) },
    });
    if (rows.length === 0) return;

    await client.menuIngredient.createMany({
      data: rows.map((row) => ({ companyId, menuId, ...row })),
    });
  }

  /** Baja logica: los menus vendidos quedan referenciados por los pedidos. */
  deactivate(companyId: string, id: string) {
    return this.prisma.menu.updateMany({
      where: { id, ...tenantWhere(companyId) },
      data: { active: false },
    });
  }

  /** Recetas de los menus indicados (solo de la empresa activa). */
  findRecipes(companyId: string, menuIds: string[], tx?: PrismaClientLike) {
    return this.client(tx).menu.findMany({
      where: { id: { in: menuIds }, ...tenantWhere(companyId) },
      select: MENU_RECIPE_SELECT,
    });
  }

  /** Productos de la empresa que forman parte de una receta. */
  findRecipeProducts(companyId: string, productIds: string[]) {
    return this.prisma.product.findMany({
      where: { id: { in: productIds }, ...tenantWhere(companyId) },
      select: RECIPE_PRODUCT_SELECT,
    });
  }

  /** Menu que ya usa ese codigo en la empresa (unicidad por empresa). */
  findCodeOwner(companyId: string, code: string, excludeId?: string) {
    return this.prisma.menu.findFirst({
      where: {
        ...tenantWhere(companyId),
        code,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
  }

  /** Categoria de menu enlazada (debe pertenecer a la empresa activa). */
  findCategoryRef(companyId: string, categoryId: string) {
    return this.prisma.menuCategory.findFirst({
      where: { id: categoryId, ...tenantWhere(companyId) },
      select: { id: true },
    });
  }

  /**
   * Ids que abarca el filtro de categoria: la elegida y sus subcategorias (un
   * solo nivel).
   */
  async findCategoryScopeIds(companyId: string, categoryId: string) {
    const subcategories = await this.prisma.menuCategory.findMany({
      where: { parentId: categoryId, ...tenantWhere(companyId) },
      select: { id: true },
    });
    return [categoryId, ...subcategories.map((subcategory) => subcategory.id)];
  }

  /** Cantidad de menus de la empresa (secuencia del codigo legible). */
  countMenus(companyId: string) {
    return this.prisma.menu.count({ where: tenantWhere(companyId) });
  }

  private listWhere(
    companyId: string,
    query: MenuQueryDto,
    categoryIds?: string[],
  ): Prisma.MenuWhereInput {
    return {
      ...tenantWhere(companyId),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search } },
              { code: { contains: query.search } },
              { description: { contains: query.search } },
            ],
          }
        : {}),
      ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
      ...(query.onlyActive ? { active: true } : {}),
    };
  }
}
