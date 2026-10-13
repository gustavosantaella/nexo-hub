import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import {
  ORDER_STATUSES,
  ORDER_TYPES,
  PAYMENT_STATUSES,
  type OrderStatus,
  type OrderType,
} from '../../../common/constants/enums';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class UpdateOrderStatusDto {
  @ApiProperty({ enum: ORDER_STATUSES })
  @IsIn(ORDER_STATUSES, { message: 'Estado invalido' })
  status!: OrderStatus;
}

export class OrderQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Busca por codigo, mesa o nombre de cliente' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: ORDER_STATUSES })
  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: OrderStatus;

  @ApiPropertyOptional({ enum: ORDER_TYPES })
  @IsOptional()
  @IsIn(ORDER_TYPES)
  type?: OrderType;

  @ApiPropertyOptional({ enum: PAYMENT_STATUSES })
  @IsOptional()
  @IsIn(PAYMENT_STATUSES)
  paymentStatus?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cashSessionId?: string;

  @ApiPropertyOptional({ description: 'Fecha desde (ISO 8601)' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'Fecha hasta (ISO 8601)' })
  @IsOptional()
  @IsString()
  to?: string;
}

