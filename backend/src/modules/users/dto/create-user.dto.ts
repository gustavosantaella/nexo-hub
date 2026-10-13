import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { ROLES, type Role } from '../../../common/constants/enums';

/**
 * Alta (o incorporacion) de un usuario EN la empresa activa.
 * El rol es el que tendra en ESA empresa; si el correo ya existe en el
 * sistema solo se le agrega la membresia (la contrasena no se usa).
 */
export class CreateUserDto {
  @ApiProperty({ example: 'cajero@nexohub.com' })
  @IsEmail({}, { message: 'El correo no es valido' })
  email!: string;

  @ApiPropertyOptional({
    example: 'Cajero123',
    minLength: 6,
    description: 'Obligatoria solo si el correo no existe todavia',
  })
  @IsOptional()
  @IsString()
  @MinLength(6, { message: 'La contrasena debe tener al menos 6 caracteres' })
  password?: string;

  @ApiProperty({ example: 'Juan Perez' })
  @IsString()
  @MinLength(2, { message: 'El nombre es obligatorio' })
  name!: string;

  @ApiPropertyOptional({ example: 'V-12345678', description: 'Cedula' })
  @IsOptional()
  @IsString()
  documentId?: string;

  @ApiPropertyOptional({ enum: ROLES, default: 'CASHIER' })
  @IsOptional()
  @IsIn(ROLES, { message: 'Rol invalido' })
  role?: Role;

  @ApiPropertyOptional({ example: '0414-1234567' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({
    default: true,
    description: 'Estado del usuario DENTRO de esta empresa',
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

