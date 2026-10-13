import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import {
  EXPENSE_CATEGORIES,
  PAYMENT_METHODS,
  type ExpenseCategory,
  type PaymentMethod,
} from '../../../common/constants/enums';

export class CreateExpenseDto {
  @ApiProperty({ enum: EXPENSE_CATEGORIES })
  @IsIn(EXPENSE_CATEGORIES, { message: 'Categoria de gasto invalida' })
  category!: ExpenseCategory;

  @ApiProperty({ example: 'Compra de verduras' })
  @IsString()
  @MinLength(2, { message: 'La descripcion es obligatoria' })
  description!: string;

  @ApiProperty({ example: 120.5 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01, { message: 'El monto debe ser mayor a 0' })
  amount!: number;

  @ApiPropertyOptional({
    description:
      'Moneda en la que se paga el gasto (USD por defecto). Se guarda ademas el equivalente en USD.',
    example: 'VES',
  })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ description: 'Fecha del gasto (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({ enum: PAYMENT_METHODS, default: 'CASH' })
  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  paymentMethod?: PaymentMethod;

  @ApiPropertyOptional({ description: 'Proveedor asociado' })
  @IsOptional()
  @IsString()
  supplierId?: string;

  @ApiPropertyOptional({
    description:
      'Por defecto true si el metodo es CASH: descuenta el efectivo de la caja abierta.',
  })
  @IsOptional()
  @IsBoolean()
  payFromCash?: boolean;
}
