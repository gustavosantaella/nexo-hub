import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  IMAGE_URL_MESSAGE,
  IMAGE_URL_PATTERN,
  MAX_IMAGE_URL_LENGTH,
} from '../../../common/media/image-url.util';
import { QTY_DECIMALS } from '../../../common/utils/quantity.util';

/** Como se ofrece el menu en la carta. */
export const MENU_AVAILABILITIES = [
  'ALL',
  'DINE_IN',
  'TAKEAWAY',
  'DELIVERY',
] as const;
export type MenuAvailability = (typeof MENU_AVAILABILITIES)[number];

/** Seccion del ingrediente dentro del combo (para imprimir/ver la comanda). */
export const MENU_SECTIONS = [
  'Principal',
  'Bebida',
  'Postre',
  'Acompanamiento',
  'Otro',
] as const;
export type MenuSection = (typeof MENU_SECTIONS)[number];

/** Linea de la receta enviada desde el formulario. */
export class MenuIngredientDto {
  @ApiProperty()
  @IsString()
  productId!: string;

  @ApiProperty({
    example: 0.1,
    description:
      'Cuanto consume UNA unidad del menu, en la misma unidad del stock del producto (0.1 = 100 g si el producto se mide en kilos).',
  })
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: QTY_DECIMALS },
    { message: 'La cantidad del ingrediente admite hasta 3 decimales' },
  )
  @Min(0.001, { message: 'La cantidad del ingrediente debe ser mayor a 0' })
  quantity!: number;

  @ApiPropertyOptional({ enum: MENU_SECTIONS, default: 'Principal' })
  @IsOptional()
  @IsIn(MENU_SECTIONS as unknown as string[])
  section?: MenuSection;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class CreateMenuDto {
  @ApiPropertyOptional({ description: 'Se genera automaticamente si no se envia' })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiProperty({ example: 'Parrilla mixta' })
  @IsString()
  @MinLength(2, { message: 'El nombre es obligatorio' })
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description:
      'Foto del menu para el POS: URL local `/media/...` devuelta por `POST /api/media/upload` (multipart) o URL publica heredada. Cadena vacia la elimina.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_IMAGE_URL_LENGTH, { message: 'La URL de la imagen es demasiado larga' })
  @Matches(IMAGE_URL_PATTERN, { message: IMAGE_URL_MESSAGE })
  imageUrl?: string;

  @ApiProperty({
    example: 18.5,
    description:
      'Precio de venta tal como lo escribe el usuario, EN LA MONEDA de `priceCurrency` (USD si se omite). El sistema guarda ademas su equivalente en USD y recuerda la moneda y la tasa usadas.',
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price!: number;

  @ApiPropertyOptional({
    example: 'VES',
    default: 'USD',
    description:
      'Moneda en la que se escribio el precio (debe estar habilitada y tener tasa).',
  })
  @IsOptional()
  @IsString()
  priceCurrency?: string;

  @ApiPropertyOptional({ enum: MENU_AVAILABILITIES, default: 'ALL' })
  @IsOptional()
  @IsIn(MENU_AVAILABILITIES as unknown as string[])
  availability?: MenuAvailability;

  @ApiPropertyOptional({ example: 15, description: 'Minutos de preparacion' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(600)
  preparationMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    type: [MenuIngredientDto],
    description:
      'Receta: productos que consume una unidad del menu. Opcional: sin receta el menu no descuenta inventario.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MenuIngredientDto)
  ingredients?: MenuIngredientDto[];
}
