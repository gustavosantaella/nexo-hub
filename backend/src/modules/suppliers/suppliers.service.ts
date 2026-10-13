import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import {
  buildPaginatedResult,
  toSkip,
  type PaginatedResult,
} from '../../common/utils/pagination.util';
import { tenantWhere } from '../../common/utils/tenant.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';

@Injectable()
export class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  create(companyId: string, dto: CreateSupplierDto) {
    return this.prisma.supplier.create({
      data: { ...dto, companyId, active: dto.active ?? true },
    });
  }

  async findAll(
    companyId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<unknown>> {
    const where: Prisma.SupplierWhereInput = {
      ...tenantWhere(companyId),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search } },
              { contactName: { contains: query.search } },
              { phone: { contains: query.search } },
              { taxId: { contains: query.search } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.supplier.findMany({
        where,
        // Los conteos anidados tambien se aíslan a la empresa activa.
        include: {
          _count: {
            select: {
              products: { where: tenantWhere(companyId) },
              payables: { where: tenantWhere(companyId) },
            },
          },
        },
        orderBy: query.toOrderBy(['name', 'createdAt'], { name: 'asc' }),
        skip: toSkip(query.page, query.limit),
        take: query.limit,
      }),
      this.prisma.supplier.count({ where }),
    ]);

    return buildPaginatedResult(items, total, query.page, query.limit);
  }

  findOptions(companyId: string) {
    return this.prisma.supplier.findMany({
      where: { active: true, ...tenantWhere(companyId) },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(companyId: string, id: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, ...tenantWhere(companyId) },
    });
    if (!supplier) throw new NotFoundException('Proveedor no encontrado');
    return supplier;
  }

  async update(companyId: string, id: string, dto: UpdateSupplierDto) {
    await this.findOne(companyId, id);
    await this.prisma.supplier.updateMany({
      where: { id, ...tenantWhere(companyId) },
      data: dto,
    });
    return this.findOne(companyId, id);
  }

  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    return this.prisma.supplier.updateMany({
      where: { id, ...tenantWhere(companyId) },
      data: { active: false },
    });
  }
}
