import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  IMAGE_URL_MESSAGE,
  IMAGE_URL_PATTERN,
  MAX_IMAGE_URL_LENGTH,
} from '../../../common/media/image-url.util';

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
      'Logo de la empresa para los reportes: URL local `/media/...` devuelta por `POST /api/media/upload` (multipart) o URL publica heredada. Cadena vacia lo elimina.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_IMAGE_URL_LENGTH, { message: 'La URL del logo es demasiado larga' })
  @Matches(IMAGE_URL_PATTERN, { message: IMAGE_URL_MESSAGE })
  logoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
