import { Injectable, NotFoundException } from '@nestjs/common';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import {
  buildPaginatedResult,
  type PaginatedResult,
} from '../../common/utils/pagination.util';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { SuppliersRepository } from './suppliers.repository';

@Injectable()
export class SuppliersService {
  constructor(private readonly suppliers: SuppliersRepository) {}

  create(companyId: string, dto: CreateSupplierDto) {
    return this.suppliers.create(companyId, dto);
  }

  async findAll(
    companyId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<unknown>> {
    const { items, total } = await this.suppliers.findPage(companyId, query);
    return buildPaginatedResult(items, total, query.page, query.limit);
  }

  findOptions(companyId: string) {
    return this.suppliers.findOptions(companyId);
  }

  async findOne(companyId: string, id: string) {
    const supplier = await this.suppliers.findOne(companyId, id);
    if (!supplier) throw new NotFoundException('Proveedor no encontrado');
    return supplier;
  }

  async update(companyId: string, id: string, dto: UpdateSupplierDto) {
    await this.findOne(companyId, id);
    await this.suppliers.update(companyId, id, dto);
    return this.findOne(companyId, id);
  }

  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    return this.suppliers.deactivate(companyId, id);
  }
}
