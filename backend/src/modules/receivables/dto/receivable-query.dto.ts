import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { ACCOUNT_STATUSES } from '../../../common/constants/enums';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ReceivableQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ACCOUNT_STATUSES })
  @IsOptional()
  @IsIn(ACCOUNT_STATUSES)
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiPropertyOptional({ description: 'Solo vencidas (dueDate < hoy y no cobradas)' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  overdueOnly?: boolean;

  @ApiPropertyOptional({ description: 'Vencimiento desde (ISO 8601)' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'Vencimiento hasta (ISO 8601)' })
  @IsOptional()
  @IsString()
  to?: string;
}
