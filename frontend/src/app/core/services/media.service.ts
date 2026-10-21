import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/** Carpetas de imagen que acepta `POST /api/media/upload`. */
export type MediaFolder = 'products' | 'menu' | 'logo' | 'payments' | 'avatars';

/** Respuesta del backend después de guardar el archivo en disco. */
export interface UploadedImage {
  /** Ruta local que debe guardarse en la fila (`/media/...`). */
  url: string;
  /** Tamaño final del archivo en bytes. */
  bytes: number;
}

/**
 * Subida de imágenes por multipart.
 *
 * El archivo se envía una sola vez al backend, que lo reduce/valida (firma real,
 * máximo 8 MB) y lo guarda en `private/img`. El formulario solo conserva la URL
 * local devuelta; nunca viaja base64 dentro del JSON.
 */
@Injectable({ providedIn: 'root' })
export class MediaService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/media`;

  /** Sube el archivo y devuelve la URL local que hay que guardar en el recurso. */
  upload(
    file: Blob,
    folder: MediaFolder,
    filename = 'imagen',
  ): Observable<UploadedImage> {
    const body = new FormData();
    body.append('file', file, filename);
    body.append('folder', folder);
    return this.http.post<UploadedImage>(`${this.baseUrl}/upload`, body);
  }
}
