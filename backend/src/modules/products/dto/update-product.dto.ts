import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateProductDto } from './create-product.dto';

/**
 * El stock NO se actualiza por aqui: se gestiona exclusivamente a traves del
 * modulo de inventario (trazabilidad de movimientos).
 */
export class UpdateProductDto extends PartialType(
  OmitType(CreateProductDto, ['stock'] as const),
) {}
