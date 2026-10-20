import { Injectable, NotFoundException } from '@nestjs/common';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import {
  buildPaginatedResult,
  type PaginatedResult,
} from '../../common/utils/pagination.util';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CustomersRepository } from './customers.repository';

@Injectable()
export class CustomersService {
  constructor(private readonly customers: CustomersRepository) {}

  create(companyId: string, dto: CreateCustomerDto) {
    return this.customers.create(companyId, dto);
  }

  async findAll(
    companyId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<unknown>> {
    const { items, total } = await this.customers.findPage(companyId, query);
    return buildPaginatedResult(items, total, query.page, query.limit);
  }

  findOptions(companyId: string) {
    return this.customers.findOptions(companyId);
  }

  async findOne(companyId: string, id: string) {
    const customer = await this.customers.findOne(companyId, id);
    if (!customer) throw new NotFoundException('Cliente no encontrado');
    return customer;
  }

  async update(companyId: string, id: string, dto: UpdateCustomerDto) {
    await this.findOne(companyId, id);
    await this.customers.update(companyId, id, dto);
    return this.findOne(companyId, id);
  }

  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    return this.customers.deactivate(companyId, id);
  }
}
