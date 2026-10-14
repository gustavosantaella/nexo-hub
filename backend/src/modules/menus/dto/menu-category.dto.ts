import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class CreateMenuCategoryDto {
  @ApiProperty({ example: 'Almuerzos' })
  @IsString()
  @MinLength(2, { message: 'El nombre es obligatorio' })
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Clase de Tailwind o color hex para la tarjeta del POS',
    example: 'amber',
  })
  @IsOptional()
  @IsString()
  color?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({
    description:
      'Categoria de menu principal a la que pertenece. `null` (o vacio) la deja como principal.',
    example: 'mcat_123',
  })
  @IsOptional()
  @IsString()
  parentId?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
