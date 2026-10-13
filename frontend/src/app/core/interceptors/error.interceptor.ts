import type { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { clearSession } from '../auth/session';
import { ToastService } from '../services/toast.service';
import { apiErrorMessage } from '../utils/format';

/**
 * Traduce los errores del API a notificaciones en espanol y cierra la sesion
 * cuando el token deja de ser valido.
 */
export const errorInterceptor: HttpInterceptorFn = (request, next) => {
  const toast = inject(ToastService);
  const router = inject(Router);
  const isAuthEndpoint = request.url.includes('/auth/login');

  return next(request).pipe(
    catchError((error: unknown) => {
      const status = (error as { status?: number })?.status ?? 0;

      if (status === 401 && !isAuthEndpoint) {
        clearSession();
        toast.error('Tu sesión expiró. Vuelve a iniciar sesión.', 'Sesión finalizada');
        void router.navigate(['/login']);
      } else if (status === 403) {
        toast.error('No tienes permisos para realizar esta acción.', 'Acceso denegado');
      } else if (status !== 401) {
        toast.error(apiErrorMessage(error), 'Error');
      }

      return throwError(() => error);
    }),
  );
};
