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
  current() {
    return this.cashService.getCurrentSession();
  }

  @Post('open')
  @Roles(...CASH_ROLES)
  @ApiOperation({ summary: 'Abrir caja (fondo inicial)' })
  open(@Body() dto: OpenSessionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.cashService.openSession(dto, user.id);
  }

  @Post('close')
  @Roles(...CASH_ROLES)
  @ApiOperation({ summary: 'Cerrar caja con arqueo (contado vs esperado)' })
  close(@Body() dto: CloseSessionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.cashService.closeSession(dto, user.id);
  }

  @Post('movements')
  @Roles(...CASH_ROLES)
  @ApiOperation({ summary: 'Registrar ingreso/egreso manual de caja' })
  addMovement(
    @Body() dto: CreateCashMovementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.cashService.addMovement(dto, user.id);
  }

  @Get('movements')
  @ApiOperation({ summary: 'Historial de movimientos de caja (paginado)' })
  movements(@Query() query: CashMovementQueryDto) {
    return this.cashService.listMovements(query);
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Historial de sesiones de caja (paginado)' })
  sessions(@Query() query: CashSessionQueryDto) {
    return this.cashService.listSessions(query);
  }

  @Get('sessions/:id')
  @ApiOperation({ summary: 'Detalle de una sesion con sus movimientos y arqueo' })
  session(@Param('id') id: string) {
    return this.cashService.getSessionById(id);
  }
}
