import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

/** Una moneda aceptada por el local. */
export class CurrencySettingDto {
  @ApiProperty({ description: 'Codigo ISO de la moneda', example: 'USD' })
  @IsString()
  code!: string;

  @ApiPropertyOptional({ description: 'Aceptar esta moneda al cobrar/pagar' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description:
      'Bolivares por 1 unidad. Solo aplica a monedas distintas de USD (moneda base) y VES (tasa 1).',
    example: 980,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'La tasa debe ser numerica' })
  @Min(0, { message: 'La tasa no puede ser negativa' })
  rate?: number | null;

  @ApiPropertyOptional({ example: 'Dolares' })
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional({ example: '$' })
  @IsOptional()
  @IsString()
  symbol?: string;
}

/** Reemplazo completo de la lista de monedas del local. */
export class UpdateCurrenciesDto {
  @ApiProperty({ type: [CurrencySettingDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Debes enviar al menos una moneda' })
  @ValidateNested({ each: true })
  @Type(() => CurrencySettingDto)
  currencies!: CurrencySettingDto[];
}
