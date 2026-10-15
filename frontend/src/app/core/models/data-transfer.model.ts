/**
 * Modelos del archivo de EXPORTACIÓN / IMPORTACIÓN del catálogo.
 *
 * Es el mismo contrato que escribe el API (`backend/.../catalog-format.ts`): un
 * solo JSON (`nexo-hub-catalogo-AAAA-MM-DD.json`) que lleva categorías de
 * productos, proveedores, productos con su stock, categorías de menú y menús con
 * su receta. Es el respaldo del negocio: sirve para llevarse los datos a otro
 * equipo o a otra empresa y para volver a cargarlos tras un borrado.
 *
 * No viajan ids de base de datos: cada registro lleva sus CLAVES NATURALES
 * (nombre de categoría / proveedor, SKU del producto, código del menú) para que
 * el archivo sobreviva a un cambio de empresa o a un reinicio de la base.
 */

/** Identificador del producto dueño del archivo (lo valida el API). */
export const CATALOG_FORMAT = 'nexo-hub.catalog';

/** Versión del formato que escribe esta versión del sistema. */
export const CATALOG_FORMAT_VERSION = 1;

/** Entidades del catálogo (el resumen de la importación va por entidad). */
export const CATALOG_ENTITIES = [
  'categories',
  'menuCategories',
  'suppliers',
  'products',
  'menus',
] as const;

export type CatalogEntity = (typeof CATALOG_ENTITIES)[number];

/** Nombre en español de cada entidad (tabla del resumen). */
export const CATALOG_ENTITY_LABELS: Record<CatalogEntity, string> = {
  categories: 'Categorías',
  menuCategories: 'Categorías de menú',
  suppliers: 'Proveedores',
  products: 'Productos',
  menus: 'Menús',
};

/**
 * Qué hacer con los registros que ya existen (misma clave natural):
 *   - `merge`: se actualizan con lo que trae el archivo.
 *   - `skip`: se dejan intactos y se cuentan como omitidos.
 */
export const CATALOG_IMPORT_MODES = ['merge', 'skip'] as const;
export type CatalogImportMode = (typeof CATALOG_IMPORT_MODES)[number];

/** Conteo de registros por entidad (lo que el usuario ve antes de importar). */
export interface CatalogCounts {
  categories: number;
  menuCategories: number;
  suppliers: number;
  products: number;
  menus: number;
}

/** Conteos creados / actualizados / omitidos de una importación. */
export type CatalogImportCounts = Record<CatalogEntity, number>;

/**
 * Aviso de la importación. `warning` no impide guardar el registro (por ejemplo,
 * un ingrediente que no existe deja el menú sin esa línea); `error` es un
 * registro que no se pudo guardar y quedó fuera.
 */
export interface CatalogImportIssue {
  entity: CatalogEntity;
  level: 'warning' | 'error';
  /** Clave natural del registro o de la línea que lo causó (nombre, SKU…). */
  reference: string;
  message: string;
}

/** Categoría de producto. `parent` es el nombre de la categoría principal. */
export interface CatalogCategoryEntry {
  name: string;
  description?: string | null;
  parent?: string | null;
  active: boolean;
}

/** Categoría de menú (agrupa lo que se VENDE, no lo que se compra). */
export interface CatalogMenuCategoryEntry {
  name: string;
  description?: string | null;
  /** Clase de Tailwind o color hex de la tarjeta del POS. */
  color?: string | null;
  sortOrder: number;
  parent?: string | null;
  active: boolean;
}

/** Proveedor (los productos se enlazan a él por nombre). */
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
 * Producto. Los montos viajan en la moneda en la que se escribieron
 * (`price` + `priceCurrency`) y su equivalente en la moneda base (`priceUsd`) es
 * solo informativo: al importar se vuelve a convertir con la tasa vigente.
 */
export interface CatalogProductEntry {
  sku: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  price: number;
  priceCurrency: string;
  priceRateKey?: string | null;
  priceUsd: number;
  cost?: number | null;
  costCurrency?: string | null;
  costRateKey?: string | null;
  costUsd?: number | null;
  unitCost?: number | null;
  unitCostCurrency?: string | null;
  unitCostRateKey?: string | null;
  /** Precio de venta de la unidad suelta (0 = se reparte la caja). */
  unitPrice?: number | null;
  unitPriceCurrency?: string | null;
  unitPriceRateKey?: string | null;
  stock: number;
  minStock: number;
  unit: string;
  unitsPerBox: number;
  trackStock: boolean;
  active: boolean;
  /** Nombre de la categoría de producto; se resuelve por nombre al importar. */
  category?: string | null;
  /** Nombre del proveedor; se resuelve por nombre al importar. */
  supplier?: string | null;
}

/** Línea de la receta de un menú (el ingrediente viaja por SKU). */
export interface CatalogMenuIngredientEntry {
  /** SKU del producto; si no se encuentra, se intenta por `productName`. */
  product: string;
  /** Nombre del producto (tolerancia para catálogos escritos a mano). */
  productName?: string | null;
  quantity: number;
  /** Sección de la receta (`Principal`, `Salsa`…). */
  section?: string | null;
  note?: string | null;
  sortOrder: number;
}

/** Menú vendible, con su receta completa. */
export interface CatalogMenuEntry {
  code: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  price: number;
  priceCurrency: string;
  priceUsd: number;
  /** Disponibilidad en la carta (`ALL`, `DINE_IN`, ...). */
  availability: string;
  preparationMinutes?: number | null;
  /** Nombre de la categoría de menú; se resuelve por nombre al importar. */
  category?: string | null;
  active: boolean;
  ingredients: CatalogMenuIngredientEntry[];
}

/** Documento completo que se descarga y que se vuelve a subir para importar. */
export interface CatalogDocument {
  format: string;
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
 * Resultado de la importación. Es INCREMENTAL, no atómica: cada registro se
 * guarda por separado y un archivo con un error no aborta el resto (importar
 * medio catálogo es mejor que no importar nada, y los `issues` dicen qué faltó).
 */
export interface CatalogImportResult {
  mode: CatalogImportMode;
  created: CatalogImportCounts;
  updated: CatalogImportCounts;
  skipped: CatalogImportCounts;
  issues: CatalogImportIssue[];
}

