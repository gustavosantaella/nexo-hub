/**
 * Utilidades del archivo de catálogo (Configuración → Datos).
 *
 * El respaldo del negocio es un solo JSON: aquí vive lo que el navegador
 * necesita para DESCARGARLO con su nombre y para VOLVER a leerlo antes de
 * enviarlo al API. Ninguna de estas funciones conoce el formato por dentro: eso
 * es responsabilidad de `models/data-transfer.model.ts` y del backend.
 */

import {
  CATALOG_ENTITIES,
  CATALOG_FORMAT,
  CATALOG_FORMAT_VERSION,
  type CatalogCounts,
  type CatalogDocument,
  type CatalogEntity,
} from '../models/data-transfer.model';

/** Archivo que no es un respaldo del catálogo (mensaje único). */
const NOT_A_CATALOG_FILE =
  'El archivo no es un respaldo del catálogo: expórtalo desde Configuración → Datos.';

/** Nombre del archivo exportado: `nexo-hub-catalogo-2026-10-15.json`. */
export function catalogFileName(exportedAt: string | Date): string {
  const date = typeof exportedAt === 'string' ? new Date(exportedAt) : exportedAt;
  const iso = Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  return `nexo-hub-catalogo-${iso.slice(0, 10)}.json`;
}

/**
 * Suma de los conteos por entidad. Sirve tanto para los conteos del archivo
 * (cuántos registros trae) como para los de una importación (cuántos se
 * guardaron), porque los dos son un número por entidad.
 */
export function catalogSum(counts: Record<CatalogEntity, number>): number {
  return CATALOG_ENTITIES.reduce((total, entity) => total + (counts[entity] ?? 0), 0);
}

/**
 * Descarga `data` como archivo JSON con el nombre indicado.
 *
 * Se arma en el navegador con un `Blob` (no se pide al servidor que lo genere):
 * así el archivo se guarda con un solo clic y el API puede devolver el documento
 * ya estructurado, que es lo mismo que se envía de vuelta al importar.
 */
export function downloadJson(fileName: string, data: unknown): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  // Fuera de la pantalla, pero dentro del documento: algunos navegadores ignoran
  // el clic de un enlace que no está montado.
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // El `Blob` ya quedó asociado a la descarga: liberar la URL evita retenerlo en
  // memoria mientras la pestaña siga abierta.
  URL.revokeObjectURL(url);
}

/**
 * Lee un archivo elegido en el navegador y devuelve su JSON.
 *
 * El error se lanza con un mensaje que se puede mostrar tal cual: el usuario
 * eligió un archivo que no es JSON (una foto, un PDF, un archivo a medio
 * descargar), no hay nada que arreglar en el archivo.
 */
export async function readJsonFile(file: Blob): Promise<unknown> {
  const text = await file.text();
  if (!text.trim()) {
    throw new Error('El archivo está vacío.');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('El archivo no es un JSON válido: elige el respaldo del catálogo.');
  }
}

/** Lo que la pantalla muestra antes de importar: qué trae el archivo elegido. */
export interface CatalogFileOverview {
  /** Empresa de donde salió el respaldo (importarlo en otra empresa es válido). */
  companyName: string;
  /** Fecha de exportación del archivo (vacía si el archivo no la trae). */
  exportedAt: string;
  /** Registros por entidad, contados del propio archivo. */
  counts: CatalogCounts;
  /** Total de registros del archivo. */
  total: number;
}

/**
 * Saca del archivo ya leído (`readJsonFile`) lo que la pantalla necesita para
 * pedir confirmación: cuántos registros trae y de dónde salió.
 *
 * Importar escribe en el catálogo del local, así que el error se lanza ANTES de
 * enviar nada: un JSON que no es un respaldo (o de una versión más nueva, que
 * este navegador no sabe leer) se queda en el equipo del usuario.
 */
export function catalogFileOverview(data: unknown): CatalogFileOverview {
  if (!data || typeof data !== 'object') {
    throw new Error(NOT_A_CATALOG_FILE);
  }

  const document = data as Partial<CatalogDocument>;
  if (document.format !== CATALOG_FORMAT) {
    throw new Error(NOT_A_CATALOG_FILE);
  }

  const version = typeof document.version === 'number' ? document.version : 0;
  if (version > CATALOG_FORMAT_VERSION) {
    throw new Error(
      'El archivo se exportó con una versión más nueva del sistema: actualiza antes de importarlo.',
    );
  }

  // Los conteos se cuentan del propio archivo (no del resumen que trae) porque un
  // respaldo escrito a mano puede no tenerlo y las listas siempre están.
  const size = (list: unknown): number => (Array.isArray(list) ? list.length : 0);
  const counts: CatalogCounts = {
    categories: size(document.categories),
    menuCategories: size(document.menuCategories),
    suppliers: size(document.suppliers),
    products: size(document.products),
    menus: size(document.menus),
  };

  return {
    companyName: document.company?.name?.trim() || 'otra empresa',
    exportedAt: typeof document.exportedAt === 'string' ? document.exportedAt : '',
    counts,
    total: catalogSum(counts),
  };
}
