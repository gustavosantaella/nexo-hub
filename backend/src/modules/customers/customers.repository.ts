import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { toSkip } from '../../common/utils/pagination.util';
import { tenantWhere } from '../../common/utils/tenant.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

/**
 * Acceso a datos de clientes. Toda consulta/escritura de Prisma del modulo vive
 * aqui: el servicio no conoce el cliente de base de datos.
 */
@Injectable()
export class CustomersRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(companyId: string, dto: CreateCustomerDto) {
    return this.prisma.customer.create({
      data: { ...dto, companyId, active: dto.active ?? true },
    });
  }

  async findPage(companyId: string, query: PaginationQueryDto) {
    const where = this.listWhere(companyId, query);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        include: this.listInclude(companyId),
        orderBy: query.toOrderBy(['name', 'createdAt'], { name: 'asc' }),
        skip: toSkip(query.page, query.limit),
        take: query.limit,
      }),
      this.prisma.customer.count({ where }),
    ]);

    return { items, total };
  }

  findOptions(companyId: string) {
    return this.prisma.customer.findMany({
      where: { active: true, ...tenantWhere(companyId) },
      select: { id: true, name: true, phone: true },
      orderBy: { name: 'asc' },
    });
  }

  findOne(companyId: string, id: string) {
    return this.prisma.customer.findFirst({
      where: { id, ...tenantWhere(companyId) },
    });
  }

  update(companyId: string, id: string, data: UpdateCustomerDto) {
    return this.prisma.customer.updateMany({
      where: { id, ...tenantWhere(companyId) },
      data,
    });
  }

  /** Baja logica: el cliente sigue existiendo para el historial de pedidos. */
  deactivate(companyId: string, id: string) {
    return this.prisma.customer.updateMany({
      where: { id, ...tenantWhere(companyId) },
      data: { active: false },
    });
  }

  private listWhere(
    companyId: string,
    query: PaginationQueryDto,
  ): Prisma.CustomerWhereInput {
    return {
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
  }

  /** Los conteos anidados tambien se aislan a la empresa activa. */
  private listInclude(companyId: string): Prisma.CustomerInclude {
    return {
      _count: {
        select: {
          orders: { where: tenantWhere(companyId) },
          receivables: { where: tenantWhere(companyId) },
        },
      },
    };
  }
}
