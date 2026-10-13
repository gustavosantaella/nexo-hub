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
  create(@Body() dto: CreateExpenseDto, @CurrentUser() user: AuthenticatedUser) {
    return this.expensesService.create(dto, user.id);
  }

  @Get()
  @ApiOperation({ summary: 'Listar gastos (paginado + filtros)' })
  findAll(@Query() query: ExpenseQueryDto) {
    return this.expensesService.findAll(query);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Totales por categoria y metodo de pago' })
  summary(@Query() query: ExpenseQueryDto) {
    return this.expensesService.summary(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle del gasto' })
  findOne(@Param('id') id: string) {
    return this.expensesService.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Actualizar gasto (solo si la caja sigue abierta)' })
  update(@Param('id') id: string, @Body() dto: UpdateExpenseDto) {
    return this.expensesService.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Eliminar gasto (solo si la caja sigue abierta)' })
  remove(@Param('id') id: string) {
    return this.expensesService.remove(id);
  }
}
