import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** Datos de la empresa que se crea al registrar una cuenta nueva. */
export class RegisterCompanyDto {
  @ApiProperty({ example: 'Panaderia El Trigal, C.A.' })
  @IsString()
  @MinLength(2, { message: 'El nombre de la empresa es obligatorio' })
  name!: string;

  @ApiProperty({ example: 'J-12345678-9', description: 'RIF de la empresa' })
  @IsString()
  @MinLength(5, { message: 'El RIF no es valido' })
  rif!: string;

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
}

/** Datos del usuario que queda como ADMIN de la empresa creada. */
export class RegisterUserDto {
  @ApiProperty({ example: 'Maria Perez' })
  @IsString()
  @MinLength(2, { message: 'El nombre es obligatorio' })
  name!: string;

  @ApiProperty({ example: 'V-12345678', description: 'Cedula' })
  @IsString()
  @MinLength(4, { message: 'La cedula es obligatoria' })
  documentId!: string;

  @ApiProperty({ example: 'maria@empresa.com' })
  @IsEmail({}, { message: 'El correo no es valido' })
  email!: string;

  @ApiPropertyOptional({ example: '0414-1234567' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({ example: 'Clave123', minLength: 6 })
  @IsString()
  @MinLength(6, { message: 'La contrasena debe tener al menos 6 caracteres' })
  password!: string;
}

/** Registro de una empresa nueva con su primer usuario administrador. */
export class RegisterDto {
  @ApiProperty({ type: RegisterCompanyDto })
  @ValidateNested()
  @Type(() => RegisterCompanyDto)
  company!: RegisterCompanyDto;

  @ApiProperty({ type: RegisterUserDto })
  @ValidateNested()
  @Type(() => RegisterUserDto)
  user!: RegisterUserDto;
}
