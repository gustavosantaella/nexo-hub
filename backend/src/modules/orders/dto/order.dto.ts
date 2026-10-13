import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  ORDER_TYPES,
  PAYMENT_METHODS,
  type OrderType,
  type PaymentMethod,
} from '../../../common/constants/enums';

export class OrderItemDto {
  @ApiProperty()
  @IsString()
  productId!: string;

  @ApiProperty({ example: 2 })
  @Type(() => Number)
  @IsInt({ message: 'La cantidad debe ser un entero' })
  @Min(1, { message: 'La cantidad minima es 1' })
  quantity!: number;

  @ApiPropertyOptional({ description: 'Precio unitario (por defecto el del producto)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice?: number;
}

export class CreateOrderDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiPropertyOptional({ enum: ORDER_TYPES, default: 'DINE_IN' })
  @IsOptional()
  @IsIn(ORDER_TYPES)
  type?: OrderType;

  @ApiPropertyOptional({ example: 'Mesa 4' })
  @IsOptional()
  @IsString()
  tableNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: 'Descuento en monto absoluto', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  discount?: number;

  @ApiPropertyOptional({ description: 'IGV (%) aplicado sobre el neto', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  taxRate?: number;

  @ApiProperty({ type: [OrderItemDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'El pedido debe tener al menos un item' })
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items!: OrderItemDto[];
}

export class UpdateOrderDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tableNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  discount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  taxRate?: number;
}

export class AddOrderItemsDto {
  @ApiProperty({
    type: [OrderItemDto],
    description: 'Productos a agregar al pedido existente',
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'Debe indicar al menos un item' })
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items!: OrderItemDto[];
}

export class UpdateOrderItemDto {
  @ApiProperty({
    example: 3,
    minimum: 1,
    description:
      'Cantidad final de la linea (1 o mas). Para sacar el producto del pedido se elimina la linea.',
  })
  @Type(() => Number)
  @IsInt({ message: 'La cantidad debe ser un entero' })
  @Min(1, { message: 'La cantidad minima es 1' })
  quantity!: number;
}

export class AddOrderPaymentDto {
  @ApiProperty({ example: 50 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01, { message: 'El monto debe ser mayor a 0' })
  amount!: number;

  @ApiProperty({ enum: PAYMENT_METHODS })
  @IsIn(PAYMENT_METHODS, { message: 'Metodo de pago invalido' })
  method!: PaymentMethod;

  @ApiPropertyOptional({
    description:
      'Moneda en la que pago el cliente (USD por defecto). El monto se registra en esa moneda y su equivalente en USD.',
    example: 'VES',
  })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}
