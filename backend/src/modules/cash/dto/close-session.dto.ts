import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CloseSessionDto {
  @ApiProperty({ description: 'Efectivo contado fisicamente en caja', example: 520.5 })
  @Type(() => Number)
  @IsNumber({}, { message: 'El monto contado debe ser numerico' })
  @Min(0, { message: 'El monto contado no puede ser negativo' })
  countedAmount!: number;

  @ApiPropertyOptional({
    description:
      'Moneda en la que se conto el efectivo (USD por defecto). El monto se guarda convertido a la moneda base.',
    example: 'VES',
  })
  @IsOptional()
  @IsString()
  countedCurrency?: string;

  @ApiPropertyOptional({ description: 'Observaciones de cierre (diferencias, etc.)' })
  @IsOptional()
  @IsString()
  closingNotes?: string;
}
