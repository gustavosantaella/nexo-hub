import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  type PaginatedResult,
  buildPaginatedResult,
  toSkip,
} from '../../common/utils/pagination.util';
import { sortCategoryHierarchy } from '../../common/utils/category-hierarchy.util';
import { normalizeNullableId } from '../../common/utils/normalize.util';
import { tenantWhere } from '../../common/utils/tenant.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CategoryQueryDto } from './dto/category-query.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

/** Datos del padre que viajan en el listado para pintar la jerarquia. */
const PARENT_SELECT = { select: { id: true, name: true } } as const;

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(companyId: string, dto: CreateCategoryDto) {
    await this.assertNameAvailable(companyId, dto.name);
    // La subcategoria es opcional: sin `parentId` la categoria es principal.
    const parentId = normalizeNullableId(dto.parentId);
    await this.assertParentAssignable(companyId, parentId);
    return this.prisma.category.create({
      data: { ...dto, parentId, companyId, active: dto.active ?? true },
    });
  }

  async findAll(
    companyId: string,
    query: CategoryQueryDto,
  ): Promise<PaginatedResult<unknown>> {
    const where: Prisma.CategoryWhereInput = {
      ...tenantWhere(companyId),
      ...(query.search ? { name: { contains: query.search } } : {}),
      // `parentId` filtra las subcategorias de una categoria principal.
      ...(query.parentId ? { parentId: query.parentId } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.category.findMany({
        where,
        include: {
          // La principal, para la columna del padre del listado.
          parent: PARENT_SELECT,
          // Los conteos tambien se aislan a la empresa activa.
          _count: {
            select: {
              products: { where: tenantWhere(companyId) },
              subcategories: { where: tenantWhere(companyId) },
            },
          },
        },
        orderBy: query.toOrderBy(['name', 'createdAt'], { name: 'asc' }),
        skip: toSkip(query.page, query.limit),
        take: query.limit,
      }),
      this.prisma.category.count({ where }),
    ]);

    return buildPaginatedResult(items, total, query.page, query.limit);
  }

  /**
   * Listado simple (sin paginar) para selects de formularios. Va ordenado en
   * jerarquia (cada principal y sus subcategorias justo debajo) para que el
   * `<option>` solo tenga que indentar las filas que traen `parentId`.
   */
  async findOptions(companyId: string) {
    const rows = await this.prisma.category.findMany({
      where: { active: true, ...tenantWhere(companyId) },
      select: { id: true, name: true, parentId: true },
    });
    return sortCategoryHierarchy(rows);
  }

  async findOne(companyId: string, id: string) {
    const category = await this.prisma.category.findFirst({
      where: { id, ...tenantWhere(companyId) },
      include: { parent: PARENT_SELECT },
    });
    if (!category) throw new NotFoundException('Categoria no encontrada');
    return category;
  }

  async update(companyId: string, id: string, dto: UpdateCategoryDto) {
    await this.findOne(companyId, id);
    if (dto.name !== undefined) {
      await this.assertNameAvailable(companyId, dto.name, id);
    }

    const data: Prisma.CategoryUncheckedUpdateManyInput = { ...dto };
    if (dto.parentId !== undefined) {
      data.parentId = await this.resolveParentId(companyId, id, dto.parentId);
    }

    // updateMany + filtro por empresa: nunca se toca una categoria de otra.
    await this.prisma.category.updateMany({
      where: { id, ...tenantWhere(companyId) },
      data,
    });
    return this.findOne(companyId, id);
  }

  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    // Al eliminar, Prisma pone categoryId = null en los productos y parentId =
    // null en las subcategorias (SetNull): nada se borra en cascada, las
    // subcategorias pasan a ser categorias principales.
    return this.prisma.category.deleteMany({
      where: { id, ...tenantWhere(companyId) },
    });
  }

  /** Normaliza el `parentId` recibido y valida la jerarquia antes de guardarlo. */
  private async resolveParentId(
    companyId: string,
    categoryId: string,
    parentId: string | null | undefined,
  ): Promise<string | null> {
    const parent = normalizeNullableId(parentId);
    await this.assertParentAssignable(companyId, parent, categoryId);
    return parent;
  }

  /**
   * Reglas de la jerarquia: como maximo dos niveles. El padre debe existir en la
   * empresa y ser una categoria principal; una categoria no puede ser su propia
   * principal ni convertirse en subcategoria si ya tiene subcategorias propias.
   */
  private async assertParentAssignable(
    companyId: string,
    parentId: string | null,
    categoryId?: string,
  ): Promise<void> {
    // Sin padre (o `null`) la categoria queda como principal: nada que validar.
    if (!parentId) return;

    if (parentId === categoryId) {
      throw new BadRequestException(
        'Una categoria no puede ser su propia categoria principal',
      );
    }

    const parent = await this.prisma.category.findFirst({
      where: { id: parentId, ...tenantWhere(companyId) },
      select: { id: true, parentId: true },
    });
    if (!parent) {
      throw new BadRequestException(
        'La categoria principal indicada no existe',
      );
    }
    if (parent.parentId) {
      throw new BadRequestException('Solo se permite un nivel de subcategorias');
    }

    if (!categoryId) return;
    const subcategory = await this.prisma.category.findFirst({
      where: { parentId: categoryId, ...tenantWhere(companyId) },
      select: { id: true },
    });
    if (subcategory) {
      throw new BadRequestException(
        'Esta categoria tiene subcategorias: no puede ser subcategoria de otra',
      );
    }
  }

  /** El nombre de categoria es unico por empresa (no global). */
  private async assertNameAvailable(
    companyId: string,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.prisma.category.findFirst({
      where: {
        ...tenantWhere(companyId),
        name,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        'Ya existe una categoria con ese nombre en esta empresa',
      );
    }
  }
}
