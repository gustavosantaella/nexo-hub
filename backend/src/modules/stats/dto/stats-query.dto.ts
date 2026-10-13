import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const STAT_GRANULARITIES = ['day', 'week', 'month'] as const;
export type StatGranularity = (typeof STAT_GRANULARITIES)[number];

/** Rango de fechas para los reportes. Si no se envia, ultimos N dias. */
export class StatsQueryDto {
  @ApiPropertyOptional({ description: 'Fecha desde (ISO 8601)' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'Fecha hasta (ISO 8601)' })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({
    default: 30,
    description: 'Dias hacia atras cuando no se envia from/to',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days: number = 30;

  @ApiPropertyOptional({ enum: STAT_GRANULARITIES, description: 'Auto si se omite' })
  @IsOptional()
  @IsIn(STAT_GRANULARITIES)
  granularity?: StatGranularity;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 10;
}
