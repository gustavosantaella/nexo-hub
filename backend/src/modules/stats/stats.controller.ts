import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StatsQueryDto } from './dto/stats-query.dto';
import { StatsService } from './stats.service';

@ApiTags('Estadisticas')
@ApiBearerAuth()
@Controller('stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Resumen del panel principal' })
  dashboard() {
    return this.statsService.dashboard();
  }

  @Get('sales')
  @ApiOperation({ summary: 'Serie de ventas / gastos / utilidad' })
  sales(@Query() query: StatsQueryDto) {
    return this.statsService.salesSeries(query);
  }

  @Get('top-products')
  @ApiOperation({ summary: 'Productos mas vendidos' })
  topProducts(@Query() query: StatsQueryDto) {
    return this.statsService.topProducts(query);
  }

  @Get('payment-methods')
  @ApiOperation({ summary: 'Cobros por metodo de pago' })
  paymentMethods(@Query() query: StatsQueryDto) {
    return this.statsService.paymentsByMethod(query);
  }

  @Get('currencies')
  @ApiOperation({ summary: 'Cobros agrupados por moneda (monto original + USD)' })
  currencies(@Query() query: StatsQueryDto) {
    return this.statsService.paymentsByCurrency(query);
  }

  @Get('categories')
  @ApiOperation({ summary: 'Ventas por categoria de producto' })
  categories(@Query() query: StatsQueryDto) {
    return this.statsService.salesByCategory(query);
  }

  @Get('low-stock')
  @ApiOperation({ summary: 'Productos con stock bajo' })
  lowStock(@Query() query: StatsQueryDto) {
    return this.statsService.lowStockProducts(query.limit);
  }
}
