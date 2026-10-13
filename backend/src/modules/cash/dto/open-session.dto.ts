import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Maximo de monedas distintas en las que se puede contar un mismo fondo.
 * Es solo una salvaguarda de la peticion (un cajon real no usa tantas).
 */
export const MAX_OPENING_LINES = 8;

/** Una parte del fondo inicial contada en una moneda concreta. */
export class OpeningLineDto {
  @ApiProperty({
    description: 'Moneda en la que se cuenta esta parte del fondo',
    example: 'EUR',
  })
  @IsString({ message: 'La moneda de cada linea debe ser un texto' })
  currency!: string;

  @ApiProperty({ description: 'Monto contado en esa moneda', example: 50 })
  @Type(() => Number)
  @IsNumber({}, { message: 'El monto de cada linea debe ser numerico' })
  @Min(0, { message: 'El monto de cada linea no puede ser negativo' })
  amount!: number;
}

export class OpenSessionDto {
  @ApiPropertyOptional({
    description:
      'Monto inicial (fondo) expresado en `openingCurrency`. Opcional si se envia `openingLines` (fondo contado en varias monedas).',
    example: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'El monto inicial debe ser numerico' })
  @Min(0, { message: 'El monto inicial no puede ser negativo' })
  openingAmount?: number;

  @ApiPropertyOptional({
    description:
      'Moneda en la que se cuenta el fondo inicial (USD por defecto). El monto se guarda convertido a la moneda base.',
    example: 'VES',
  })
  @IsOptional()
  @IsString()
  openingCurrency?: string;

  @ApiPropertyOptional({
    type: [OpeningLineDto],
    description:
      'Fondo contado en varias monedas a la vez (ej. 100 USD + 5.000 Bs + 50 EUR). Si se envia, tiene prioridad sobre `openingAmount`: el total guardado en la moneda base es la suma de los equivalentes de cada linea.',
  })
  @IsOptional()
  @IsArray({ message: 'El fondo multimoneda debe ser una lista de lineas' })
  @ArrayMaxSize(MAX_OPENING_LINES, {
    message: `El fondo admite hasta ${MAX_OPENING_LINES} monedas distintas`,
  })
  @ValidateNested({ each: true })
  @Type(() => OpeningLineDto)
  openingLines?: OpeningLineDto[];

  @ApiPropertyOptional({ description: 'Observaciones de apertura' })
  @IsOptional()
  @IsString()
  openingNotes?: string;
}

