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
import {
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { CreateMovementDto } from './dto/create-movement.dto';
import { MovementQueryDto } from './dto/movement-query.dto';
import { InventoryService } from './inventory.service';

@ApiTags('Inventario')
@ApiBearerAuth()
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post('movements')
  @ApiOperation({ summary: 'Registrar movimiento de entrada/salida/ajuste' })
  createMovement(
    @Body() dto: CreateMovementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inventoryService.create(dto, user.id);
  }

  @Get('movements')
  @ApiOperation({ summary: 'Historial de movimientos (paginado)' })
  findMovements(@Query() query: MovementQueryDto) {
    return this.inventoryService.findMovements(query);
  }

  @Get('stock')
  @ApiOperation({ summary: 'Niveles de stock actuales' })
  stock(@Query('lowOnly') lowOnly?: string, @Query('search') search?: string) {
    return this.inventoryService.getStockLevels({
      lowOnly: lowOnly === 'true',
      search,
    });
  }

  @Get('low-stock')
  @ApiOperation({ summary: 'Productos bajo stock minimo' })
  lowStock() {
    return this.inventoryService.getStockLevels({ lowOnly: true });
  }

  @Post('products/:productId/adjust')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Ajustar stock de un producto a un valor final' })
  adjust(
    @Param('productId') productId: string,
    @Body() dto: AdjustStockDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inventoryService.adjustStock(productId, dto, user.id);
  }
}
