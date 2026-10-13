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
    @Body() dto: CreateReceivableDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.receivablesService.create(dto, user.id);
  }

  @Get()
  @ApiOperation({ summary: 'Listar cuentas por cobrar (paginado + filtros)' })
  findAll(@Query() query: ReceivableQueryDto) {
    return this.receivablesService.findAll(query);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Resumen por estado y saldo por cobrar' })
  summary() {
    return this.receivablesService.summary();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle con cobros' })
  findOne(@Param('id') id: string) {
    return this.receivablesService.findOne(id);
  }

  @Patch(':id')
  @Roles(...FINANCE_ROLES)
  @ApiOperation({ summary: 'Actualizar cuenta' })
  update(@Param('id') id: string, @Body() dto: UpdateReceivableDto) {
    return this.receivablesService.update(id, dto);
  }

  @Post(':id/payments')
  @Roles(...FINANCE_ROLES, Role.CASHIER)
  @ApiOperation({ summary: 'Registrar cobro (ingresa a caja si es efectivo)' })
  collect(
    @Param('id') id: string,
    @Body() dto: CollectReceivableDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.receivablesService.collect(id, dto, user.id);
  }

  @Post(':id/cancel')
  @Roles(...FINANCE_ROLES)
  @ApiOperation({ summary: 'Anular cuenta' })
  cancel(@Param('id') id: string) {
    return this.receivablesService.cancel(id);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Eliminar cuenta sin cobros' })
  remove(@Param('id') id: string) {
    return this.receivablesService.remove(id);
  }
}
