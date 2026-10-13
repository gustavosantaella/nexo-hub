import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '../../common/constants/enums';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

/**
 * Empresas. Cualquier usuario autenticado ve las suyas y puede crear una
 * nueva; editar los datos de la empresa activa queda para ADMIN/MANAGER.
 */
@ApiTags('Empresas')
@ApiBearerAuth()
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Get('mine')
  @ApiOperation({ summary: 'Empresas a las que pertenece el usuario' })
  mine(@CurrentUser('id') userId: string) {
    return this.companiesService.listMine(userId);
  }

  @Get('current')
  @ApiOperation({ summary: 'Datos de la empresa activa' })
  current(@CurrentUser('companyId') companyId: string) {
    return this.companiesService.current(companyId);
  }

  @Post()
  @ApiOperation({ summary: 'Crear una empresa (el usuario queda como ADMIN)' })
  create(@CurrentUser('id') userId: string, @Body() dto: CreateCompanyDto) {
    return this.companiesService.create(userId, dto);
  }

  @Patch('current')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Editar los datos de la empresa activa' })
  update(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: UpdateCompanyDto,
  ) {
    return this.companiesService.update(companyId, dto);
  }
}
