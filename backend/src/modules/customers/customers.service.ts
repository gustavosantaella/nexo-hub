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
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  create(companyId: string, dto: CreateCustomerDto) {
    return this.prisma.customer.create({
      data: { ...dto, companyId, active: dto.active ?? true },
    });
  }

  async findAll(
    companyId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<unknown>> {
    const where: Prisma.CustomerWhereInput = {
      ...tenantWhere(companyId),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search } },
              { phone: { contains: query.search } },
              { docNumber: { contains: query.search } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        // Los conteos anidados tambien se aíslan a la empresa activa.
        include: {
          _count: {
            select: {
              orders: { where: tenantWhere(companyId) },
              receivables: { where: tenantWhere(companyId) },
            },
          },
        },
        orderBy: query.toOrderBy(['name', 'createdAt'], { name: 'asc' }),
        skip: toSkip(query.page, query.limit),
        take: query.limit,
      }),
      this.prisma.customer.count({ where }),
    ]);

    return buildPaginatedResult(items, total, query.page, query.limit);
  }

  findOptions(companyId: string) {
    return this.prisma.customer.findMany({
      where: { active: true, ...tenantWhere(companyId) },
      select: { id: true, name: true, phone: true },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(companyId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, ...tenantWhere(companyId) },
    });
    if (!customer) throw new NotFoundException('Cliente no encontrado');
    return customer;
  }

  async update(companyId: string, id: string, dto: UpdateCustomerDto) {
    await this.findOne(companyId, id);
    await this.prisma.customer.updateMany({
      where: { id, ...tenantWhere(companyId) },
      data: dto,
    });
    return this.findOne(companyId, id);
  }

  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    return this.prisma.customer.updateMany({
      where: { id, ...tenantWhere(companyId) },
      data: { active: false },
    });
  }
}
