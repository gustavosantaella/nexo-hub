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
  ACCOUNT_STATUSES,
  PAYMENT_METHODS,
  type AccountStatus,
  type PaymentMethod,
} from '../../../common/constants/enums';

export class CreatePayableDto {
  @ApiPropertyOptional({ description: 'Proveedor al que se le debe' })
  @IsOptional()
  @IsString()
  supplierId?: string;

  @ApiProperty({ example: 'Compra de bebidas a credito' })
  @IsString()
  @MinLength(2, { message: 'La descripcion es obligatoria' })
  description!: string;

  @ApiProperty({ example: 850.0 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01, { message: 'El monto debe ser mayor a 0' })
  amount!: number;

  @ApiPropertyOptional({
    description:
      'Moneda en la que se registra la deuda (USD por defecto). Se guarda ademas el equivalente en USD.',
    example: 'VES',
  })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ description: 'Fecha de vencimiento (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({ description: 'Nro. de factura / guia' })
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdatePayableDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  supplierId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  description?: string;

  @ApiPropertyOptional({ description: 'Solo editable si aun no hay abonos' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount?: number;

  @ApiPropertyOptional({
    description:
      'Moneda en la que se registra la deuda (USD por defecto). Solo editable si aun no hay abonos.',
    example: 'VES',
  })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ enum: ACCOUNT_STATUSES })
  @IsOptional()
  @IsIn(ACCOUNT_STATUSES)
  status?: AccountStatus;
}

export class PayPayableDto {
  @ApiProperty({ example: 300 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01, { message: 'El monto debe ser mayor a 0' })
  amount!: number;

  @ApiPropertyOptional({ enum: PAYMENT_METHODS, default: 'CASH' })
  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  method?: PaymentMethod;

  @ApiPropertyOptional({
    description:
      'Moneda en la que se paga el abono (USD por defecto). Se guarda ademas el equivalente en USD.',
    example: 'VES',
  })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({
    description: 'Por defecto true si el metodo es CASH: egresa de la caja abierta.',
  })
  @IsOptional()
  @IsBoolean()
  payFromCash?: boolean;
}
