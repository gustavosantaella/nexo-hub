import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import {
  STOCK_MOVEMENT_TYPES,
  type StockMovementType,
} from '../../../common/constants/enums';

export class CreateMovementDto {
  @ApiProperty()
  @IsString()
  productId!: string;

  @ApiProperty({ enum: STOCK_MOVEMENT_TYPES })
  @IsIn(STOCK_MOVEMENT_TYPES, { message: 'Tipo de movimiento invalido' })
  type!: StockMovementType;

  @ApiProperty({
    description: 'IN/OUT: unidades a mover. ADJUSTMENT: stock final deseado.',
  })
  @Type(() => Number)
  @IsInt({ message: 'La cantidad debe ser un numero entero' })
  @Min(0)
  quantity!: number;

  @ApiPropertyOptional({ description: 'Costo unitario (opcional)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitCost?: number;

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
