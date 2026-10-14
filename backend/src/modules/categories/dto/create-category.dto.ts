import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateCategoryDto {
  @ApiProperty({ example: 'Bebidas' })
  @IsString()
  @MinLength(2, { message: 'El nombre es obligatorio' })
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description:
      'Categoria principal a la que pertenece. `null` (o vacio) la deja como principal.',
    example: 'cat_123',
  })
  @IsOptional()
  @IsString()
  parentId?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
