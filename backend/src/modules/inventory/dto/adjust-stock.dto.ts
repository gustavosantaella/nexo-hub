import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class AdjustStockDto {
  @ApiProperty({ description: 'Stock final deseado tras el ajuste' })
  @Type(() => Number)
  @IsInt({ message: 'El stock debe ser un numero entero' })
  @Min(0)
  newStock!: number;

  @ApiPropertyOptional({ example: 'Conteo fisico / merma' })
  @IsOptional()
  @IsString()
  reason?: string;
}
