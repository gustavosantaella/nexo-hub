import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/** Cambio de empresa activa: reemite el token con el rol de esa empresa. */
export class SwitchCompanyDto {
  @ApiProperty({ description: 'Id de la empresa (de `GET /companies/mine`)' })
  @IsString()
  @IsNotEmpty({ message: 'Debes indicar la empresa' })
  companyId!: string;
}
