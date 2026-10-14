import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { INPUT_UNIT_CODES } from '../../../common/utils/packaging.util';
import { QTY_DECIMALS } from '../../../common/utils/quantity.util';

export class AdjustStockDto {
  @ApiProperty({
    description:
      'Stock final deseado tras el ajuste (admite hasta 3 decimales). Puede omitirse si se envia `inputQuantity` + `inputUnit`.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: QTY_DECIMALS },
    { message: 'El stock admite hasta 3 decimales' },
  )
  @Min(0)
  newStock?: number;

  @ApiPropertyOptional({
    enum: INPUT_UNIT_CODES,
    description:
      'Unidad con la que se conto el stock final (cajas, unidades, kg, g, L, ml).',
  })
  @IsOptional()
  @IsIn(INPUT_UNIT_CODES as unknown as string[])
  inputUnit?: string;

  @ApiPropertyOptional({
    description: 'Stock final tal como se conto, en `inputUnit`.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: QTY_DECIMALS },
    { message: 'El stock admite hasta 3 decimales' },
  )
  @Min(0)
  inputQuantity?: number;

  @ApiPropertyOptional({ example: 'Conteo fisico / merma' })
  @IsOptional()
  @IsString()
  reason?: string;
}
