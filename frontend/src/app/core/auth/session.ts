import { signal } from '@angular/core';
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

/**
 * Cambia cada vez que se guarda o se cierra la sesion.
 *
 * El rol se lee del almacenamiento (no de un signal) para romper la dependencia
 * circular con `AuthService`, asi que quien lo consulte dentro de un `computed`
 * tiene que leer tambien esta señal: si no, el calculo se quedaria con el valor
 * que vio la primera vez —el de la sesion anterior— hasta que algo mas lo
 * invalide. Es el caso del login en un equipo ya abierto: el `RatesService` se
 * construye al arrancar (sin sesion) y despues entra el cajero.
 */
const sessionRevision = signal(0);

/** Señal de solo lectura para reaccionar a los cambios de sesion. */
export const sessionChanges = sessionRevision.asReadonly();

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

/**
 * `true` cuando la sesion activa es del **personal de caja** (hay rol guardado y
 * no administra el local).
 *
 * Es distinto de `!storedCanManage()`: sin sesion (arranque, pruebas, pantallas
 * publicas) no se aplican las preferencias del cajero, porque no hay a quien
 * aplicarselas.
 */
export function storedIsCashier(): boolean {
  const role = storedRole();
  return role !== null && role !== 'ADMIN' && role !== 'MANAGER';
}

export function saveSession(session: SessionResponse): void {
  try {
    localStorage.setItem(TOKEN_KEY, session.accessToken);
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* almacenamiento no disponible (modo privado) */
  }
  sessionRevision.update((value) => value + 1);
}

export function clearSession(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(LEGACY_USER_KEY);
  } catch {
    /* ignorado */
  }
  sessionRevision.update((value) => value + 1);
}
