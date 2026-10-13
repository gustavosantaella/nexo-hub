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
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { SuppliersService } from './suppliers.service';

@ApiTags('Proveedores')
@ApiBearerAuth()
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Crear proveedor' })
  create(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: CreateSupplierDto,
  ) {
    return this.suppliersService.create(companyId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar proveedores (paginado)' })
  findAll(
    @CurrentUser('companyId') companyId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.suppliersService.findAll(companyId, query);
  }

  @Get('options')
  @ApiOperation({ summary: 'Proveedores activos para selects' })
  findOptions(@CurrentUser('companyId') companyId: string) {
    return this.suppliersService.findOptions(companyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener proveedor por id' })
  findOne(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.suppliersService.findOne(companyId, id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Actualizar proveedor' })
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
  ) {
    return this.suppliersService.update(companyId, id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Desactivar proveedor' })
  remove(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.suppliersService.remove(companyId, id);
  }
}
