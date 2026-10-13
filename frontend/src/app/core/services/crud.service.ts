import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import type { Paginated } from '../models/api.model';

/** Convierte un objeto de filtros en `HttpParams` (ignora null/undefined/''). */
export function toHttpParams(query: object = {}): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
    if (value === null || value === undefined || value === '') continue;
    params = params.set(key, String(value));
  }
  return params;
}

/**
 * Cliente CRUD generico para los recursos REST del backend
 * (`GET /recurso`, `GET /recurso/:id`, `POST`, `PATCH`, `DELETE`).
 */
export abstract class CrudService<T, P> {
  protected readonly baseUrl: string;

  protected constructor(
    protected readonly http: HttpClient,
    protected readonly resource: string,
  ) {
    this.baseUrl = `${environment.apiUrl}/${resource}`;
  }

  list(query: Record<string, unknown> = {}) {
    return this.http.get<Paginated<T>>(this.baseUrl, {
      params: toHttpParams(query),
    });
  }

  get(id: string) {
    return this.http.get<T>(`${this.baseUrl}/${id}`);
  }

  create(payload: P) {
    return this.http.post<T>(this.baseUrl, payload);
  }

  update(id: string, payload: Partial<P>) {
    return this.http.patch<T>(`${this.baseUrl}/${id}`, payload);
  }

  remove(id: string) {
    return this.http.delete<{ id: string }>(`${this.baseUrl}/${id}`);
  }
}
