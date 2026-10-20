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
} from '../../common/utils/pagination.util';
import { sortCategoryHierarchy } from '../../common/utils/category-hierarchy.util';
import { normalizeNullableId } from '../../common/utils/normalize.util';
import { CategoriesRepository } from './categories.repository';
import { CategoryQueryDto } from './dto/category-query.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly categories: CategoriesRepository) {}

  async create(companyId: string, dto: CreateCategoryDto) {
    await this.assertNameAvailable(companyId, dto.name);
    // La subcategoria es opcional: sin `parentId` la categoria es principal.
    const parentId = normalizeNullableId(dto.parentId);
    await this.assertParentAssignable(companyId, parentId);
    return this.categories.create({
      ...dto,
      parentId,
      companyId,
      active: dto.active ?? true,
    });
  }

  async findAll(
    companyId: string,
    query: CategoryQueryDto,
  ): Promise<PaginatedResult<unknown>> {
    const { items, total } = await this.categories.findPage(companyId, query);
    return buildPaginatedResult(items, total, query.page, query.limit);
  }

  /**
   * Listado simple (sin paginar) para selects de formularios. Va ordenado en
   * jerarquia (cada principal y sus subcategorias justo debajo) para que el
   * `<option>` solo tenga que indentar las filas que traen `parentId`.
   */
  async findOptions(companyId: string) {
    const rows = await this.categories.findOptions(companyId);
    return sortCategoryHierarchy(rows);
  }

  async findOne(companyId: string, id: string) {
    const category = await this.categories.findOne(companyId, id);
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
    await this.categories.updateMany(companyId, id, data);
    return this.findOne(companyId, id);
  }

  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    // Al eliminar, Prisma pone categoryId = null en los productos y parentId =
    // null en las subcategorias (SetNull): nada se borra en cascada, las
    // subcategorias pasan a ser categorias principales.
    return this.categories.deleteMany(companyId, id);
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

    const parent = await this.categories.findParent(companyId, parentId);
    if (!parent) {
      throw new BadRequestException(
        'La categoria principal indicada no existe',
      );
    }
    if (parent.parentId) {
      throw new BadRequestException('Solo se permite un nivel de subcategorias');
    }

    if (!categoryId) return;
    const subcategory = await this.categories.findSubcategory(
      companyId,
      categoryId,
    );
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
    const existing = await this.categories.findByName(
      companyId,
      name,
      excludeId,
    );
    if (existing) {
      throw new ConflictException(
        'Ya existe una categoria con ese nombre en esta empresa',
      );
    }
  }
}
