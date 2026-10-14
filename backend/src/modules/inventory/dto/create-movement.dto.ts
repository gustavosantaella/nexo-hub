import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import {
  STOCK_MOVEMENT_TYPES,
  type StockMovementType,
} from '../../../common/constants/enums';
import { INPUT_UNIT_CODES } from '../../../common/utils/packaging.util';
import { QTY_DECIMALS } from '../../../common/utils/quantity.util';

export class CreateMovementDto {
  @ApiProperty()
  @IsString()
  productId!: string;

  @ApiProperty({ enum: STOCK_MOVEMENT_TYPES })
  @IsIn(STOCK_MOVEMENT_TYPES, { message: 'Tipo de movimiento invalido' })
  type!: StockMovementType;

  @ApiPropertyOptional({
    description:
      'IN/OUT: unidades a mover en la unidad de stock del producto. ADJUSTMENT: stock final deseado. Admite hasta 3 decimales (0.1 = 100 g). Puede omitirse si se envia `inputQuantity` + `inputUnit`: el sistema hace la conversion.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: QTY_DECIMALS },
    { message: 'La cantidad admite hasta 3 decimales' },
  )
  @Min(0)
  quantity?: number;

  @ApiPropertyOptional({
    enum: INPUT_UNIT_CODES,
    description:
      'Unidad con la que se escribio la cantidad: cajas/unidades (productos por presentacion), kg/g, L/ml. El sistema la convierte a la unidad de stock del producto.',
  })
  @IsOptional()
  @IsIn(INPUT_UNIT_CODES as unknown as string[])
  inputUnit?: string;

  @ApiPropertyOptional({
    description:
      'Cantidad tal como la escribio el operador, en `inputUnit` (ej. 2 cajas, 750 g).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: QTY_DECIMALS },
    { message: 'La cantidad admite hasta 3 decimales' },
  )
  @Min(0)
  inputQuantity?: number;

  @ApiPropertyOptional({ description: 'Costo unitario (opcional)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitCost?: number;

  @ApiPropertyOptional({
    example: 'VES',
    description:
      'Moneda en la que se escribio el costo unitario (USD por defecto). Se guarda ademas su equivalente en USD y la tasa usada.',
  })
  @IsOptional()
  @IsString()
  unitCostCurrency?: string;

  @ApiPropertyOptional({
    description:
      'Precio de venta de la unidad suelta en las entradas: al ingresar mercaderia se puede ajustar a cuanto se vende la unidad que sale al abrir la presentacion. Se omite (o viaja 0) para no cambiarlo.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @ApiPropertyOptional({
    example: 'VES',
    description:
      'Moneda en la que se escribio el precio unitario (USD por defecto). Se guarda ademas su equivalente en USD y la tasa usada.',
  })
  @IsOptional()
  @IsString()
  unitPriceCurrency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  referenceType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  referenceId?: string;
}
