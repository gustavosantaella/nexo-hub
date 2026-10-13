import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Limite del logo (caracteres). El logo se guarda como data URL en base64 y el
 * navegador ya lo reduce a 400 px de lado (~200 KB); el tope solo evita que un
 * ADMIN pegue algo gigante en el campo.
 */
const MAX_LOGO_LENGTH = 400_000;

/** Datos de una empresa (los edita un ADMIN/MANAGER en Configuracion). */
export class UpdateCompanyDto {
  @ApiPropertyOptional({ example: 'Panaderia El Trigal, C.A.' })
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'El nombre de la empresa es obligatorio' })
  name?: string;

  @ApiPropertyOptional({ example: 'J-12345678-9', description: 'RIF' })
  @IsOptional()
  @IsString()
  @MinLength(5, { message: 'El RIF no es valido' })
  rif?: string;

  @ApiPropertyOptional({ example: '0212-1234567' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'contacto@empresa.com' })
  @IsOptional()
  @IsEmail({}, { message: 'El correo no es valido' })
  email?: string;

  @ApiPropertyOptional({ example: 'Av. Principal, Caracas' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({
    description:
      'Logo de la empresa para los reportes: URL publica o data URL (base64). Cadena vacia lo elimina.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_LOGO_LENGTH, { message: 'El logo es demasiado grande' })
  logoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
