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
import { CreateMenuCategoryDto } from './dto/menu-category.dto';
import { MenuCategoryQueryDto } from './dto/menu-category-query.dto';
import { UpdateMenuCategoryDto } from './dto/update-menu-category.dto';
import { MenuCategoriesRepository } from './menu-categories.repository';

/**
 * Categorias de menu (Desayunos, Almuerzos, Combos...). Son independientes de
 * las categorias de productos: agrupan lo que el local VENDE, no lo que compra.
 * Admiten un nivel de subcategorias (`parentId`), siempre opcional.
 */
@Injectable()
export class MenuCategoriesService {
  constructor(private readonly categories: MenuCategoriesRepository) {}

  async create(companyId: string, dto: CreateMenuCategoryDto) {
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
    query: MenuCategoryQueryDto,
  ): Promise<PaginatedResult<unknown>> {
    const { items, total } = await this.categories.findPage(companyId, query);

    return buildPaginatedResult(items, total, query.page, query.limit);
  }

  /**
   * Listado simple (sin paginar) para selects, filtros del POS y el formulario
   * de menus. Respeta el orden de la carta (`sortOrder`) y deja las
   * subcategorias justo debajo de su principal para indentarlas en el select.
   */
  async findOptions(companyId: string) {
    const rows = await this.categories.findOptions(companyId);
    return sortCategoryHierarchy(
      rows,
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
    );
  }

  async findOne(companyId: string, id: string) {
    const category = await this.categories.findOne(companyId, id);
    if (!category) throw new NotFoundException('Categoria de menu no encontrada');
    return category;
  }

  async update(companyId: string, id: string, dto: UpdateMenuCategoryDto) {
    await this.findOne(companyId, id);
    if (dto.name !== undefined) {
      await this.assertNameAvailable(companyId, dto.name, id);
    }

    const data: Prisma.MenuCategoryUncheckedUpdateManyInput = { ...dto };
    if (dto.parentId !== undefined) {
      data.parentId = await this.resolveParentId(companyId, id, dto.parentId);
    }

    await this.categories.update(companyId, id, data);
    return this.findOne(companyId, id);
  }

  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    // Prisma pone categoryId = null en los menus y parentId = null en las
    // subcategorias (SetNull): no se pierden, las hijas quedan como principales.
    return this.categories.remove(companyId, id);
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

    const parent = await this.categories.findParentRef(companyId, parentId);
    if (!parent) {
      throw new BadRequestException(
        'La categoria de menu principal indicada no existe',
      );
    }
    if (parent.parentId) {
      throw new BadRequestException('Solo se permite un nivel de subcategorias');
    }

    if (!categoryId) return;
    const subcategory = await this.categories.findChildRef(companyId, categoryId);
    if (subcategory) {
      throw new BadRequestException(
        'Esta categoria tiene subcategorias: no puede ser subcategoria de otra',
      );
    }
  }

  /** El nombre de la categoria de menu es unico por empresa (no global). */
  private async assertNameAvailable(
    companyId: string,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.categories.findByName(companyId, name, excludeId);
    if (existing) {
      throw new ConflictException(
        'Ya existe una categoria de menu con ese nombre en esta empresa',
      );
    }
  }
}
