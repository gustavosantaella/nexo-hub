import type { HttpInterceptorFn } from '@angular/common/http';
import { storedToken } from '../auth/session';

/** Agrega el token JWT a todas las peticiones autenticadas. */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const token = storedToken();
  const isAuthEndpoint = request.url.includes('/auth/login');

  if (!token || isAuthEndpoint) return next(request);

  return next(
    request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }),
  );
};
