/**
 * Utilidades de imagen para el navegador.
 *
 * El logo de la empresa se guarda en la base de datos como *data URL*, así que
 * antes de enviarlo se reduce en el propio navegador (canvas): un logo de
 * 4000 px ocuparía megabytes y ensuciaría la sesión que se guarda en
 * `localStorage`. Con 400 px de lado sobra para imprimirlo en un reporte A4.
 */

/** Lado máximo (en píxeles) del logo que se guarda/ imprime. */
export const LOGO_MAX_SIZE = 400;

/**
 * Lado máximo (en píxeles) de la foto de un producto.
 * Se guarda en la misma fila del producto (data URL), así que se mantiene chica:
 * la grilla del punto de venta pinta la foto a ~120 px y la imagen viaja dentro
 * del JSON de cada producto.
 */
export const PRODUCT_IMAGE_MAX_SIZE = 320;

/** Calidad JPEG de la foto del producto (buena vista, poco peso). */
export const PRODUCT_IMAGE_QUALITY = 0.82;

/** Ancho y alto (en píxeles) de una imagen. */
export interface Size {
  width: number;
  height: number;
}

/**
 * Tamaño al que hay que reducir una imagen para que su lado mayor sea `max`,
 * conservando la proporción. Nunca amplía: una imagen pequeña se deja igual.
 *
 * `fitSize(1600, 900, 400)` -> `{ width: 400, height: 225 }`.
 */
export function fitSize(width: number, height: number, max = LOGO_MAX_SIZE): Size {
  const w = Math.max(0, Math.round(Number(width) || 0));
  const h = Math.max(0, Math.round(Number(height) || 0));
  const limit = Math.max(1, Math.round(Number(max) || 1));
  if (w === 0 || h === 0) return { width: 0, height: 0 };
  if (w <= limit && h <= limit) return { width: w, height: h };

  const scale = limit / Math.max(w, h);
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** Lee un archivo como data URL (texto base64 con su tipo MIME). */
function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });
}

/** Carga una imagen (data URL u objeto URL) y espera a que el navegador la decodifique. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('El archivo no es una imagen válida'));
    image.src = src;
  });
}

/**
 * Dibuja la imagen reducida a `max` px de lado y la exporta en el formato pedido.
 * Si no hay canvas (entorno de pruebas) devuelve el data URL original tal cual.
 */
async function toCanvasDataUrl(
  file: Blob,
  max: number,
  type: string,
  quality?: number,
): Promise<string> {
  const source = await readAsDataUrl(file);
  const image = await loadImage(source);
  const size = fitSize(image.naturalWidth || image.width, image.naturalHeight || image.height, max);

  // Sin canvas (entorno de pruebas) o sin reducción: se devuelve el original.
  if (typeof document === 'undefined' || size.width === 0) return source;

  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (!context) return source;

  // JPEG no guarda transparencia: el fondo transparente saldría negro.
  if (type === 'image/jpeg') {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, size.width, size.height);
  }
  context.drawImage(image, 0, 0, size.width, size.height);
  return canvas.toDataURL(type, quality);
}

/**
 * Convierte el archivo elegido en un data URL PNG reducido a `max` px de lado.
 *
 * Se usa PNG (y no JPEG) porque los logos suelen tener fondo transparente y en
 * JPEG ese fondo saldría negro al imprimirlo.
 */
export function toLogoDataUrl(file: Blob, max = LOGO_MAX_SIZE): Promise<string> {
  return toCanvasDataUrl(file, max, 'image/png');
}

/**
 * Convierte la foto de un producto en un data URL JPEG reducido a `max` px.
 *
 * JPEG en vez de PNG: son fotos (sin transparencia) y pesan varias veces menos,
 * y esta imagen viaja dentro del JSON del producto y de la grilla del POS.
 */
export function toProductImageDataUrl(
  file: Blob,
  max = PRODUCT_IMAGE_MAX_SIZE,
): Promise<string> {
  return toCanvasDataUrl(file, max, 'image/jpeg', PRODUCT_IMAGE_QUALITY);
}
