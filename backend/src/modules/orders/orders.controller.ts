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
import {
  AddOrderItemsDto,
  AddOrderPaymentDto,
  CreateOrderDto,
  UpdateOrderDto,
  UpdateOrderItemDto,
} from './dto/order.dto';
import { OrderQueryDto, UpdateOrderStatusDto } from './dto/order-query.dto';
import { OrdersService } from './orders.service';

const ORDER_ROLES = [Role.ADMIN, Role.MANAGER, Role.CASHIER];

@ApiTags('Pedidos')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @Roles(...ORDER_ROLES)
  @ApiOperation({ summary: 'Crear pedido (descuenta stock)' })
  create(@Body() dto: CreateOrderDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ordersService.create(dto, user.id);
  }

  @Get()
  @ApiOperation({ summary: 'Listar pedidos (paginado + filtros)' })
  findAll(@Query() query: OrderQueryDto) {
    return this.ordersService.findAll(query);
  }

  @Get('active')
  @ApiOperation({ summary: 'Pedidos activos (tablero de cocina/salon)' })
  active() {
    return this.ordersService.findActiveOrders();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle del pedido (items y pagos)' })
  findOne(@Param('id') id: string) {
    return this.ordersService.findOne(id);
  }

  @Patch(':id')
  @Roles(...ORDER_ROLES)
  @ApiOperation({ summary: 'Actualizar datos y recalcular totales' })
  update(@Param('id') id: string, @Body() dto: UpdateOrderDto) {
    return this.ordersService.update(id, dto);
  }

  @Post(':id/items')
  @Roles(...ORDER_ROLES)
  @ApiOperation({ summary: 'Agregar productos a un pedido (descuenta stock)' })
  addItems(
    @Param('id') id: string,
    @Body() dto: AddOrderItemsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ordersService.addItems(id, dto, user.id);
  }

  @Patch(':id/items/:itemId')
  @Roles(...ORDER_ROLES)
  @ApiOperation({ summary: 'Corregir la cantidad de un producto (ajusta el stock)' })
  updateItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateOrderItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ordersService.updateItem(id, itemId, dto, user.id);
  }

  @Delete(':id/items/:itemId')
  @Roles(...ORDER_ROLES)
  @ApiOperation({ summary: 'Quitar un producto del pedido (devuelve stock)' })
  removeItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ordersService.removeItem(id, itemId, user.id);
  }

  @Patch(':id/status')
  @Roles(...ORDER_ROLES)
  @ApiOperation({ summary: 'Cambiar estado (cancelar devuelve stock)' })
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ordersService.updateStatus(id, dto, user.id);
  }

  @Post(':id/payments')
  @Roles(...ORDER_ROLES)
  @ApiOperation({ summary: 'Registrar cobro (entra a caja como SALE)' })
  pay(
    @Param('id') id: string,
    @Body() dto: AddOrderPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ordersService.addPayment(id, dto, user.id);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Eliminar pedido sin pagos (devuelve stock)' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.ordersService.remove(id, user.id);
  }
}
