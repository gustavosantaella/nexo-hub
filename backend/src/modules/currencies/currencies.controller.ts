import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '../../common/constants/enums';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrenciesService } from './currencies.service';
import { CurrencySettingDto, UpdateCurrenciesDto } from './dto/currency.dto';

/**
 * Monedas aceptadas por el local.
 *
 * - `GET /currencies` es publico (la lista de monedas es informacion del local
 *   que la interfaz necesita para pintar los selectores de cobro).
 * - Guardar/cambiar tasas queda restringido a ADMIN/MANAGER.
 */
@ApiTags('Monedas')
@Controller('currencies')
export class CurrenciesController {
  constructor(private readonly currenciesService: CurrenciesService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Monedas configuradas (habilitadas y su tasa)' })
  async list() {
    return { currencies: await this.currenciesService.list() };
  }

  @ApiBearerAuth()
  @Put()
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Reemplazar la configuracion de monedas' })
  async save(
    @Body() dto: UpdateCurrenciesDto,
    @CurrentUser('id') userId: string,
  ) {
    return {
      currencies: await this.currenciesService.save(dto.currencies, userId),
    };
  }

  @ApiBearerAuth()
  @Put(':code')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Crear o actualizar una moneda' })
  async upsert(
    @Param('code') code: string,
    @Body() dto: CurrencySettingDto,
    @CurrentUser('id') userId: string,
  ) {
    return {
      currencies: await this.currenciesService.upsert(code, dto, userId),
    };
  }

  @ApiBearerAuth()
  @Delete(':code')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Quitar una moneda de la configuracion' })
  async remove(
    @Param('code') code: string,
    @CurrentUser('id') userId: string,
  ) {
    return {
      currencies: await this.currenciesService.remove(code, userId),
    };
  }
}
