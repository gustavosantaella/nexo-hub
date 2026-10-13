import type { Role } from '../constants/enums';

/** Payload que viaja firmado dentro del JWT. */
export interface JwtPayload {
  sub: string;
  email: string;
  /** Empresa activa de la sesion: aísla todos los datos de dominio. */
  companyId: string;
  /** Rol del usuario EN la empresa activa (no es un rol global). */
  role: Role;
  iat?: number;
  exp?: number;
}

/** Usuario autenticado disponible en `request.user` tras el guard JWT. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  /** Empresa activa; obligatorio para cualquier consulta de dominio. */
  companyId: string;
  /** Rol del usuario en la empresa activa. */
  role: Role;
}

/** Resumen de una empresa para el usuario (con su rol en ella). */
export interface UserCompanySummary {
  id: string;
  name: string;
  rif: string;
  role: Role;
  active: boolean;
}

