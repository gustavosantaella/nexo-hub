import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Nueva empresa para el usuario autenticado (queda como ADMIN de ella).
 * Se usa para que un mismo usuario pueda administrar varias empresas.
 */
export class CreateCompanyDto {
  @ApiProperty({ example: 'Panaderia El Trigal, C.A.' })
  @IsString()
  @MinLength(2, { message: 'El nombre de la empresa es obligatorio' })
  name!: string;

  @ApiProperty({ example: 'J-12345678-9', description: 'RIF' })
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
