import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, Min } from 'class-validator';

/**
 * Tasa personalizada del local (Bs por USD).
 * Enviar `usd: null` (o el cuerpo vacio) para volver a usar solo las tasas BCV.
 */
export class UpdateCustomRateDto {
  @ApiProperty({
    example: 905.42,
    description:
      'Bolivares por dolar. `null` elimina la tasa personalizada y deja solo las del BCV.',
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 6 },
    { message: 'La tasa debe ser un numero valido' },
  )
  @Min(0.000001, { message: 'La tasa debe ser mayor a cero' })
  usd?: number | null;
}
