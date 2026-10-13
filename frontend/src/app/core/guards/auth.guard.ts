import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import type { Role } from '../models/api.model';
import { AuthService } from '../services/auth.service';

/** Exige una sesion activa; si no, redirige al login. */
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.isAuthenticated() ? true : router.createUrlTree(['/login']);
};

/** Restringe una ruta a ciertos roles (si no, vuelve al panel). */
export function roleGuard(roles: Role[]): CanActivateFn {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    return auth.hasRole(roles) ? true : router.createUrlTree(['/panel']);
  };
}
