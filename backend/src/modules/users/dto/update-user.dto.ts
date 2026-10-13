import { PartialType } from '@nestjs/swagger';
import { CreateUserDto } from './create-user.dto';

/** Todos los campos de CreateUserDto como opcionales (incluida la contrasena). */
export class UpdateUserDto extends PartialType(CreateUserDto) {}
