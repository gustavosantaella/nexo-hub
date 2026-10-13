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
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { CurrenciesService } from './currencies.service';
import { CurrencySettingDto, UpdateCurrenciesDto } from './dto/currency.dto';

/**
 * Monedas aceptadas por la empresa.
 *
 * Las monedas se configuran POR EMPRESA (viven en `Setting`) y el endpoint
 * esta autenticado: la lista depende de la empresa activa del token.
 */
@ApiTags('Monedas')
@ApiBearerAuth()
@Controller('currencies')
export class CurrenciesController {
  constructor(private readonly currenciesService: CurrenciesService) {}

  @Get()
  @ApiOperation({ summary: 'Monedas configuradas (habilitadas y su tasa)' })
  async list(@CurrentUser('companyId') companyId: string) {
    return { currencies: await this.currenciesService.list(companyId) };
  }

  @Put()
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Reemplazar la configuracion de monedas' })
  async save(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateCurrenciesDto,
  ) {
    return {
      currencies: await this.currenciesService.save(
        user.companyId,
        dto.currencies,
        user.id,
      ),
    };
  }

  @Put(':code')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Crear o actualizar una moneda' })
  async upsert(
    @CurrentUser() user: AuthenticatedUser,
    @Param('code') code: string,
    @Body() dto: CurrencySettingDto,
  ) {
    return {
      currencies: await this.currenciesService.upsert(
        user.companyId,
        code,
        dto,
        user.id,
      ),
    };
  }

  @Delete(':code')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Quitar una moneda de la configuracion' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('code') code: string,
  ) {
    return {
      currencies: await this.currenciesService.remove(
        user.companyId,
        code,
        user.id,
      ),
    };
  }
}
