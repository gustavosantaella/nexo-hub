import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { StatsQueryDto } from './dto/stats-query.dto';
import { StatsService } from './stats.service';

@ApiTags('Estadisticas')
@ApiBearerAuth()
@Controller('stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Resumen del panel principal' })
  dashboard(@CurrentUser('companyId') companyId: string) {
    return this.statsService.dashboard(companyId);
  }

  @Get('sales')
  @ApiOperation({ summary: 'Serie de ventas / gastos / utilidad' })
  sales(
    @CurrentUser('companyId') companyId: string,
    @Query() query: StatsQueryDto,
  ) {
    return this.statsService.salesSeries(companyId, query);
  }

  @Get('top-products')
  @ApiOperation({ summary: 'Productos mas vendidos' })
  topProducts(
    @CurrentUser('companyId') companyId: string,
    @Query() query: StatsQueryDto,
  ) {
    return this.statsService.topProducts(companyId, query);
  }

  @Get('payment-methods')
  @ApiOperation({ summary: 'Cobros por metodo de pago' })
  paymentMethods(
    @CurrentUser('companyId') companyId: string,
    @Query() query: StatsQueryDto,
  ) {
    return this.statsService.paymentsByMethod(companyId, query);
  }

  @Get('currencies')
  @ApiOperation({ summary: 'Cobros agrupados por moneda (monto original + USD)' })
  currencies(
    @CurrentUser('companyId') companyId: string,
    @Query() query: StatsQueryDto,
  ) {
    return this.statsService.paymentsByCurrency(companyId, query);
  }

  @Get('categories')
  @ApiOperation({ summary: 'Ventas por categoria de producto' })
  categories(
    @CurrentUser('companyId') companyId: string,
    @Query() query: StatsQueryDto,
  ) {
    return this.statsService.salesByCategory(companyId, query);
  }

  @Get('low-stock')
  @ApiOperation({ summary: 'Productos con stock bajo' })
  lowStock(
    @CurrentUser('companyId') companyId: string,
    @Query() query: StatsQueryDto,
  ) {
    return this.statsService.lowStockProducts(companyId, query.limit);
  }
}
