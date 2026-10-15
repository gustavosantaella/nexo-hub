import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import type {
  CatalogDocument,
  CatalogImportMode,
  CatalogImportResult,
} from '../models/data-transfer.model';

/**
 * Respaldo del catálogo (Configuración → Datos).
 *
 * Dos operaciones y nada más: el API devuelve el documento del catálogo
 * completo y acepta ese mismo documento de vuelta. El archivo se arma y se lee
 * en el navegador (`core/utils/catalog-file.ts`): así el respaldo es un solo
 * JSON que el usuario puede guardar donde quiera y volver a subir sin tocarlo.
 *
 * Solo ADMIN y MANAGER pueden usar estos endpoints (la importación escribe
 * precios, costos y stock de golpe).
 */
@Injectable({ providedIn: 'root' })
export class DataTransferService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/data-transfer`;

  /** Catálogo completo del local listo para guardar como archivo. */
  exportCatalog(): Observable<CatalogDocument> {
    return this.http.get<CatalogDocument>(`${this.baseUrl}/export`);
  }

  /**
   * Importa un archivo exportado previamente.
   *
   * El archivo viaja TAL CUAL se descargó (sin reescribirlo) y las opciones van
   * en el query string: `mode` decide qué pasa con los registros que ya existen
   * (misma clave natural), `merge` los actualiza y `skip` los deja intactos.
   */
  importCatalog(
    document: unknown,
    mode: CatalogImportMode = 'merge',
  ): Observable<CatalogImportResult> {
    return this.http.post<CatalogImportResult>(`${this.baseUrl}/import`, document, {
      params: new HttpParams().set('mode', mode),
    });
  }
}
