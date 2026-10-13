import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
