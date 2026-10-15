import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import type {
  Company,
  RegisterPayload,
  Role,
  SessionResponse,
  UpdateProfilePayload,
  User,
  UserCompanySummary,
} from '../models/api.model';
import {
  clearSession,
  saveSession,
  storedSession,
} from '../auth/session';
import { PreferencesService } from './preferences.service';
import { RatesService } from './rates.service';

/**
 * Autenticacion y estado de la sesion actual (signals).
 *
 * El sistema es multi-empresa: la sesion guarda el usuario, la empresa activa,
 * el rol **en esa empresa** y la lista de empresas del usuario.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly rates = inject(RatesService);
  private readonly preferences = inject(PreferencesService);

  private readonly _session = signal<SessionResponse | null>(storedSession());

  constructor() {
    // La sesión puede venir restaurada del navegador: la propina y la
    // presentación de los formularios son de la empresa activa y viven en el
    // servidor, así que se traen al arrancar (y con `load()` en cada
    // login/registro/cambio de empresa).
    if (this._session()) this.preferences.load();
  }

  readonly session = this._session.asReadonly();
  readonly token = computed<string | null>(
    () => this._session()?.accessToken ?? null,
  );
  readonly user = computed<User | null>(() => this._session()?.user ?? null);
  readonly company = computed<Company | null>(() => this._session()?.company ?? null);
  readonly companies = computed<UserCompanySummary[]>(
    () => this._session()?.companies ?? [],
  );
  readonly isAuthenticated = computed(() => this.token() !== null);
  /** Rol del usuario EN LA EMPRESA ACTIVA. */
  readonly role = computed<Role | null>(() => this._session()?.role ?? null);
  /** ADMIN y MANAGER pueden administrar catalogo y finanzas. */
  readonly canManage = computed(() => {
    const role = this.role();
    return role === 'ADMIN' || role === 'MANAGER';
  });
  readonly isAdmin = computed(() => this.role() === 'ADMIN');

  login(email: string, password: string): Observable<SessionResponse> {
    return this.http
      .post<SessionResponse>(`${environment.apiUrl}/auth/login`, { email, password })
      .pipe(tap((response) => this.applySession(response)));
  }

  /** Registra una empresa nueva con su usuario administrador. */
  register(payload: RegisterPayload): Observable<SessionResponse> {
    return this.http
      .post<SessionResponse>(`${environment.apiUrl}/auth/register`, payload)
      .pipe(tap((response) => this.applySession(response)));
  }

  /** Cambia la empresa activa y recarga las tasas/monedas de esa empresa. */
  switchCompany(companyId: string): Observable<SessionResponse> {
    return this.http
      .post<SessionResponse>(`${environment.apiUrl}/auth/switch-company`, { companyId })
      .pipe(tap((response) => this.applySession(response)));
  }

  /** Actualiza los datos del usuario (y su contraseña si se envia). */
  updateProfile(payload: UpdateProfilePayload): Observable<User> {
    return this.http
      .patch<User>(`${environment.apiUrl}/auth/profile`, payload)
      .pipe(tap((user) => this.patchUser(user)));
  }

  /** Refresca la sesion completa (usuario + empresa + rol) desde el backend. */
  refreshProfile(): Observable<SessionResponse> {
    return this.http
      .get<SessionResponse>(`${environment.apiUrl}/auth/me`)
      .pipe(tap((response) => this.applySession(response, false)));
  }

  hasRole(roles: Role[]): boolean {
    const role = this.role();
    return !!role && roles.includes(role);
  }

  logout(options: { redirect?: boolean } = {}): void {
    clearSession();
    this._session.set(null);
    // Lo que la empresa tenía configurado no se queda en un equipo compartido.
    this.preferences.clear();
    if (options.redirect !== false) void this.router.navigate(['/login']);
  }

  /**
   * Persiste la sesion, repinta los signals, trae las preferencias de la empresa
   * activa y (por defecto) recarga las tasas: unas y otras son POR EMPRESA, por
   * lo que hay que traerlas tras login/registro/cambio.
   */
  private applySession(response: SessionResponse, reloadRates = true): void {
    saveSession(response);
    this._session.set(response);
    this.preferences.load();
    if (reloadRates) this.rates.load(true);
  }

  /** Mantiene la sesion sincronizada tras editar el perfil del usuario. */
  private patchUser(user: User): void {
    const current = this._session();
    if (!current) return;
    const updated: SessionResponse = { ...current, user };
    saveSession(updated);
    this._session.set(updated);
  }
}
