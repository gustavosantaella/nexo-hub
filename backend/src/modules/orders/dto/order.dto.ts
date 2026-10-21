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
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  ORDER_TYPES,
  PAYMENT_METHODS,
  type OrderType,
  type PaymentMethod,
} from '../../../common/constants/enums';
import {
  IMAGE_URL_MESSAGE,
  IMAGE_URL_PATTERN,
  MAX_IMAGE_URL_LENGTH,
} from '../../../common/media/image-url.util';
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

  @ApiPropertyOptional({
    description:
      'Nombre con el que el cajero identifica el pedido (ej. "Cumpleaños de Ana").',
    example: 'Cumpleaños de Ana',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120, {
    message: 'El nombre del pedido no puede superar los 120 caracteres',
  })
  name?: string;

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

  @ApiPropertyOptional({
    description:
      'Nombre con el que el cajero identifica el pedido. Enviarlo vacío quita el nombre.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120, {
    message: 'El nombre del pedido no puede superar los 120 caracteres',
  })
  name?: string;

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

/**
 * Una parte del cobro: lo que el cliente entrego con un metodo y una moneda.
 *
 * En un pago mixto el cliente puede entregar, por ejemplo, USD 10 en efectivo y
 * Bs 4.000 por transferencia. Cada parte se registra como un movimiento de caja
 * propio (metodo + moneda) para que el arqueo y el historial la muestren tal cual.
 */
export class OrderPaymentPartDto {
  @ApiProperty({ example: 10 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01, { message: 'El monto de la parte debe ser mayor a 0' })
  amount!: number;

  @ApiProperty({ enum: PAYMENT_METHODS })
  @IsIn(PAYMENT_METHODS, { message: 'Metodo de pago invalido' })
  method!: PaymentMethod;

  @ApiPropertyOptional({
    description: 'Moneda en la que entrego esa parte (USD por defecto)',
    example: 'VES',
  })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({
    description:
      'Campo heredado: el cobro siempre se valora a la tasa oficial del BCV. Se acepta para clientes anteriores, pero se ignora.',
    enum: RATE_KEYS,
    deprecated: true,
  })
  @IsOptional()
  @IsIn(RATE_KEYS, { message: 'Tasa de conversion invalida' })
  rateKey?: string;
}

/**
 * Una parte del vuelto: como se le devolvio el cambio al cliente. Puede ser en
 * otra moneda y por otro metodo distinto al del pago (efectivo en Bs, vuelto a
 * una transferencia, etc.). Cada parte queda como egreso de caja.
 */
export class OrderPaymentChangeDto extends OrderPaymentPartDto {}

export class AddOrderPaymentDto {
  @ApiProperty({
    example: 50,
    description:
      'Monto aplicado al pedido en `currency`. Con `parts` es el total aplicado que resulta de pagos menos vuelto; el backend lo valida contra el saldo.',
  })
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
      'Campo heredado: el cobro siempre se valora a la tasa oficial del BCV. Se acepta para clientes anteriores, pero se ignora.',
    enum: RATE_KEYS,
    deprecated: true,
  })
  @IsOptional()
  @IsIn(RATE_KEYS, { message: 'Tasa de conversion invalida' })
  rateKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({
    example: '123456',
    description:
      'Referencia bancaria del comprobante (4 a 6 digitos). Obligatoria cuando el cobro incluye transferencia, Yape o Plin.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4,6}$/, {
    message: 'La referencia debe tener entre 4 y 6 digitos',
  })
  paymentReference?: string;

  @ApiPropertyOptional({
    description:
      'Foto opcional del comprobante: URL local `/media/...` devuelta por `POST /api/media/upload` (multipart). Se envia al administrador por Telegram.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_IMAGE_URL_LENGTH, {
    message: 'La URL de la foto del comprobante es demasiado larga',
  })
  @Matches(IMAGE_URL_PATTERN, { message: IMAGE_URL_MESSAGE })
  paymentPhotoUrl?: string;

  @ApiPropertyOptional({
    type: [OrderPaymentPartDto],
    description:
      'Desglose del pago (pagos mixtos): cada metodo/moneda con lo que entrego el cliente. Sin `parts` se cobra una sola parte con `amount`/`method`/`currency`.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Debe indicar al menos una parte del pago' })
  @ValidateNested({ each: true })
  @Type(() => OrderPaymentPartDto)
  parts?: OrderPaymentPartDto[];

  @ApiPropertyOptional({
    type: [OrderPaymentChangeDto],
    description:
      'Vuelto entregado al cliente (puede ser en varias monedas/metodos). Se registra como egresos de caja separados.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderPaymentChangeDto)
  change?: OrderPaymentChangeDto[];
}
