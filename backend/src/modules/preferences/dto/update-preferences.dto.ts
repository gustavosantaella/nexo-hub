import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import type { DialogView } from '../../../common/constants/enums';
import { DIALOG_VIEWS } from '../../../common/constants/enums';

/**
 * Preferencias de interfaz de la EMPRESA activa (Configuracion).
 *
 * Son configuracion del local, no de cada usuario: el personal comparte la
 * propina que propone el punto de venta, la moneda en la que el cajero ve los
 * precios y como se abren los formularios, y el cajero que entra desde otro
 * navegador las recibe al iniciar sesion.
 *
 * Enviar `null` borra la preferencia (vuelve al valor de fabrica: 10 % de
 * propina, formularios en ventana modal y la moneda base del sistema). Los campos
 * que no se envian quedan como estaban.
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
}
