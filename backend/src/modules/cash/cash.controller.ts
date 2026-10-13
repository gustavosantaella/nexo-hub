import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '../../common/constants/enums';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { CashService } from './cash.service';
import { CashMovementQueryDto, CashSessionQueryDto } from './dto/cash-query.dto';
import { CloseSessionDto } from './dto/close-session.dto';
import { CreateCashMovementDto } from './dto/create-cash-movement.dto';
import { OpenSessionDto } from './dto/open-session.dto';

const CASH_ROLES = [Role.ADMIN, Role.MANAGER, Role.CASHIER];

@ApiTags('Caja')
@ApiBearerAuth()
@Controller('cash')
export class CashController {
  constructor(private readonly cashService: CashService) {}

  @Get('current')
  @ApiOperation({
    summary: 'Sesion de caja abierta + arqueo en vivo (session=null si esta cerrada)',
  })
  current(@CurrentUser('companyId') companyId: string) {
    return this.cashService.getCurrentSession(companyId);
  }

  @Post('open')
  @Roles(...CASH_ROLES)
  @ApiOperation({ summary: 'Abrir caja (fondo inicial)' })
  open(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: OpenSessionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.cashService.openSession(companyId, dto, user.id);
  }

  @Post('close')
  @Roles(...CASH_ROLES)
  @ApiOperation({ summary: 'Cerrar caja con arqueo (contado vs esperado)' })
  close(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: CloseSessionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.cashService.closeSession(companyId, dto, user.id);
  }

  @Post('movements')
  @Roles(...CASH_ROLES)
  @ApiOperation({ summary: 'Registrar ingreso/egreso manual de caja' })
  addMovement(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: CreateCashMovementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.cashService.addMovement(companyId, dto, user.id);
  }

  @Get('movements')
  @ApiOperation({ summary: 'Historial de movimientos de caja (paginado)' })
  movements(
    @CurrentUser('companyId') companyId: string,
    @Query() query: CashMovementQueryDto,
  ) {
    return this.cashService.listMovements(companyId, query);
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Historial de sesiones de caja (paginado)' })
  sessions(
    @CurrentUser('companyId') companyId: string,
    @Query() query: CashSessionQueryDto,
  ) {
    return this.cashService.listSessions(companyId, query);
  }

  @Get('sessions/:id')
  @ApiOperation({ summary: 'Detalle de una sesion con sus movimientos y arqueo' })
  session(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.cashService.getSessionById(companyId, id);
  }
}
