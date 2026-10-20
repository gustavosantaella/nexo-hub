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
  create(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: CreateOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ordersService.create(companyId, dto, user.id);
  }

  @Get()
  @ApiOperation({ summary: 'Listar pedidos (paginado + filtros)' })
  findAll(
    @CurrentUser('companyId') companyId: string,
    @Query() query: OrderQueryDto,
  ) {
    return this.ordersService.findAll(companyId, query);
  }

  @Get('active')
  @ApiOperation({ summary: 'Pedidos activos (tablero de cocina/salon)' })
  active(@CurrentUser('companyId') companyId: string) {
    return this.ordersService.findActiveOrders(companyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle del pedido (items y pagos)' })
  findOne(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.ordersService.findOne(companyId, id);
  }

  @Patch(':id')
  @Roles(...ORDER_ROLES)
  @ApiOperation({ summary: 'Actualizar datos y recalcular totales' })
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateOrderDto,
  ) {
    return this.ordersService.update(companyId, id, dto);
  }

  @Post(':id/items')
  @Roles(...ORDER_ROLES)
  @ApiOperation({ summary: 'Agregar productos a un pedido (descuenta stock)' })
  addItems(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: AddOrderItemsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ordersService.addItems(companyId, id, dto, user.id);
  }

  @Patch(':id/items/:itemId')
  @Roles(...ORDER_ROLES)
  @ApiOperation({ summary: 'Corregir la cantidad de un producto (ajusta el stock)' })
  updateItem(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateOrderItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ordersService.updateItem(companyId, id, itemId, dto, user.id);
  }

  @Delete(':id/items/:itemId')
  @Roles(...ORDER_ROLES)
  @ApiOperation({ summary: 'Quitar un producto del pedido (devuelve stock)' })
  removeItem(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ordersService.removeItem(companyId, id, itemId, user.id);
  }

  @Patch(':id/status')
  @Roles(...ORDER_ROLES)
  @ApiOperation({ summary: 'Cambiar estado (cancelar devuelve stock)' })
  updateStatus(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ordersService.updateStatus(
      companyId,
      id,
      dto,
      user.id,
      user.role,
    );
  }

  @Post(':id/cancellation-otp')
  @Roles(...ORDER_ROLES)
  @ApiOperation({
    summary: 'Enviar al administrador el código OTP para cancelar el pedido',
  })
  requestCancellationOtp(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ordersService.requestCancellationOtp(companyId, id, user.id);
  }

  @Post(':id/payments')
  @Roles(...ORDER_ROLES)
  @ApiOperation({ summary: 'Registrar cobro (entra a caja como SALE)' })
  pay(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: AddOrderPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ordersService.addPayment(companyId, id, dto, user.id);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Eliminar pedido sin pagos (devuelve stock)' })
  remove(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ordersService.remove(companyId, id, user.id);
  }
}
