import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '../../common/constants/enums';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@ApiTags('Clientes')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  @ApiOperation({ summary: 'Crear cliente' })
  create(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: CreateCustomerDto,
  ) {
    return this.customersService.create(companyId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar clientes (paginado)' })
  findAll(
    @CurrentUser('companyId') companyId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.customersService.findAll(companyId, query);
  }

  @Get('options')
  @ApiOperation({ summary: 'Clientes activos para selects' })
  findOptions(@CurrentUser('companyId') companyId: string) {
    return this.customersService.findOptions(companyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener cliente por id' })
  findOne(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.customersService.findOne(companyId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar cliente' })
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customersService.update(companyId, id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Desactivar cliente' })
  remove(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.customersService.remove(companyId, id);
  }
}
