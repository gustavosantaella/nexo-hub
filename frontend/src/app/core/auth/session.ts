import type { SessionResponse } from '../models/api.model';

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
