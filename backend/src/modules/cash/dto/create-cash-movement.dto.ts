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
  CASH_MOVEMENT_CATEGORIES,
  CashMovementType,
  PAYMENT_METHODS,
  type CashMovementCategory,
  type PaymentMethod,
} from '../../../common/constants/enums';

export class CreateCashMovementDto {
  @ApiProperty({
    description:
      'Opcional. Si no se envia se deduce de la categoria (SALE/DEPOSIT=IN, el resto=OUT).',
    enum: [CashMovementType.IN, CashMovementType.OUT],
  })
  @IsOptional()
  @IsIn([CashMovementType.IN, CashMovementType.OUT])
  type?: CashMovementType;

  @ApiProperty({ enum: CASH_MOVEMENT_CATEGORIES })
  @IsIn(CASH_MOVEMENT_CATEGORIES, { message: 'Categoria invalida' })
  category!: CashMovementCategory;

  @ApiPropertyOptional({ enum: PAYMENT_METHODS, default: 'CASH' })
  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  paymentMethod?: PaymentMethod;

  @ApiProperty({ example: 50 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01, { message: 'El monto debe ser mayor a 0' })
  amount!: number;

  @ApiPropertyOptional({
    description:
      'Moneda en la que se paga/recibe (USD por defecto). Debe estar habilitada en Configuracion > Monedas.',
    example: 'VES',
  })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}
