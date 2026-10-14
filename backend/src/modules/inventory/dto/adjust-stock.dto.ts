import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { QTY_DECIMALS } from '../../../common/utils/quantity.util';

export class AdjustStockDto {
  @ApiProperty({
    description:
      'Stock final deseado tras el ajuste (admite hasta 3 decimales)',
  })
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: QTY_DECIMALS },
    { message: 'El stock admite hasta 3 decimales' },
  )
  @Min(0)
  newStock!: number;

  @ApiPropertyOptional({ example: 'Conteo fisico / merma' })
  @IsOptional()
  @IsString()
  reason?: string;
}
