import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { toSkip } from '../../common/utils/pagination.util';
import { tenantWhere } from '../../common/utils/tenant.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CategoryQueryDto } from './dto/category-query.dto';

/** Datos del padre que viajan en el listado para pintar la jerarquia. */
const PARENT_SELECT = { select: { id: true, name: true } } as const;

/**
 * Acceso a datos de categorias. Toda consulta/escritura de Prisma del modulo
 * vive aqui: el servicio conserva las reglas de la jerarquia (un solo nivel,
 * nombre unico por empresa, aislamiento entre empresas), pero no conoce el
 * cliente de base de datos.
 */
@Injectable()
export class CategoriesRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.CategoryUncheckedCreateInput) {
    return this.prisma.category.create({ data });
  }

  async findPage(companyId: string, query: CategoryQueryDto) {
    const where = this.listWhere(companyId, query);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.category.findMany({
        where,
        include: this.listInclude(companyId),
        orderBy: query.toOrderBy(['name', 'createdAt'], { name: 'asc' }),
        skip: toSkip(query.page, query.limit),
        take: query.limit,
      }),
      this.prisma.category.count({ where }),
    ]);

    return { items, total };
  }

  /** Filas minimas para armar los selects de formularios. */
  findOptions(companyId: string) {
    return this.prisma.category.findMany({
      where: { active: true, ...tenantWhere(companyId) },
      select: { id: true, name: true, parentId: true },
    });
  }

  findOne(companyId: string, id: string) {
    return this.prisma.category.findFirst({
      where: { id, ...tenantWhere(companyId) },
      include: { parent: PARENT_SELECT },
    });
  }

  updateMany(
    companyId: string,
    id: string,
    data: Prisma.CategoryUncheckedUpdateManyInput,
  ) {
    return this.prisma.category.updateMany({
      where: { id, ...tenantWhere(companyId) },
      data,
    });
  }

  /**
   * Al eliminar, Prisma pone categoryId = null en los productos y parentId =
   * null en las subcategorias (SetNull): nada se borra en cascada.
   */
  deleteMany(companyId: string, id: string) {
    return this.prisma.category.deleteMany({
      where: { id, ...tenantWhere(companyId) },
    });
  }

  /** Categoria indicada como principal (para validar la jerarquia). */
  findParent(companyId: string, parentId: string) {
    return this.prisma.category.findFirst({
      where: { id: parentId, ...tenantWhere(companyId) },
      select: { id: true, parentId: true },
    });
  }

  /** Primera subcategoria de la categoria (una categoria con hijas no se cuelga). */
  findSubcategory(companyId: string, categoryId: string) {
    return this.prisma.category.findFirst({
      where: { parentId: categoryId, ...tenantWhere(companyId) },
      select: { id: true },
    });
  }

  /** El nombre es unico por empresa (no global). */
  findByName(companyId: string, name: string, excludeId?: string) {
    return this.prisma.category.findFirst({
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
    query: CategoryQueryDto,
  ): Prisma.CategoryWhereInput {
    return {
      ...tenantWhere(companyId),
      ...(query.search ? { name: { contains: query.search } } : {}),
      // `parentId` filtra las subcategorias de una categoria principal.
      ...(query.parentId ? { parentId: query.parentId } : {}),
    };
  }

  private listInclude(companyId: string): Prisma.CategoryInclude {
    return {
      // La principal, para la columna del padre del listado.
      parent: PARENT_SELECT,
      // Los conteos tambien se aislan a la empresa activa.
      _count: {
        select: {
          products: { where: tenantWhere(companyId) },
          subcategories: { where: tenantWhere(companyId) },
        },
      },
    };
  }
}
