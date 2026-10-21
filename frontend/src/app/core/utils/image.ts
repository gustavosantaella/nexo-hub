/**
 * Utilidades de imagen para el navegador.
 *
 * El formulario reduce la imagen en el propio navegador (canvas) y la sube como
 * archivo multipart; el backend la guarda en disco (`private/img/<rif>/...`) y
 * en la fila queda una URL local `/media/...`. No se genera ni se envía base64.
 */

/** Lado máximo (en píxeles) del logo que se guarda/ imprime. */
export const LOGO_MAX_SIZE = 400;

/**
 * Lado máximo (en píxeles) de la foto de un producto.
 * La grilla del punto de venta pinta la foto a ~120 px; se mantiene chica para
 * que la subida sea rápida aunque el archivo final viva en el servidor.
 */
export const PRODUCT_IMAGE_MAX_SIZE = 320;

/** Calidad JPEG de la foto del producto (buena vista, poco peso). */
export const PRODUCT_IMAGE_QUALITY = 0.82;

/**
 * Lado máximo de la foto del comprobante de pago. Se guarda en disco y se envía
 * a Telegram, así que se mantiene legible pero liviana.
 */
export const PAYMENT_PROOF_MAX_SIZE = 1280;

/** Calidad JPEG del comprobante de pago. */
export const PAYMENT_PROOF_QUALITY = 0.72;

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

/** Carga una imagen desde un objeto URL y espera a que el navegador la decodifique. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('El archivo no es una imagen válida'));
    image.src = src;
  });
}

/** Convierte el canvas en un `Blob` (o `null` si el navegador no puede). */
function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Reduce la imagen a `max` px de lado y la devuelve como archivo listo para
 * subir. Si el navegador no puede usar canvas/objeto URL (entorno de pruebas),
 * se devuelve el archivo original.
 */
async function toUploadBlob(
  file: Blob,
  max: number,
  type: string,
  quality?: number,
): Promise<Blob> {
  if (
    typeof document === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return file;
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    const size = fitSize(
      image.naturalWidth || image.width,
      image.naturalHeight || image.height,
      max,
    );
    if (size.width === 0) return file;

    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) return file;

    // JPEG no guarda transparencia: el fondo transparente saldría negro.
    if (type === 'image/jpeg') {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, size.width, size.height);
    }
    context.drawImage(image, 0, 0, size.width, size.height);

    const blob = await canvasToBlob(canvas, type, quality);
    return blob ?? file;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Prepara el logo como PNG reducido a `max` px de lado.
 *
 * Se usa PNG (y no JPEG) porque los logos suelen tener fondo transparente y en
 * JPEG ese fondo saldría negro al imprimirlo.
 */
export function toLogoFile(file: Blob, max = LOGO_MAX_SIZE): Promise<Blob> {
  return toUploadBlob(file, max, 'image/png');
}

/**
 * Prepara la foto de un producto como JPEG reducido a `max` px.
 *
 * JPEG en vez de PNG: son fotos (sin transparencia) y pesan varias veces menos.
 */
export function toProductImageFile(
  file: Blob,
  max = PRODUCT_IMAGE_MAX_SIZE,
): Promise<Blob> {
  return toUploadBlob(file, max, 'image/jpeg', PRODUCT_IMAGE_QUALITY);
}

/**
 * Prepara la foto del comprobante de pago (transferencia / pago móvil) como
 * JPEG reducido. Debe quedar legible el número de referencia y el monto, por
 * eso usa más resolución que la foto de un producto.
 */
export function toPaymentProofFile(
  file: Blob,
  max = PAYMENT_PROOF_MAX_SIZE,
): Promise<Blob> {
  return toUploadBlob(file, max, 'image/jpeg', PAYMENT_PROOF_QUALITY);
}
