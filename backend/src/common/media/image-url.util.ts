/**
 * Reglas compartidas sobre las URLs de imagen que acepta el API.
 *
 * Las fotos nuevas se suben por `POST /api/media/upload` (multipart) y el
 * backend devuelve una ruta local `/media/...`. En la base solo se guardan esas
 * rutas locales (o una URL publica heredada); los data URL base64 ya no se
 * aceptan al guardar.
 */

/** Longitud maxima de una URL de imagen (evita cuerpos JSON gigantes). */
export const MAX_IMAGE_URL_LENGTH = 2_048;

/**
 * Ruta local servida por el backend o URL publica heredada.
 *
 * Los data URL (`data:image/...`) quedan fuera a proposito: la imagen se sube
 * como archivo multipart y se guarda en disco.
 */
export const IMAGE_URL_PATTERN =
  /^(?:\/media\/(?!.*\.\.)[A-Za-z0-9._~%/-]+|https?:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+)$/i;

/** Mensaje unico para los formularios cuando la URL no es valida. */
export const IMAGE_URL_MESSAGE =
  'La imagen debe subirse como archivo o ser una URL valida';

/** `true` para un data URL de imagen (solo lo usa la migracion historica). */
export function isDataImageUrl(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.trim().slice(0, 11).toLowerCase() === 'data:image/'
  );
}

/** `true` si el valor es una URL de imagen aceptable para guardar. */
export function isImageUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= MAX_IMAGE_URL_LENGTH &&
    IMAGE_URL_PATTERN.test(trimmed)
  );
}
