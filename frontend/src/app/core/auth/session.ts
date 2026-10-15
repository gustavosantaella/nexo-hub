import type { Role, SessionResponse } from '../models/api.model';

/**
 * Persistencia de la sesion (JWT + usuario + empresa activa) en `localStorage`.
 * Se aísla del `AuthService` para romper la dependencia circular
 * HttpClient -> interceptor -> AuthService -> HttpClient.
 */
const TOKEN_KEY = 'nexo-hub.token';
const SESSION_KEY = 'nexo-hub.session';
/** Clave heredada (sesion de una sola empresa); se limpia al cerrar sesion. */
const LEGACY_USER_KEY = 'nexo-hub.user';

export function storedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? storedSession()?.accessToken ?? null;
  } catch {
    return null;
  }
}

export function storedSession(): SessionResponse | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as SessionResponse) : null;
  } catch {
    return null;
  }
}

/** Rol del usuario **en la empresa activa**, leido de la sesion guardada. */
export function storedRole(): Role | null {
  return storedSession()?.role ?? null;
}

/**
 * `true` cuando la sesion activa administra el local (ADMIN o MANAGER).
 *
 * Igual que el token, se lee del almacenamiento y no del `AuthService`: asi el
 * `RatesService` puede decidir como mostrar los montos sin crear la dependencia
 * circular `AuthService -> RatesService -> AuthService`.
 */
export function storedCanManage(): boolean {
  const role = storedRole();
  return role === 'ADMIN' || role === 'MANAGER';
}

export function saveSession(session: SessionResponse): void {
  try {
    localStorage.setItem(TOKEN_KEY, session.accessToken);
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* almacenamiento no disponible (modo privado) */
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(LEGACY_USER_KEY);
  } catch {
    /* ignorado */
  }
}
