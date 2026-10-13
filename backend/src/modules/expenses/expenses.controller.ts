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
import { CreateExpenseDto } from './dto/create-expense.dto';
import { ExpenseQueryDto } from './dto/expense-query.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { ExpensesService } from './expenses.service';

const EXPENSE_ROLES = [Role.ADMIN, Role.MANAGER, Role.CASHIER];

@ApiTags('Gastos')
@ApiBearerAuth()
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Post()
  @Roles(...EXPENSE_ROLES)
  @ApiOperation({ summary: 'Registrar gasto (egreso automatico si es efectivo)' })
  create(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: CreateExpenseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.expensesService.create(companyId, dto, user.id);
  }

  @Get()
  @ApiOperation({ summary: 'Listar gastos (paginado + filtros)' })
  findAll(
    @CurrentUser('companyId') companyId: string,
    @Query() query: ExpenseQueryDto,
  ) {
    return this.expensesService.findAll(companyId, query);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Totales por categoria y metodo de pago' })
  summary(
    @CurrentUser('companyId') companyId: string,
    @Query() query: ExpenseQueryDto,
  ) {
    return this.expensesService.summary(companyId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle del gasto' })
  findOne(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.expensesService.findOne(companyId, id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Actualizar gasto (solo si la caja sigue abierta)' })
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateExpenseDto,
  ) {
    return this.expensesService.update(companyId, id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Eliminar gasto (solo si la caja sigue abierta)' })
  remove(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.expensesService.remove(companyId, id);
  }
}

