import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PRODUCT_UNITS, type ProductUnit } from '../../../common/constants/enums';
import {
  IMAGE_URL_MESSAGE,
  IMAGE_URL_PATTERN,
  MAX_IMAGE_URL_LENGTH,
} from '../../../common/media/image-url.util';
import { QTY_DECIMALS } from '../../../common/utils/quantity.util';
import { RATE_KEYS } from '../../rates/rates.service';

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
      'Foto del producto para el POS: URL local `/media/...` devuelta por `POST /api/media/upload` (multipart) o URL publica heredada. Cadena vacia la elimina.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_IMAGE_URL_LENGTH, { message: 'La URL de la imagen es demasiado larga' })
  @Matches(IMAGE_URL_PATTERN, { message: IMAGE_URL_MESSAGE })
  imageUrl?: string;

  @ApiProperty({
    example: 25.0,
    description:
      'Precio de venta tal como lo escribe el usuario, EN LA MONEDA de `priceCurrency` (USD si se omite). El sistema lo guarda ademas en USD (moneda base contable) y recuerda la moneda y la tasa usadas.',
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price!: number;

  @ApiPropertyOptional({
    example: 'VES',
    default: 'USD',
    description:
      'Moneda en la que se escribio el precio (USD, VES, EUR, ...). Debe estar habilitada y tener tasa configurada.',
  })
  @IsOptional()
  @IsString()
  priceCurrency?: string;

  @ApiPropertyOptional({
    enum: RATE_KEYS,
    example: 'BCV_USD',
    description:
      'Tasa con la que se convierte el precio a USD: `BCV_USD` (dolar oficial), `BCV_EUR` (euro oficial) o `CUSTOM_USD` (la personalizada del local). Si se omite se conserva la guardada y, si el producto no tiene, se usa la activa del sistema.',
  })
  @IsOptional()
  @IsIn(RATE_KEYS)
  priceRateKey?: string;

  @ApiPropertyOptional({ example: 12.5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cost?: number;

  @ApiPropertyOptional({
    example: 'USD',
    description:
      'Moneda en la que se escribio el costo (por defecto la misma del precio).',
  })
  @IsOptional()
  @IsString()
  costCurrency?: string;

  @ApiPropertyOptional({
    enum: RATE_KEYS,
    example: 'CUSTOM_USD',
    description:
      'Tasa con la que se convierte el costo de la presentacion a USD (independiente de la del precio y del costo unitario).',
  })
  @IsOptional()
  @IsIn(RATE_KEYS)
  costRateKey?: string;

  @ApiPropertyOptional({
    description:
      'Costo de UNA unidad individual de la presentacion (caja/paquete), en `unitCostCurrency` (por defecto la moneda de `costCurrency`). Si se omite se calcula repartiendo el costo de la presentacion entre `unitsPerBox`.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitCost?: number;

  @ApiPropertyOptional({
    example: 'USD',
    description:
      'Moneda en la que se escribio el costo unitario. Es INDEPENDIENTE de `costCurrency`: cada monto del catalogo tiene su propia moneda (por defecto, la del costo de la presentacion).',
  })
  @IsOptional()
  @IsString()
  unitCostCurrency?: string;

  @ApiPropertyOptional({
    enum: RATE_KEYS,
    example: 'BCV_EUR',
    description:
      'Tasa con la que se convierte el costo unitario a USD. Es INDEPENDIENTE de las del precio y del costo de la presentacion: el operador elige una tasa por monto.',
  })
  @IsOptional()
  @IsIn(RATE_KEYS)
  unitCostRateKey?: string;

  @ApiPropertyOptional({
    example: 3.5,
    description:
      'PRECIO DE VENTA de UNA unidad individual de la presentacion (caja/paquete), en `unitPriceCurrency` (por defecto la moneda de `priceCurrency`). 0 = sin definir: la interfaz reparte `price / unitsPerBox`.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @ApiPropertyOptional({
    example: 'USD',
    description:
      'Moneda en la que se escribio el precio de la unidad suelta. Es INDEPENDIENTE de `priceCurrency`: cada monto del catalogo tiene su propia moneda (por defecto, la del precio de la presentacion).',
  })
  @IsOptional()
  @IsString()
  unitPriceCurrency?: string;

  @ApiPropertyOptional({
    enum: RATE_KEYS,
    example: 'BCV_USD',
    description:
      'Tasa con la que se convierte el precio de la unidad suelta a USD. Es INDEPENDIENTE de las del precio y de los costos: el operador elige una tasa por monto.',
  })
  @IsOptional()
  @IsIn(RATE_KEYS)
  unitPriceRateKey?: string;

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
