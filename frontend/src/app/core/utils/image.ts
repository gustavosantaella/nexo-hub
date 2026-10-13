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
 * Convierte el archivo elegido en un data URL PNG reducido a `max` px de lado.
 *
 * Se usa PNG (y no JPEG) porque los logos suelen tener fondo transparente y en
 * JPEG ese fondo saldría negro al imprimirlo.
 */
export async function toLogoDataUrl(
  file: Blob,
  max = LOGO_MAX_SIZE,
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

  context.drawImage(image, 0, 0, size.width, size.height);
  return canvas.toDataURL('image/png');
}
