/**
 * Utilidades de almacenamiento local de imagenes.
 *
 * Las fotos NO viven en la base de datos: el navegador las envia como archivo
 * multipart (ya reducido) y el backend las escribe en disco. La ruta publica
 * que se guarda en la fila es `/media/<empresa>/<carpeta>/<archivo>`, servida
 * desde `private/img` por `main.ts`.
 *
 * Este modulo es puro (no usa Nest ni Prisma) para reutilizarlo desde el script
 * de migracion de imagenes existentes (`tools/import-images.ts`).
 */
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { isDataImageUrl } from './image-url.util';

export { isDataImageUrl } from './image-url.util';

/** Prefijo HTTP con el que se publican las imagenes locales. */
export const MEDIA_URL_PREFIX = '/media';

/** Carpetas permitidas: evita rutas arbitrarias desde un formulario. */
export const IMAGE_FOLDERS = [
  'products',
  'menu',
  'logo',
  'payments',
  'avatars',
] as const;

export type ImageFolder = (typeof IMAGE_FOLDERS)[number];

/** Tamano maximo de una imagen ya decodificada (8 MB). */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const MIME_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const EXTENSION_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const DATA_URL_PATTERN =
  /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/;

export interface ParsedImage {
  bytes: Buffer;
  mime: string;
  extension: string;
}

export interface StoredImage {
  /** URL relativa que se guarda en la base: `/media/...`. */
  url: string;
  /** Ruta absoluta del archivo en el servidor. */
  absolutePath: string;
  /** Tamano escrito en bytes. */
  bytes: number;
}

/** Error de una imagen invalida (el servicio lo traduce a HTTP 400). */
export class InvalidImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidImageError';
  }
}

/** Detecta el tipo real por la firma del archivo, no por el MIME declarado. */
function sniffImageMime(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * Valida el contenido real de una imagen JPEG/PNG/WebP.
 * Devuelve `null` si el formato o el tamano no son aceptables.
 */
export function parseImageBuffer(bytes: Buffer): ParsedImage | null {
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null;

  const mime = sniffImageMime(bytes);
  if (!mime) return null;

  return { bytes, mime, extension: MIME_EXTENSION[mime] };
}

/**
 * Decodifica y valida un data URL JPEG/PNG/WebP.
 *
 * Solo lo usa la migracion de filas historicas; el API ya no acepta data URLs.
 * Devuelve `null` si el formato, la firma o el tamano no son aceptables.
 */
export function parseImageDataUrl(value: string): ParsedImage | null {
  const match = DATA_URL_PATTERN.exec(value.trim());
  if (!match) return null;

  const mime = match[1];
  const parsed = parseImageBuffer(
    Buffer.from(match[2].replace(/\s+/g, ''), 'base64'),
  );
  if (!parsed || parsed.mime !== mime) return null;
  return parsed;
}

/** Tipo MIME de un archivo local por su extension. */
export function mimeFromExtension(filePath: string): string {
  const extension = path.extname(filePath).replace('.', '').toLowerCase();
  return EXTENSION_MIME[extension] ?? 'application/octet-stream';
}

/**
 * Convierte un texto en un segmento de ruta seguro.
 *
 * El RIF se usa como carpeta padre "sin espacios"; el resto de caracteres que
 * no sean seguros para una URL se reemplaza por `-` (nunca se acepta `..`).
 */
export function sanitizePathSegment(value: string, fallback = 'empresa'): string {
  const clean = String(value ?? '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return clean || fallback;
}

/** Carpeta raiz por defecto de las imagenes locales. */
export function defaultMediaRoot(): string {
  return path.join(process.cwd(), 'private', 'img');
}

/**
 * Guarda una imagen en disco en `root/<scope...>/<folder>/<archivo>`.
 * Crea las carpetas necesarias y devuelve la URL publica relativa.
 */
async function writeStoredImage(
  root: string,
  scopeSegments: string[],
  folder: ImageFolder,
  parsed: ParsedImage,
): Promise<StoredImage> {
  if (!(IMAGE_FOLDERS as readonly string[]).includes(folder)) {
    throw new InvalidImageError('La carpeta de la imagen no es valida');
  }

  const scope = scopeSegments
    .map((segment) => sanitizePathSegment(segment))
    .filter(Boolean);
  if (scope.length === 0) {
    throw new InvalidImageError('No se pudo determinar la carpeta de la imagen');
  }

  const directory = path.join(root, ...scope, folder);
  await mkdir(directory, { recursive: true });

  const filename = `${Date.now()}-${randomUUID().slice(0, 8)}.${parsed.extension}`;
  const absolutePath = path.join(directory, filename);
  // `wx` evita sobreescribir un archivo si dos peticiones generan el mismo
  // nombre (practicamente imposible por el UUID, pero no cuesta nada).
  await writeFile(absolutePath, parsed.bytes, { flag: 'wx' });

  return {
    url: `${MEDIA_URL_PREFIX}/${[...scope, folder, filename].join('/')}`,
    absolutePath,
    bytes: parsed.bytes.length,
  };
}

/**
 * Guarda el contenido de una imagen subida por multipart.
 * La firma real del archivo decide el tipo y la extension.
 */
export async function saveImageBuffer(
  root: string,
  scopeSegments: string[],
  folder: ImageFolder,
  bytes: Buffer,
): Promise<StoredImage> {
  const parsed = parseImageBuffer(bytes);
  if (!parsed) {
    throw new InvalidImageError(
      'La imagen no es valida: usa una foto JPEG, PNG o WebP menor a 8 MB',
    );
  }

  return writeStoredImage(root, scopeSegments, folder, parsed);
}

/**
 * Guarda un data URL historico en disco. Solo lo usa la migracion.
 */
export async function saveImageFile(
  root: string,
  scopeSegments: string[],
  folder: ImageFolder,
  dataUrl: string,
): Promise<StoredImage> {
  const parsed = parseImageDataUrl(dataUrl);
  if (!parsed) {
    throw new InvalidImageError(
      'La imagen no es valida: usa una foto JPEG, PNG o WebP menor a 8 MB',
    );
  }

  return writeStoredImage(root, scopeSegments, folder, parsed);
}

/**
 * Traduce una URL `/media/...` (o una URL absoluta que la contenga) a la ruta
 * fisica dentro de `root`. Devuelve `null` si no pertenece al almacen local.
 */
export function mediaFilePath(root: string, value: string): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  let pathname: string;
  if (raw.startsWith(`${MEDIA_URL_PREFIX}/`)) {
    pathname = raw;
  } else if (/^https?:\/\//i.test(raw)) {
    try {
      pathname = new URL(raw).pathname;
    } catch {
      return null;
    }
  } else {
    return null;
  }

  if (!pathname.startsWith(`${MEDIA_URL_PREFIX}/`)) return null;

  let relative: string;
  try {
    relative = decodeURIComponent(pathname.slice(MEDIA_URL_PREFIX.length + 1));
  } catch {
    return null;
  }
  if (!relative || relative.includes('\0')) return null;

  const resolvedRoot = path.resolve(root);
  const absolute = path.resolve(resolvedRoot, relative);
  if (absolute !== resolvedRoot && !absolute.startsWith(resolvedRoot + path.sep)) {
    return null;
  }
  return absolute;
}
