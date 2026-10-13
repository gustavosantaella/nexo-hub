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
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UpdateCustomRateDto } from './dto/update-custom-rate.dto';
import { RatesService } from './rates.service';

/**
 * Tasas de cambio.
 *
 * - `GET /rates` lo consume el frontend para mostrar todos los montos "al
 *   cambio"; es publico a proposito (la tasa del BCV es informacion publica).
 * - Guardar/limpiar la tasa personalizada queda restringido a ADMIN/MANAGER.
 */
@ApiTags('Tasas de cambio')
@Controller('rates')
export class RatesController {
  constructor(private readonly ratesService: RatesService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Tasas BCV (dolar/euro) y tasa personalizada del local',
  })
  current(@Query('refresh') refresh?: string) {
    return this.ratesService.snapshot(refresh === 'true' || refresh === '1');
  }

  @ApiBearerAuth()
  @Put('custom')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Guardar la tasa personalizada (Bs por dolar)' })
  updateCustom(
    @Body() dto: UpdateCustomRateDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.ratesService.setCustomRate(dto.usd ?? null, userId);
  }

  @ApiBearerAuth()
  @Delete('custom')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({
    summary: 'Eliminar la tasa personalizada (vuelve a las tasas del BCV)',
  })
  clearCustom() {
    return this.ratesService.setCustomRate(null);
  }
}
