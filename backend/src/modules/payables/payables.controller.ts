import { Role } from '../../common/constants/enums';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { PayableQueryDto } from './dto/payable-query.dto';
import {
  CreatePayableDto,
  PayPayableDto,
  UpdatePayableDto,
} from './dto/payable.dto';
import { PayablesService } from './payables.service';
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

const FINANCE_ROLES = [Role.ADMIN, Role.MANAGER];

@ApiTags('Cuentas por pagar')
@ApiBearerAuth()
@Controller('payables')
export class PayablesController {
  constructor(private readonly payablesService: PayablesService) {}

  @Post()
  @Roles(...FINANCE_ROLES, Role.CASHIER)
  @ApiOperation({ summary: 'Registrar cuenta por pagar' })
  create(@Body() dto: CreatePayableDto, @CurrentUser() user: AuthenticatedUser) {
    return this.payablesService.create(dto, user.id);
  }

  @Get()
  @ApiOperation({ summary: 'Listar cuentas por pagar (paginado + filtros)' })
  findAll(@Query() query: PayableQueryDto) {
    return this.payablesService.findAll(query);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Resumen por estado y saldo pendiente' })
  summary() {
    return this.payablesService.summary();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle con abonos' })
  findOne(@Param('id') id: string) {
    return this.payablesService.findOne(id);
  }

  @Patch(':id')
  @Roles(...FINANCE_ROLES)
  @ApiOperation({ summary: 'Actualizar cuenta' })
  update(@Param('id') id: string, @Body() dto: UpdatePayableDto) {
    return this.payablesService.update(id, dto);
  }

  @Post(':id/payments')
  @Roles(...FINANCE_ROLES, Role.CASHIER)
  @ApiOperation({ summary: 'Registrar abono (egresa de caja si es efectivo)' })
  pay(
    @Param('id') id: string,
    @Body() dto: PayPayableDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.payablesService.addPayment(id, dto, user.id);
  }

  @Post(':id/cancel')
  @Roles(...FINANCE_ROLES)
  @ApiOperation({ summary: 'Anular cuenta' })
  cancel(@Param('id') id: string) {
    return this.payablesService.cancel(id);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Eliminar cuenta sin abonos' })
  remove(@Param('id') id: string) {
    return this.payablesService.remove(id);
  }
}
