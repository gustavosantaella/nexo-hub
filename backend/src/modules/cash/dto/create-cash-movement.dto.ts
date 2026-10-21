import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  CASH_MOVEMENT_CATEGORIES,
  CashMovementType,
  PAYMENT_METHODS,
  PaymentMethod,
  type CashMovementCategory,
} from '../../../common/constants/enums';

/** Metodos concretos de una parte: el pago mixto no puede contener otro mixto. */
const PART_PAYMENT_METHODS = PAYMENT_METHODS.filter(
  (method) => method !== PaymentMethod.MIXED,
);

/**
 * Una parte de un movimiento mixto: lo que entra/sale por un metodo y una
 * moneda. Cada parte se guarda como un movimiento de caja propio para que el
 * arqueo por metodo y el historial la muestren tal cual.
 */
export class CashMovementPartDto {
  @ApiProperty({ enum: PART_PAYMENT_METHODS })
  @IsIn(PART_PAYMENT_METHODS, {
    message: 'Cada parte del pago debe tener un metodo concreto (no MIXTO)',
  })
  paymentMethod!: PaymentMethod;

  @ApiProperty({ example: 50 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01, { message: 'El monto de cada parte debe ser mayor a 0' })
  amount!: number;

  @ApiPropertyOptional({
    description: 'Moneda de la parte (USD por defecto).',
    example: 'VES',
  })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({
    description:
      'Referencia bancaria del comprobante de esta parte (transferencia / pago movil).',
  })
  @IsOptional()
  @IsString()
  paymentReference?: string;

  @ApiPropertyOptional({ description: 'Foto del comprobante como data URL.' })
  @IsOptional()
  @IsString()
  paymentPhotoUrl?: string;
}

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

  @ApiPropertyOptional({
    description:
      'Monto del movimiento simple. Obligatorio si no se envian `parts`.',
    example: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01, { message: 'El monto debe ser mayor a 0' })
  amount?: number;

  @ApiPropertyOptional({ type: [CashMovementPartDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'El pago mixto requiere al menos una parte' })
  @ArrayMaxSize(8, { message: 'El pago mixto admite hasta 8 partes' })
  @ValidateNested({ each: true })
  @Type(() => CashMovementPartDto)
  parts?: CashMovementPartDto[];

  @ApiPropertyOptional({
    description:
      'Moneda en la que se paga/recibe (USD por defecto). Debe estar habilitada en Configuracion > Monedas.',
    example: 'VES',
  })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({
    description:
      'Referencia bancaria del comprobante (transferencia / Yape / Plin). Cada parte puede traer la suya; esta se usa como respaldo.',
  })
  @IsOptional()
  @IsString()
  paymentReference?: string;

  @ApiPropertyOptional({ description: 'Foto del comprobante como data URL.' })
  @IsOptional()
  @IsString()
  paymentPhotoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}
