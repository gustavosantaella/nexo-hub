import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import type { DialogView } from '../../../common/constants/enums';
import { CHARGE_RATE_KEYS, DIALOG_VIEWS } from '../../../common/constants/enums';

/**
 * Preferencias de interfaz de la EMPRESA activa (Configuracion).
 *
 * Son configuracion del local, no de cada usuario: el personal comparte la
 * propina que propone el punto de venta, la moneda en la que el cajero ve los
 * precios —con las conversiones que puede ver debajo de cada monto, el precio en
 * dolares del BCV y la tasa con la que cobra— y como se abren los formularios, y
 * el cajero que entra desde otro navegador las recibe al iniciar sesion.
 *
 * Enviar `null` borra la preferencia (vuelve al valor de fabrica: 10 % de
 * propina, formularios en ventana modal, la moneda base del sistema, ninguna
 * conversion adicional, sin el precio en dolares del BCV y cobrando con la tasa
 * activa del sistema). Los campos que no se envian quedan como estaban.
 */
export class UpdatePreferencesDto {
  @ApiPropertyOptional({
    description: 'Propina sugerida (%) que el punto de venta propone al cobrar',
    example: 10,
    minimum: 0,
    maximum: 100,
    nullable: true,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'La propina debe ser un porcentaje (ej. 10)' })
  @Min(0, { message: 'La propina no puede ser negativa' })
  @Max(100, { message: 'La propina no puede pasar del 100 %' })
  tipPercent?: number | null;

  @ApiPropertyOptional({
    description: 'Presentacion de los formularios de caja y pedidos',
    enum: DIALOG_VIEWS,
    example: 'modal',
    nullable: true,
  })
  @IsOptional()
  @IsIn(DIALOG_VIEWS, {
    message: `La presentacion del formulario debe ser ${DIALOG_VIEWS.join(' o ')}`,
  })
  dialogView?: DialogView | null;

  @ApiPropertyOptional({
    description:
      'Moneda en la que el personal de caja ve los precios del catalogo (codigo ISO de 3 letras, ej. VES)',
    example: 'VES',
    nullable: true,
  })
  @IsOptional()
  @IsString({ message: 'La moneda de los precios debe ser un codigo (ej. VES)' })
  @Matches(/^[A-Za-z]{3}$/, {
    message: 'La moneda de los precios debe ser un codigo de 3 letras (ej. VES)',
  })
  priceCurrency?: string | null;

  @ApiPropertyOptional({
    description:
      'Monedas (codigos ISO de 3 letras) en las que el personal de caja ve, ademas de la suya, la conversion de cada monto. Vacio o `null` = ninguna: el cajero solo ve los precios en su moneda',
    example: ['USD', 'COP'],
    type: [String],
    nullable: true,
  })
  @IsOptional()
  @IsArray({ message: 'Las conversiones del cajero deben ser una lista de monedas' })
  @ArrayMaxSize(24, { message: 'Son demasiadas conversiones para el cajero' })
  @IsString({ each: true, message: 'Cada conversion debe ser un codigo (ej. COP)' })
  @Matches(/^[A-Za-z]{3}$/, {
    each: true,
    message: 'Cada conversion debe ser un codigo de 3 letras (ej. COP)',
  })
  conversionCurrencies?: string[] | null;

  @ApiPropertyOptional({
    description:
      'Mostrar debajo de cada monto, ademas de las conversiones, el precio en dolares a la tasa oficial del BCV. `null` o `false` = no se muestra',
    example: true,
    nullable: true,
  })
  @IsOptional()
  @IsBoolean({ message: 'El precio en dolares del BCV se activa o se apaga' })
  showBcvPrice?: boolean | null;

  @ApiPropertyOptional({
    description:
      'Tasa del dolar con la que el cajero cobra (`BCV_USD` o `CUSTOM_USD`). `null` = la tasa activa del sistema (la personalizada del dolar o, si no existe, la del BCV)',
    enum: CHARGE_RATE_KEYS,
    example: 'BCV_USD',
    nullable: true,
  })
  @IsOptional()
  @IsIn(CHARGE_RATE_KEYS, {
    message: `La tasa de cobro debe ser ${CHARGE_RATE_KEYS.join(' o ')}`,
  })
  chargeRateKey?: string | null;
}
