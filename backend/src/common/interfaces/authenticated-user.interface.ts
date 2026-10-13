import type { Role } from '../constants/enums';

/** Payload que viaja firmado dentro del JWT. */
export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
  iat?: number;
  exp?: number;
}

/** Usuario autenticado disponible en `request.user` tras el guard JWT. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}
