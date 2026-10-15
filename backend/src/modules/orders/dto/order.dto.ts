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
import { RATE_KEYS } from '../../rates/rates.service';

export class OrderItemDto {
  @ApiPropertyOptional({
    description:
      'Producto suelto del inventario. Excluyente con `menuId`: cada linea vende uno u otro.',
  })
  @IsOptional()
  @IsString()
  productId?: string;

  @ApiPropertyOptional({
    description:
      'Menu (plato/combo) con receta. Al venderlo se descuentan sus ingredientes del inventario.',
  })
  @IsOptional()
  @IsString()
  menuId?: string;

  @ApiProperty({ example: 2 })
  @Type(() => Number)
  @IsInt({ message: 'La cantidad debe ser un entero' })
  @Min(1, { message: 'La cantidad minima es 1' })
  quantity!: number;

  @ApiPropertyOptional({ description: 'Precio unitario (por defecto el del producto/menu)' })
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

  @ApiPropertyOptional({
    description: 'Propina del cliente en monto absoluto (no se le aplica IGV)',
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  tip?: number;

  @ApiPropertyOptional({
    description:
      'Costo de delivery en `deliveryFeeCurrency` (por defecto USD). Solo aplica a pedidos a domicilio; no paga IGV.',
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  deliveryFee?: number;

  @ApiPropertyOptional({
    description: 'Moneda en la que se escribio el costo de delivery (USD por defecto)',
    example: 'VES',
  })
  @IsOptional()
  @IsString()
  deliveryFeeCurrency?: string;

  @ApiPropertyOptional({
    description:
      'Tasa elegida para convertir el costo de delivery (`BCV_USD`, `BCV_EUR` o `CUSTOM_USD`). Sin tasa se usa la personalizada (o la del BCV).',
  })
  @IsOptional()
  @IsString()
  deliveryFeeRateKey?: string;

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

  @ApiPropertyOptional({
    description: 'Propina del cliente en monto absoluto (no se le aplica IGV)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  tip?: number;

  @ApiPropertyOptional({
    description:
      'Costo de delivery en `deliveryFeeCurrency` (por defecto USD). Enviarlo en 0 lo quita del pedido; no paga IGV.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  deliveryFee?: number;

  @ApiPropertyOptional({
    description: 'Moneda en la que se escribio el costo de delivery (USD por defecto)',
    example: 'VES',
  })
  @IsOptional()
  @IsString()
  deliveryFeeCurrency?: string;

  @ApiPropertyOptional({
    description:
      'Tasa elegida para convertir el costo de delivery (`BCV_USD`, `BCV_EUR` o `CUSTOM_USD`). Sin tasa se usa la personalizada (o la del BCV).',
  })
  @IsOptional()
  @IsString()
  deliveryFeeRateKey?: string;
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

  @ApiPropertyOptional({
    description:
      'Tasa elegida para convertir el cobro (`BCV_USD`, `BCV_EUR` o `CUSTOM_USD`). Sin tasa se usa la personalizada del dolar (o, si no existe, la del BCV). El cajero envia aqui la tasa de cobro configurada por la empresa.',
    enum: RATE_KEYS,
  })
  @IsOptional()
  @IsIn(RATE_KEYS, { message: 'Tasa de conversion invalida' })
  rateKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}
