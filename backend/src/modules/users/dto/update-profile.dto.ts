import { ApiPropertyOptional } from '@nestjs/swagger';
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

/**
 * Datos personales del usuario autenticado (Configuracion > Mis datos).
 * Son datos GLOBALES de la cuenta (nombre, cedula, correo, telefono), no
 * dependen de la empresa activa. Para cambiar la contrasena hay que enviar
 * tambien `currentPassword`.
 */
export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Juan Perez' })
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'El nombre es obligatorio' })
  name?: string;

  @ApiPropertyOptional({ example: 'V-12345678', description: 'Cedula' })
  @IsOptional()
  @IsString()
  documentId?: string;

  @ApiPropertyOptional({ example: 'juan@nexohub.com' })
  @IsOptional()
  @IsEmail({}, { message: 'El correo no es valido' })
  email?: string;

  @ApiPropertyOptional({ example: '0414-1234567' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({
    description:
      'Avatar del usuario: URL local `/media/...` devuelta por `POST /api/media/upload` (multipart).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_IMAGE_URL_LENGTH, { message: 'La URL del avatar es demasiado larga' })
  @Matches(IMAGE_URL_PATTERN, { message: IMAGE_URL_MESSAGE })
  avatarUrl?: string;

  @ApiPropertyOptional({ minLength: 6, description: 'Nueva contrasena' })
  @IsOptional()
  @IsString()
  @MinLength(6, { message: 'La contrasena debe tener al menos 6 caracteres' })
  password?: string;

  @ApiPropertyOptional({
    description: 'Contrasena actual (obligatoria si se cambia la contrasena)',
  })
  @IsOptional()
  @IsString()
  currentPassword?: string;
}
