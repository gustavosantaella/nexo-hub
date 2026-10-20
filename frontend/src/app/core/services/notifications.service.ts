import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import type {
  NotificationSettings,
  NotificationSettingsPayload,
  TelegramLinkCode,
} from '../models/api.model';

/**
 * Configuración de notificaciones de Telegram de la empresa activa.
 *
 * El QR se carga como imagen pública (el `<img>` no puede enviar el JWT) y los
 * avisos se guardan por empresa: los comparte todo el equipo y los recibe el
 * chat del administrador vinculado.
 */
@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private readonly baseUrl = `${environment.apiUrl}/notifications`;

  /** Imagen del bot dentro de `backend/public/bot/qr.jpeg`. */
  readonly qrUrl = `${this.baseUrl}/telegram/qr`;

  constructor(private readonly http: HttpClient) {}

  getSettings() {
    return this.http.get<NotificationSettings>(`${this.baseUrl}/settings`);
  }

  update(payload: NotificationSettingsPayload) {
    return this.http.patch<NotificationSettings>(
      `${this.baseUrl}/settings`,
      payload,
    );
  }

  /** Genera el código temporal para enviar `/vincular CODIGO` al bot. */
  generateLinkCode() {
    return this.http.post<TelegramLinkCode>(
      `${this.baseUrl}/telegram/link-code`,
      {},
    );
  }

  unlink() {
    return this.http.delete<NotificationSettings>(
      `${this.baseUrl}/telegram/link`,
    );
  }

  sendTest() {
    return this.http.post<{ sent: boolean }>(
      `${this.baseUrl}/telegram/test`,
      {},
    );
  }
}
