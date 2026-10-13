import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@nexohub.com' })
  @IsEmail({}, { message: 'El correo no es valido' })
  email!: string;

  @ApiProperty({ example: 'Admin123' })
  @IsString()
  @MinLength(6, { message: 'La contrasena debe tener al menos 6 caracteres' })
  password!: string;
}
