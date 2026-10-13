import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { AuthUser, LoginResponse, Role, User } from '../models/api.model';
import {
  clearSession,
  saveSession,
  storedToken,
  storedUser,
} from '../auth/session';

/** Autenticacion y estado de la sesion actual (signals). */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly _token = signal<string | null>(storedToken());
  private readonly _user = signal<AuthUser | null>(storedUser());

  readonly token = this._token.asReadonly();
  readonly user = this._user.asReadonly();
  readonly isAuthenticated = computed(() => this._token() !== null);
  readonly role = computed<Role | null>(() => this._user()?.role ?? null);
  /** ADMIN y MANAGER pueden administrar catalogo y finanzas. */
  readonly canManage = computed(() => {
    const role = this.role();
    return role === 'ADMIN' || role === 'MANAGER';
  });
  readonly isAdmin = computed(() => this.role() === 'ADMIN');

  login(email: string, password: string): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>(`${environment.apiUrl}/auth/login`, { email, password })
      .pipe(tap((response) => this.persist(response)));
  }

  /** Refresca el perfil desde el backend (valida que el token siga vivo). */
  refreshProfile(): Observable<User> {
    return this.http
      .get<User>(`${environment.apiUrl}/auth/me`)
      .pipe(tap((user) => this.persistUser(user)));
  }

  hasRole(roles: Role[]): boolean {
    const role = this.role();
    return !!role && roles.includes(role);
  }

  logout(options: { redirect?: boolean } = {}): void {
    clearSession();
    this._token.set(null);
    this._user.set(null);
    if (options.redirect !== false) void this.router.navigate(['/login']);
  }

  private persist(response: LoginResponse): void {
    saveSession(response.accessToken, response.user);
    this._token.set(response.accessToken);
    this._user.set(response.user);
  }

  private persistUser(user: User): void {
    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
    const token = this._token();
    if (token) saveSession(token, authUser);
    this._user.set(authUser);
  }
}
