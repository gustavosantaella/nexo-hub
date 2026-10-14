import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
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
      'Foto del menu para el POS: URL publica o data URL (base64) reducida. Cadena vacia la elimina.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(400_000, { message: 'La imagen del menu es demasiado grande' })
  imageUrl?: string;

  @ApiProperty({ example: 18.5 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price!: number;

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

  @ApiProperty({
    type: [MenuIngredientDto],
    description: 'Receta: productos que consume una unidad del menu',
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'El menu debe tener al menos un ingrediente' })
  @ValidateNested({ each: true })
  @Type(() => MenuIngredientDto)
  ingredients!: MenuIngredientDto[];
}
