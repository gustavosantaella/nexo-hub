import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PRODUCT_UNITS, type ProductUnit } from '../../../common/constants/enums';
import { QTY_DECIMALS } from '../../../common/utils/quantity.util';

export class CreateProductDto {
  @ApiPropertyOptional({ description: 'Se genera automaticamente si no se envia' })
  @IsOptional()
  @IsString()
  sku?: string;

  @ApiProperty({ example: 'Ceviche clasico' })
  @IsString()
  @MinLength(2, { message: 'El nombre es obligatorio' })
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description:
      'Foto del producto para el POS: URL publica o data URL (base64) reducida. Cadena vacia la elimina.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(400_000, { message: 'La imagen del producto es demasiado grande' })
  imageUrl?: string;

  @ApiProperty({ example: 25.0 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price!: number;

  @ApiPropertyOptional({ example: 12.5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cost?: number;

  @ApiPropertyOptional({
    description:
      'Stock inicial (genera movimiento IN). Admite hasta 3 decimales: 0.1 = 100 g de un producto medido en kilos.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: QTY_DECIMALS },
    { message: 'El stock admite hasta 3 decimales' },
  )
  @Min(0)
  stock?: number;

  @ApiPropertyOptional({
    default: 0,
    description: 'Stock minimo para la alerta de reposicion (hasta 3 decimales)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: QTY_DECIMALS },
    { message: 'El stock minimo admite hasta 3 decimales' },
  )
  @Min(0)
  minStock?: number;

  @ApiPropertyOptional({ enum: PRODUCT_UNITS, default: 'UND' })
  @IsOptional()
  @IsIn(PRODUCT_UNITS)
  unit?: ProductUnit;

  @ApiPropertyOptional({
    description:
      'Unidades individuales que trae la presentacion (caja/paquete). El precio sigue siendo el de la presentacion completa y el stock se lleva en unidades, asi el POS vende sueltas a `price / unitsPerBox`. 1 = se vende suelto.',
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  unitsPerBox?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  trackStock?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  supplierId?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
