import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Mensaje del bot: solo se usa el texto y el chat que lo envio. */
export interface TelegramChat {
  id: number | string;
  type?: string;
  title?: string;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TelegramMessage {
  message_id: number;
  text?: string;
  chat: TelegramChat;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

/** Identidad publica del bot (`@usuario`) que se muestra en Configuracion. */
export interface TelegramBotInfo {
  id: number;
  username: string;
  firstName: string;
}

/** Tiempo que Telegram mantiene abierta la consulta de `getUpdates`. */
const LONG_POLL_SECONDS = 25;

/**
 * Cliente minimo de la Bot API de Telegram.
 *
 * Se usa `fetch` (Node 18+) para no sumar dependencias. El token es global del
 * sistema y vive en `TELEGRAM_BOT_API_TOKEN`; cada empresa solo guarda el chat
 * de su administrador en `notification_settings`.
 */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly token: string;
  private readonly apiBase: string;
  private botInfoCache: TelegramBotInfo | null = null;

  constructor(config: ConfigService) {
    this.token = config.get<string>('telegram.botToken')?.trim() ?? '';
    this.apiBase = `https://api.telegram.org/bot${this.token}`;
  }

  /** `true` cuando el despliegue configuro el token del bot. */
  get configured(): boolean {
    return this.token.length > 0;
  }

  /** Identidad del bot (cacheada): sirve para mostrar `@usuario` en la UI. */
  async getBotInfo(): Promise<TelegramBotInfo | null> {
    if (!this.configured) return null;
    if (this.botInfoCache) return this.botInfoCache;

    try {
      const result = await this.call<{
        id: number;
        username: string;
        first_name: string;
      }>('getMe');
      this.botInfoCache = {
        id: result.id,
        username: result.username,
        firstName: result.first_name,
      };
      return this.botInfoCache;
    } catch (error) {
      this.logger.warn(`No se pudo consultar el bot de Telegram: ${this.errorText(error)}`);
      return null;
    }
  }

  /**
   * Mensajes pendientes del bot. `offset` confirma los updates anteriores; el
   * `timeout` largo evita consultar en vacio (long polling).
   */
  async getUpdates(
    offset: number,
    signal?: AbortSignal,
  ): Promise<TelegramUpdate[]> {
    if (!this.configured) return [];
    return this.call<TelegramUpdate[]>(
      'getUpdates',
      {
        offset,
        timeout: LONG_POLL_SECONDS,
        allowed_updates: ['message'],
      },
      signal,
    );
  }

  /**
   * Envia un mensaje HTML al chat indicado. Devuelve `false` si Telegram no
   * responde: un aviso nunca debe tumbar la venta, el cierre de caja ni la
   * cancelacion que lo origino.
   */
  async sendMessage(chatId: string | null | undefined, html: string): Promise<boolean> {
    if (!this.configured || !chatId) return false;

    try {
      await this.call('sendMessage', {
        chat_id: chatId,
        text: html.slice(0, 4000),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
      return true;
    } catch (error) {
      this.logger.warn(
        `No se pudo enviar el mensaje de Telegram al chat ${chatId}: ${this.errorText(error)}`,
      );
      return false;
    }
  }

  /**
   * Envia una foto (data URL) con pie de foto HTML. Se usa para el comprobante
   * de una transferencia/pago movil. Igual que `sendMessage`, nunca lanza: si
   * Telegram falla la venta ya quedo cobrada y solo se registra el aviso.
   */
  async sendPhoto(
    chatId: string | null | undefined,
    dataUrl: string,
    html: string,
  ): Promise<boolean> {
    if (!this.configured || !chatId) return false;
    const image = parseImageDataUrl(dataUrl);
    if (!image) return false;

    try {
      const form = new FormData();
      form.set('chat_id', chatId);
      form.set('caption', html.slice(0, 1024));
      form.set('parse_mode', 'HTML');
      form.set(
        'photo',
        new Blob([image.bytes], { type: image.mime }),
        image.filename,
      );

      const response = await fetch(`${this.apiBase}/sendPhoto`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(20000),
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; description?: string }
        | null;

      if (!response.ok || !payload?.ok) {
        throw new Error(
          payload?.description ?? `Telegram respondio ${response.status}`,
        );
      }
      return true;
    } catch (error) {
      this.logger.warn(
        `No se pudo enviar la foto de Telegram al chat ${chatId}: ${this.errorText(error)}`,
      );
      return false;
    }
  }

  /** Llama a un metodo de la Bot API y devuelve `result`. */
  private async call<T>(
    method: string,
    body?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await fetch(`${this.apiBase}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      // Las llamadas cortas (getMe/sendMessage) no pueden dejar colgada la
      // peticion del usuario; `getUpdates` pasa su propio signal de long polling.
      signal: signal ?? AbortSignal.timeout(8000),
    });

    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; result?: T; description?: string }
      | null;

    if (!response.ok || !payload?.ok) {
      throw new Error(
        payload?.description ?? `Telegram respondio ${response.status}`,
      );
    }

    return payload.result as T;
  }

  private errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Escapa texto libre para el `parse_mode: HTML` de Telegram. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Decodifica un data URL de imagen aceptado por el POS. */
function parseImageDataUrl(
  value: string,
): { bytes: Uint8Array<ArrayBuffer>; mime: string; filename: string } | null {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(
    value,
  );
  if (!match) return null;

  const bytes = Uint8Array.from(Buffer.from(match[2], 'base64'));
  // Telegram acepta fotos de hasta 10 MB; se guarda margen para el formulario.
  if (bytes.byteLength === 0 || bytes.byteLength > 8 * 1024 * 1024) return null;

  const extension = match[1] === 'image/jpeg' ? 'jpg' : match[1].split('/')[1];
  return { bytes, mime: match[1], filename: `comprobante.${extension}` };
}
