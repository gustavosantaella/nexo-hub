import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional } from 'class-validator';
import { buildDateRange } from '../utils/date.util';

/** Query params para filtrar por rango de fechas. */
export class DateRangeQueryDto {
  @ApiPropertyOptional({ description: 'Fecha desde (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Fecha hasta (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  /** Rango por defecto: desde el inicio del dia hasta ahora. */
  toDateRange(defaultFrom?: Date): { gte?: Date; lte?: Date } {
    // Las fechas sin hora se interpretan como fecha local (inicio/fin del dia);
    // asi el filtro del dia del usuario incluye todo el dia y no se corre por
    // el desfase UTC (ver date.util.ts).
    const range = buildDateRange(this.from, this.to);
    if (!range.gte && defaultFrom) range.gte = defaultFrom;
    return range;
  }
}
