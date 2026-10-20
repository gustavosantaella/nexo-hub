import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { toSkip } from '../../common/utils/pagination.util';
import { tenantWhere } from '../../common/utils/tenant.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';

/**
 * Acceso a datos de proveedores. Toda consulta/escritura de Prisma del modulo
 * vive aqui: el servicio no conoce el cliente de base de datos.
 */
@Injectable()
export class SuppliersRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(companyId: string, dto: CreateSupplierDto) {
    return this.prisma.supplier.create({
      data: { ...dto, companyId, active: dto.active ?? true },
    });
  }

  async findPage(companyId: string, query: PaginationQueryDto) {
    const where = this.listWhere(companyId, query);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.supplier.findMany({
        where,
        include: this.listInclude(companyId),
        orderBy: query.toOrderBy(['name', 'createdAt'], { name: 'asc' }),
        skip: toSkip(query.page, query.limit),
        take: query.limit,
      }),
      this.prisma.supplier.count({ where }),
    ]);

    return { items, total };
  }

  findOptions(companyId: string) {
    return this.prisma.supplier.findMany({
      where: { active: true, ...tenantWhere(companyId) },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  findOne(companyId: string, id: string) {
    return this.prisma.supplier.findFirst({
      where: { id, ...tenantWhere(companyId) },
    });
  }

  update(companyId: string, id: string, data: UpdateSupplierDto) {
    return this.prisma.supplier.updateMany({
      where: { id, ...tenantWhere(companyId) },
      data,
    });
  }

  /** Baja logica: el proveedor sigue existiendo para el historial de compras. */
  deactivate(companyId: string, id: string) {
    return this.prisma.supplier.updateMany({
      where: { id, ...tenantWhere(companyId) },
      data: { active: false },
    });
  }

  private listWhere(
    companyId: string,
    query: PaginationQueryDto,
  ): Prisma.SupplierWhereInput {
    return {
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
  }

  /** Los conteos anidados tambien se aislan a la empresa activa. */
  private listInclude(companyId: string): Prisma.SupplierInclude {
    return {
      _count: {
        select: {
          products: { where: tenantWhere(companyId) },
          payables: { where: tenantWhere(companyId) },
        },
      },
    };
  }
}
