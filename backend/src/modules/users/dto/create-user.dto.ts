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

export class CreateUserDto {
  @ApiProperty({ example: 'admin@nexohub.com' })
  @IsEmail({}, { message: 'El correo no es valido' })
  email!: string;

  @ApiProperty({ example: 'Admin123', minLength: 6 })
  @IsString()
  @MinLength(6, { message: 'La contrasena debe tener al menos 6 caracteres' })
  password!: string;

  @ApiProperty({ example: 'Juan Perez' })
  @IsString()
  @MinLength(2, { message: 'El nombre es obligatorio' })
  name!: string;

  @ApiPropertyOptional({ enum: ROLES, default: 'CASHIER' })
  @IsOptional()
  @IsIn(ROLES, { message: 'Rol invalido' })
  role?: Role;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
