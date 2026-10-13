import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** Query params estandar para todos los listados paginados. */
export class PaginationQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({ description: 'Busqueda por texto' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Campo por el cual ordenar' })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'desc';

  /** Convierte sortBy/sortOrder a un `orderBy` de Prisma validando el campo. */
  toOrderBy(
    allowed: string[],
    fallback: Record<string, 'asc' | 'desc'> = { createdAt: 'desc' },
  ): Record<string, 'asc' | 'desc'> {
    if (this.sortBy && allowed.includes(this.sortBy)) {
      return { [this.sortBy]: this.sortOrder };
    }
    return fallback;
  }
}
