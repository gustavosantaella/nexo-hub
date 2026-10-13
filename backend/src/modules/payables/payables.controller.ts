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
  create(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: CreatePayableDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.payablesService.create(companyId, dto, user.id);
  }

  @Get()
  @ApiOperation({ summary: 'Listar cuentas por pagar (paginado + filtros)' })
  findAll(
    @CurrentUser('companyId') companyId: string,
    @Query() query: PayableQueryDto,
  ) {
    return this.payablesService.findAll(companyId, query);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Resumen por estado y saldo pendiente' })
  summary(@CurrentUser('companyId') companyId: string) {
    return this.payablesService.summary(companyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle con abonos' })
  findOne(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.payablesService.findOne(companyId, id);
  }

  @Patch(':id')
  @Roles(...FINANCE_ROLES)
  @ApiOperation({ summary: 'Actualizar cuenta' })
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePayableDto,
  ) {
    return this.payablesService.update(companyId, id, dto);
  }

  @Post(':id/payments')
  @Roles(...FINANCE_ROLES, Role.CASHIER)
  @ApiOperation({ summary: 'Registrar abono (egresa de caja si es efectivo)' })
  pay(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: PayPayableDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.payablesService.addPayment(companyId, id, dto, user.id);
  }

  @Post(':id/cancel')
  @Roles(...FINANCE_ROLES)
  @ApiOperation({ summary: 'Anular cuenta' })
  cancel(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.payablesService.cancel(companyId, id);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Eliminar cuenta sin abonos' })
  remove(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.payablesService.remove(companyId, id);
  }
}
