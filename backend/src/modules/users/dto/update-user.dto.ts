import { PartialType } from '@nestjs/swagger';
import { CreateUserDto } from './create-user.dto';

/**
 * Todos los campos de CreateUserDto como opcionales (incluida la contrasena).
 * `active` y `role` se aplican a la membresia de la empresa activa.
 */
export class UpdateUserDto extends PartialType(CreateUserDto) {}

