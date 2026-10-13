import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import type {
  Company,
  CompanyPayload,
  UserCompanySummary,
} from '../models/api.model';

/**
 * Empresas (tenants) del usuario.
 *
 * La empresa activa viaja en el token: para cambiarla se usa
 * `AuthService.switchCompany` (que además recarga las tasas de esa empresa).
 */
@Injectable({ providedIn: 'root' })
export class CompaniesService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/companies`;

  /** Empresas a las que pertenece el usuario. */
  mine() {
    return this.http.get<UserCompanySummary[]>(`${this.baseUrl}/mine`);
  }

  /** Empresa activa de la sesión. */
  current() {
    return this.http.get<Company>(`${this.baseUrl}/current`);
  }

  /** Crea una empresa y devuelve también la lista actualizada del usuario. */
  create(payload: CompanyPayload) {
    return this.http.post<{ company: Company; companies: UserCompanySummary[] }>(
      this.baseUrl,
      payload,
    );
  }

  /** Actualiza los datos de la empresa activa (ADMIN/MANAGER). */
  updateCurrent(payload: Partial<CompanyPayload>) {
    return this.http.patch<Company>(`${this.baseUrl}/current`, payload);
  }
}
