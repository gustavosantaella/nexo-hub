import {
  Body,
  Controller,
  Delete,
  Get,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '../../common/constants/enums';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { UpdateCustomRateDto } from './dto/update-custom-rate.dto';
import { RatesService } from './rates.service';

/**
 * Tasas de cambio de la empresa activa.
 *
 * Las tasas oficiales del BCV son publicas (vienen del tercero), pero la tasa
 * personalizada y las monedas configuradas son POR EMPRESA: por eso todo el
 * controlador requiere sesion y trabaja con el `companyId` del token.
 */
@ApiTags('Tasas de cambio')
@ApiBearerAuth()
@Controller('rates')
export class RatesController {
  constructor(private readonly ratesService: RatesService) {}

  @Get()
  @ApiOperation({
    summary:
      'Tasas BCV (dolar/euro), tasa personalizada de la empresa y tasa USDT de referencia',
    description:
      '`reference` es la tasa USDT/VES publicada por Binance P2P y es solo informativa: no se usa para convertir montos.',
  })
  current(
    @CurrentUser('companyId') companyId: string,
    @Query('refresh') refresh?: string,
  ) {
    return this.ratesService.snapshot(
      companyId,
      refresh === 'true' || refresh === '1',
    );
  }

  @Put('custom')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Guardar la tasa personalizada (Bs por dolar)' })
  updateCustom(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateCustomRateDto,
  ) {
    return this.ratesService.setCustomRate(
      user.companyId,
      dto.usd ?? null,
      user.id,
    );
  }

  @Delete('custom')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({
    summary: 'Eliminar la tasa personalizada (vuelve a las tasas del BCV)',
  })
  clearCustom(@CurrentUser('companyId') companyId: string) {
    return this.ratesService.setCustomRate(companyId, null);
  }
}

