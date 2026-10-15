/**
 * Contrato del archivo de EXPORTACION / IMPORTACION del catalogo.
 *
 * Un solo archivo JSON (`nexo-hub-catalogo-AAAA-MM-DD.json`) lleva todo lo que el
 * local necesita para reconstruir su operacion basica sin depender de la base de
 * datos: categorias de productos, proveedores, productos con su stock, categorias
 * de menu y menus con su receta.
 *
 * Reglas del formato (pensadas para que el archivo sobreviva al tiempo):
 *
 *   1. `format` identifica el producto y `version` el formato. Un archivo con una
 *      version MAYOR a `CATALOG_FORMAT_VERSION` se rechaza: la version nueva
 *      siempre sabe leer la vieja, nunca al reves.
 *   2. NO viajan ids de base de datos como referencia entre entidades: viajan las
 *      CLAVES NATURALES (nombre de categoria/proveedor, SKU del producto, codigo
 *      del menu). Importar en otra empresa, tras un borrado o tras un `db:reset`
 *      funciona igual porque cada entidad se vuelve a enlazar por su nombre.
 *   3. El dinero viaja con el mismo contrato que la API: el MONTO tal como lo
 *      escribio el operador (`price`, `cost`, `priceEntered`) junto a su MONEDA
 *      (`priceCurrency`) y la tasa usada. En la base de datos el dinero vive en
 *      centavos y el codec de Prisma lo devuelve en decimales, asi que aqui solo
 *      se copian los valores ya decodificados (nunca centavos).
 *   4. La fecha (`exportedAt`) es informativa: la importacion no depende de ella.
 */

/** Identificador del producto dueño del archivo. */
export const CATALOG_FORMAT = 'nexo-hub.catalog';

/**
 * Version del formato. Se sube cuando cambia la forma del archivo (campos
 * renombrados, nueva entidad obligatoria, ...). Agregar un campo opcional NO
 * requiere subir la version: los lectores viejos simplemente lo ignoran.
 */
export const CATALOG_FORMAT_VERSION = 1;

/** Extension del archivo exportado. */
export const CATALOG_FILE_EXTENSION = 'json';

/** Categoria de producto. `parent` es el nombre de la categoria principal. */
export interface CatalogCategoryEntry {
  name: string;
  description?: string | null;
  /** Nombre de la principal; `null` (o ausente) la deja como principal. */
  parent?: string | null;
  active: boolean;
}

/** Categoria de menu (agrupa lo que se VENDE, no lo que se compra). */
export interface CatalogMenuCategoryEntry {
  name: string;
  description?: string | null;
  /** Clase de Tailwind o color hex de la tarjeta del POS. */
  color?: string | null;
  sortOrder: number;
  parent?: string | null;
  active: boolean;
}

/** Proveedor (se enlaza por nombre al importar). */
export interface CatalogSupplierEntry {
  name: string;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  /** RUC / NIT / documento fiscal. */
  taxId?: string | null;
  notes?: string | null;
  active: boolean;
}

/**
 * Producto. Los montos viajan en la MONEDA en la que se escribieron
 * (`price` + `priceCurrency`) y ademas su equivalente en la moneda base
 * (`priceUsd`), que es informativo: al importar el monto se vuelve a convertir
 * con la tasa vigente en ese momento.
 */
export interface CatalogProductEntry {
  sku: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  /** Precio de venta tal como lo escribio el operador, en `priceCurrency`. */
  price: number;
  priceCurrency: string;
  priceRateKey?: string | null;
  /** Equivalente en la moneda base (USD) que quedo guardado. Informativo. */
  priceUsd: number;
  cost: number;
  costCurrency: string;
  costRateKey?: string | null;
  costUsd: number;
  /** Costo de UNA unidad suelta de la presentacion. */
  unitCost: number;
  unitCostCurrency: string;
  unitCostRateKey?: string | null;
  /** Precio de venta de UNA unidad suelta de la presentacion. */
  unitPrice: number;
  unitPriceCurrency: string;
  unitPriceRateKey?: string | null;
  stock: number;
  minStock: number;
  unit: string;
  unitsPerBox: number;
  trackStock: boolean;
  active: boolean;
  /** Nombre de la categoria de producto; se resuelve por nombre al importar. */
  category?: string | null;
  /** Nombre del proveedor; se resuelve por nombre al importar. */
  supplier?: string | null;
}

/** Linea de la receta de un menu. El producto se enlaza por SKU. */
export interface CatalogMenuIngredientEntry {
  /** SKU del producto ingrediente (clave natural del catalogo). */
  product: string;
  /** Nombre del producto al momento de exportar (ayuda a leer el archivo). */
  productName?: string | null;
  quantity: number;
  section?: string | null;
  note?: string | null;
  sortOrder: number;
}

/** Menu (plato/combo) con su receta. El codigo es la clave natural. */
export interface CatalogMenuEntry {
  code: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  price: number;
  priceCurrency: string;
  /** Equivalente en la moneda base (USD) que quedo guardado. Informativo. */
  priceUsd: number;
  availability: string;
  preparationMinutes?: number | null;
  /** Nombre de la categoria de menu; se resuelve por nombre al importar. */
  category?: string | null;
  active: boolean;
  ingredients: CatalogMenuIngredientEntry[];
}

/** Conteo de registros por entidad (lo que el usuario ve antes de importar). */
export interface CatalogCounts {
  categories: number;
  menuCategories: number;
  suppliers: number;
  products: number;
  menus: number;
}

/** Documento completo que se descarga y que se vuelve a subir para importar. */
export interface CatalogDocument {
  format: typeof CATALOG_FORMAT;
  version: number;
  exportedAt: string;
  /** Empresa de origen (informativo: se puede importar en otra empresa). */
  company: { id: string; name: string };
  counts: CatalogCounts;
  categories: CatalogCategoryEntry[];
  menuCategories: CatalogMenuCategoryEntry[];
  suppliers: CatalogSupplierEntry[];
  products: CatalogProductEntry[];
  menus: CatalogMenuEntry[];
}

/**
 * Que hacer cuando el registro (misma clave natural) ya existe:
 *   - `merge`: se actualiza con lo que trae el archivo.
 *   - `skip`: se deja intacto y se cuenta como omitido.
 */
export const CATALOG_IMPORT_MODES = ['merge', 'skip'] as const;
export type CatalogImportMode = (typeof CATALOG_IMPORT_MODES)[number];

/** Entidades del catalogo (para el resumen de la importacion). */
export const CATALOG_ENTITIES = [
  'categories',
  'menuCategories',
  'suppliers',
  'products',
  'menus',
] as const;
export type CatalogEntity = (typeof CATALOG_ENTITIES)[number];

/** Conteo creados/actualizados/omitidos por entidad. */
export type CatalogImportCounts = Record<CatalogEntity, number>;

/**
 * Aviso de la importacion. `warning` no impide guardar el registro (por ejemplo,
 * un ingrediente que no existe deja el menu sin esa linea); `error` es un
 * registro que no se pudo guardar y quedo fuera.
 */
export interface CatalogImportIssue {
  entity: CatalogEntity;
  level: 'warning' | 'error';
  /** Clave natural del registro o de la linea que lo causo (nombre, SKU...). */
  reference: string;
  message: string;
}

/**
 * Resultado de la importacion. Es INCREMENTAL, no atomica: cada registro se
 * guarda por separado y un archivo con un error no aborta el resto (importar
 * medio catalogo es mejor que no importar nada, y los `issues` dicen que falto).
 */
export interface CatalogImportResult {
  mode: CatalogImportMode;
  created: CatalogImportCounts;
  updated: CatalogImportCounts;
  skipped: CatalogImportCounts;
  issues: CatalogImportIssue[];
}

/** Conteos en cero (punto de partida del resultado de la importacion). */
export function emptyCatalogImportCounts(): CatalogImportCounts {
  return { categories: 0, menuCategories: 0, suppliers: 0, products: 0, menus: 0 };
}

/**
 * Nombre del archivo exportado: `nexo-hub-catalogo-2026-10-15.json`. Usa la
 * fecha de exportacion en formato ISO (solo el dia) para que los respaldos se
 * ordenen solos en la carpeta de descargas.
 */
export function catalogFileName(exportedAt: string | Date): string {
  const date = typeof exportedAt === 'string' ? new Date(exportedAt) : exportedAt;
  const iso = Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString();
  return `nexo-hub-catalogo-${iso.slice(0, 10)}.${CATALOG_FILE_EXTENSION}`;
}
