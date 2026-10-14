import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import {
  buildPaginatedResult,
  toSkip,
  type PaginatedResult,
} from '../../common/utils/pagination.util';
import { tenantWhere } from '../../common/utils/tenant.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateMenuCategoryDto } from './dto/menu-category.dto';
import { UpdateMenuCategoryDto } from './dto/update-menu-category.dto';

/**
 * Categorias de menu (Desayunos, Almuerzos, Combos...). Son independientes de
 * las categorias de productos: agrupan lo que el local VENDE, no lo que compra.
 */
@Injectable()
export class MenuCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(companyId: string, dto: CreateMenuCategoryDto) {
    await this.assertNameAvailable(companyId, dto.name);
    return this.prisma.menuCategory.create({
      data: { ...dto, companyId, active: dto.active ?? true },
    });
  }

  async findAll(
    companyId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<unknown>> {
    const where: Prisma.MenuCategoryWhereInput = {
      ...tenantWhere(companyId),
      ...(query.search ? { name: { contains: query.search } } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.menuCategory.findMany({
        where,
        // El conteo de menus tambien se aisla a la empresa activa.
        include: {
          _count: { select: { menus: { where: tenantWhere(companyId) } } },
        },
        orderBy: query.toOrderBy(['name', 'sortOrder', 'createdAt'], {
          sortOrder: 'asc',
        }),
        skip: toSkip(query.page, query.limit),
        take: query.limit,
      }),
      this.prisma.menuCategory.count({ where }),
    ]);

    return buildPaginatedResult(items, total, query.page, query.limit);
  }

  /** Listado simple (sin paginar) para selects y filtros del POS. */
  findOptions(companyId: string) {
    return this.prisma.menuCategory.findMany({
      where: { active: true, ...tenantWhere(companyId) },
      select: { id: true, name: true, color: true, sortOrder: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async findOne(companyId: string, id: string) {
    const category = await this.prisma.menuCategory.findFirst({
      where: { id, ...tenantWhere(companyId) },
    });
    if (!category) throw new NotFoundException('Categoria de menu no encontrada');
    return category;
  }

  async update(companyId: string, id: string, dto: UpdateMenuCategoryDto) {
    await this.findOne(companyId, id);
    if (dto.name !== undefined) {
      await this.assertNameAvailable(companyId, dto.name, id);
    }
    await this.prisma.menuCategory.updateMany({
      where: { id, ...tenantWhere(companyId) },
      data: dto,
    });
    return this.findOne(companyId, id);
  }

  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    // Prisma pone categoryId = null en los menus (SetNull): no se pierden.
    return this.prisma.menuCategory.deleteMany({
      where: { id, ...tenantWhere(companyId) },
    });
  }

  /** El nombre de la categoria de menu es unico por empresa (no global). */
  private async assertNameAvailable(
    companyId: string,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.prisma.menuCategory.findFirst({
      where: {
        ...tenantWhere(companyId),
        name,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        'Ya existe una categoria de menu con ese nombre en esta empresa',
      );
    }
  }
}
