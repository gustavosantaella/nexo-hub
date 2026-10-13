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
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(companyId: string, dto: CreateCategoryDto) {
    await this.assertNameAvailable(companyId, dto.name);
    return this.prisma.category.create({
      data: { ...dto, companyId, active: dto.active ?? true },
    });
  }

  async findAll(
    companyId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<unknown>> {
    const where: Prisma.CategoryWhereInput = {
      ...tenantWhere(companyId),
      ...(query.search ? { name: { contains: query.search } } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.category.findMany({
        where,
        // El conteo de productos tambien se aísla a la empresa activa.
        include: {
          _count: {
            select: { products: { where: tenantWhere(companyId) } },
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

  /** Listado simple (sin paginar) para selects de formularios. */
  findOptions(companyId: string) {
    return this.prisma.category.findMany({
      where: { active: true, ...tenantWhere(companyId) },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(companyId: string, id: string) {
    const category = await this.prisma.category.findFirst({
      where: { id, ...tenantWhere(companyId) },
    });
    if (!category) throw new NotFoundException('Categoria no encontrada');
    return category;
  }

  async update(companyId: string, id: string, dto: UpdateCategoryDto) {
    await this.findOne(companyId, id);
    if (dto.name !== undefined) {
      await this.assertNameAvailable(companyId, dto.name, id);
    }
    // updateMany + filtro por empresa: nunca se toca una categoria de otra.
    await this.prisma.category.updateMany({
      where: { id, ...tenantWhere(companyId) },
      data: dto,
    });
    return this.findOne(companyId, id);
  }

  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    // Al eliminar, Prisma pone categoryId = null en los productos (SetNull).
    return this.prisma.category.deleteMany({
      where: { id, ...tenantWhere(companyId) },
    });
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
