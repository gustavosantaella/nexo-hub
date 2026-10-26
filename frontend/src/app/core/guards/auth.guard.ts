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

/**
 * Restringe una ruta a ciertos roles.
 *
 * Si el rol no está permitido se vuelve al panel; el cajero (que solo trabaja en
 * el punto de venta) vuelve directamente a su vista para no quedar rebotando
 * contra el guard del panel.
 */
export function roleGuard(roles: Role[]): CanActivateFn {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    if (auth.hasRole(roles)) return true;
    return router.createUrlTree([
      auth.role() === 'CASHIER' ? '/panel/caja/pos' : '/panel',
    ]);
  };
}
