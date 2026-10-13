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
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { ReceivableQueryDto } from './dto/receivable-query.dto';
import {
  CollectReceivableDto,
  CreateReceivableDto,
  UpdateReceivableDto,
} from './dto/receivable.dto';
import { ReceivablesService } from './receivables.service';

const FINANCE_ROLES = [Role.ADMIN, Role.MANAGER];

@ApiTags('Cuentas por cobrar')
@ApiBearerAuth()
@Controller('receivables')
export class ReceivablesController {
  constructor(private readonly receivablesService: ReceivablesService) {}

  @Post()
  @Roles(...FINANCE_ROLES, Role.CASHIER)
  @ApiOperation({ summary: 'Registrar cuenta por cobrar' })
  create(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: CreateReceivableDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.receivablesService.create(companyId, dto, user.id);
  }

  @Get()
  @ApiOperation({ summary: 'Listar cuentas por cobrar (paginado + filtros)' })
  findAll(
    @CurrentUser('companyId') companyId: string,
    @Query() query: ReceivableQueryDto,
  ) {
    return this.receivablesService.findAll(companyId, query);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Resumen por estado y saldo por cobrar' })
  summary(@CurrentUser('companyId') companyId: string) {
    return this.receivablesService.summary(companyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle con cobros' })
  findOne(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.receivablesService.findOne(companyId, id);
  }

  @Patch(':id')
  @Roles(...FINANCE_ROLES)
  @ApiOperation({ summary: 'Actualizar cuenta' })
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateReceivableDto,
  ) {
    return this.receivablesService.update(companyId, id, dto);
  }

  @Post(':id/payments')
  @Roles(...FINANCE_ROLES, Role.CASHIER)
  @ApiOperation({ summary: 'Registrar cobro (ingresa a caja si es efectivo)' })
  collect(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: CollectReceivableDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.receivablesService.collect(companyId, id, dto, user.id);
  }

  @Post(':id/cancel')
  @Roles(...FINANCE_ROLES)
  @ApiOperation({ summary: 'Anular cuenta' })
  cancel(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.receivablesService.cancel(companyId, id);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Eliminar cuenta sin cobros' })
  remove(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.receivablesService.remove(companyId, id);
  }
}
