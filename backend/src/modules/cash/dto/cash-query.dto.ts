import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import {
  CASH_MOVEMENT_CATEGORIES,
  PAYMENT_METHODS,
} from '../../../common/constants/enums';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class CashSessionQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['OPEN', 'CLOSED'] })
  @IsOptional()
  @IsIn(['OPEN', 'CLOSED'])
  status?: string;
}

export class CashMovementQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sessionId?: string;

  @ApiPropertyOptional({ enum: ['IN', 'OUT'] })
  @IsOptional()
  @IsIn(['IN', 'OUT'])
  type?: string;

  @ApiPropertyOptional({ enum: CASH_MOVEMENT_CATEGORIES })
  @IsOptional()
  @IsIn(CASH_MOVEMENT_CATEGORIES)
  category?: string;

  @ApiPropertyOptional({ enum: PAYMENT_METHODS })
  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  paymentMethod?: string;

  @ApiPropertyOptional({ description: 'Filtra por moneda (ej. VES, USD)' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  to?: string;
}
