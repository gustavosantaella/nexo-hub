import { environment } from '../../../environments/environment';

/** Prefijo local con el que el backend guarda las imagenes en la base de datos. */
const MEDIA_PREFIX = '/media';

/** Esquema de una URL absoluta (`http:`, `https:`, `data:`, `blob:`, `//host`). */
const ABSOLUTE_URL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * Resuelve una URL de imagen para usarla en un `<img>`.
 *
 * La base de datos guarda solo rutas locales `/media/...`; `environment.mediaUrl`
 * indica de donde se sirven (en desarrollo `http://localhost:3000/media`, en
 * produccion `/media` detras del gateway). Las URLs absolutas (`http`, `data`,
 * `blob`) y las rutas que no son de media (`/api/...`, `/assets/...`) se dejan
 * intactas.
 *
 * `base` solo existe para las pruebas; en la aplicacion se usa el entorno.
 */
export function resolveMediaUrl(
  url: string | null | undefined,
  base = environment.mediaUrl,
): string {
  const value = (url ?? '').trim();
  if (!value) return '';
  if (ABSOLUTE_URL.test(value)) return value;
  if (value !== MEDIA_PREFIX && !value.startsWith(`${MEDIA_PREFIX}/`)) return value;

  const root = (base ?? '').trim().replace(/\/+$/, '');
  if (!root) return value;
  return `${root}${value.slice(MEDIA_PREFIX.length)}`;
}
