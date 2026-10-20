import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { toSkip } from '../../common/utils/pagination.util';
import { tenantWhere } from '../../common/utils/tenant.util';
import { PrismaService } from '../../prisma/prisma.service';
import { MenuCategoryQueryDto } from './dto/menu-category-query.dto';

/** Datos del padre que viajan en el listado para pintar la jerarquia. */
const PARENT_SELECT = { select: { id: true, name: true } } as const;

/** Detalle de la categoria con su padre (para la columna del listado). */
const CATEGORY_DETAIL_INCLUDE = {
  parent: PARENT_SELECT,
} satisfies Prisma.MenuCategoryInclude;

/** Opciones del select: lo minimo para indentar la jerarquia. */
const CATEGORY_OPTION_SELECT = {
  id: true,
  name: true,
  color: true,
  sortOrder: true,
  parentId: true,
} satisfies Prisma.MenuCategorySelect;

export type MenuCategoryDetail = Prisma.MenuCategoryGetPayload<{
  include: typeof CATEGORY_DETAIL_INCLUDE;
}>;

export type MenuCategoryOption = Prisma.MenuCategoryGetPayload<{
  select: typeof CATEGORY_OPTION_SELECT;
}>;

/**
 * Acceso a datos de categorias de menu. Toda consulta/escritura de Prisma del
 * modulo vive aqui: el servicio conserva las reglas de la jerarquia (dos
 * niveles, nombre unico por empresa), pero no conoce el cliente de base de
 * datos.
 */
@Injectable()
export class MenuCategoriesRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.MenuCategoryUncheckedCreateInput) {
    return this.prisma.menuCategory.create({ data });
  }

  async findPage(
    companyId: string,
    query: MenuCategoryQueryDto,
  ): Promise<{ items: unknown[]; total: number }> {
    const where = this.listWhere(companyId, query);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.menuCategory.findMany({
        where,
        include: {
          // La principal, para la columna del padre del listado.
          parent: PARENT_SELECT,
          // Los conteos tambien se aislan a la empresa activa.
          _count: {
            select: {
              menus: { where: tenantWhere(companyId) },
              subcategories: { where: tenantWhere(companyId) },
            },
          },
        },
        orderBy: query.toOrderBy(['name', 'sortOrder', 'createdAt'], {
          sortOrder: 'asc',
        }),
        skip: toSkip(query.page, query.limit),
        take: query.limit,
      }),
      this.prisma.menuCategory.count({ where }),
    ]);

    return { items, total };
  }

  /** Listado simple (sin paginar) para selects, filtros del POS y menus. */
  findOptions(companyId: string): Promise<MenuCategoryOption[]> {
    return this.prisma.menuCategory.findMany({
      where: { active: true, ...tenantWhere(companyId) },
      select: CATEGORY_OPTION_SELECT,
    });
  }

  findOne(
    companyId: string,
    id: string,
  ): Promise<MenuCategoryDetail | null> {
    return this.prisma.menuCategory.findFirst({
      where: { id, ...tenantWhere(companyId) },
      include: CATEGORY_DETAIL_INCLUDE,
    });
  }

  update(
    companyId: string,
    id: string,
    data: Prisma.MenuCategoryUncheckedUpdateManyInput,
  ) {
    return this.prisma.menuCategory.updateMany({
      where: { id, ...tenantWhere(companyId) },
      data,
    });
  }

  /**
   * Baja fisica: Prisma pone categoryId = null en los menus y parentId = null en
   * las subcategorias (SetNull): no se pierden, las hijas quedan principales.
   */
  remove(companyId: string, id: string) {
    return this.prisma.menuCategory.deleteMany({
      where: { id, ...tenantWhere(companyId) },
    });
  }

  /** Categoria principal candidata (para validar la jerarquia). */
  findParentRef(companyId: string, parentId: string) {
    return this.prisma.menuCategory.findFirst({
      where: { id: parentId, ...tenantWhere(companyId) },
      select: { id: true, parentId: true },
    });
  }

  /** Primera subcategoria de la categoria (bloquea la conversion a hija). */
  findChildRef(companyId: string, categoryId: string) {
    return this.prisma.menuCategory.findFirst({
      where: { parentId: categoryId, ...tenantWhere(companyId) },
      select: { id: true },
    });
  }

  /** Categoria que ya usa ese nombre en la empresa (unicidad por empresa). */
  findByName(companyId: string, name: string, excludeId?: string) {
    return this.prisma.menuCategory.findFirst({
      where: {
        ...tenantWhere(companyId),
        name,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
  }

  private listWhere(
    companyId: string,
    query: MenuCategoryQueryDto,
  ): Prisma.MenuCategoryWhereInput {
    return {
      ...tenantWhere(companyId),
      ...(query.search ? { name: { contains: query.search } } : {}),
      // `parentId` filtra las subcategorias de una principal.
      ...(query.parentId ? { parentId: query.parentId } : {}),
    };
  }
}
