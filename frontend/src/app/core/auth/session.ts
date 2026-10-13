import type { AuthUser } from '../models/api.model';

/**
 * Persistencia de la sesion (JWT + usuario) en `localStorage`.
 * Se aísla del `AuthService` para romper la dependencia circular
 * HttpClient -> interceptor -> AuthService -> HttpClient.
 */
const TOKEN_KEY = 'nexo-hub.token';
const USER_KEY = 'nexo-hub.user';

export function storedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function storedUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function saveSession(token: string, user: AuthUser): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* almacenamiento no disponible (modo privado) */
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    /* ignorado */
  }
}
