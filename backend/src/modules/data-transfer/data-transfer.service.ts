import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PRODUCT_UNITS, type ProductUnit } from '../../common/constants/enums';
import { compareQty, toQty } from '../../common/utils/quantity.util';
import { tenantWhere } from '../../common/utils/tenant.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CategoriesService } from '../categories/categories.service';
import { CreateCategoryDto } from '../categories/dto/create-category.dto';
import { UpdateCategoryDto } from '../categories/dto/update-category.dto';
import { InventoryService } from '../inventory/inventory.service';
import { CreateMenuCategoryDto } from '../menus/dto/menu-category.dto';
import { UpdateMenuCategoryDto } from '../menus/dto/update-menu-category.dto';
import {
  CreateMenuDto,
  MENU_AVAILABILITIES,
  MENU_SECTIONS,
  MenuIngredientDto,
  type MenuAvailability,
  type MenuSection,
} from '../menus/dto/menu.dto';
import { UpdateMenuDto } from '../menus/dto/update-menu.dto';
import { MenuCategoriesService } from '../menus/menu-categories.service';
import { MenusService } from '../menus/menus.service';
import { CreateProductDto } from '../products/dto/create-product.dto';
import { UpdateProductDto } from '../products/dto/update-product.dto';
import { ProductsService } from '../products/products.service';
import { normalizeRateKey } from '../rates/rates.service';
import { CreateSupplierDto } from '../suppliers/dto/create-supplier.dto';
import { UpdateSupplierDto } from '../suppliers/dto/update-supplier.dto';
import { SuppliersService } from '../suppliers/suppliers.service';
import {
  CATALOG_FORMAT,
  CATALOG_FORMAT_VERSION,
  emptyCatalogImportCounts,
  type CatalogCategoryEntry,
  type CatalogDocument,
  type CatalogEntity,
  type CatalogImportIssue,
  type CatalogImportMode,
  type CatalogImportResult,
  type CatalogMenuCategoryEntry,
  type CatalogMenuEntry,
  type CatalogProductEntry,
  type CatalogSupplierEntry,
} from './catalog-format';

/** Opciones con las que se dispara una importacion. */
export interface CatalogImportOptions {
  mode?: CatalogImportMode;
  /** Usuario que sube el archivo: firma los movimientos de inventario. */
  userId?: string;
}

/** Fila que la base devuelve con la forma minima para exportar. */
type Row = Record<string, unknown>;

/** `true` para un objeto JSON (no `null`, no un arreglo). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Arreglo del archivo, o `[]` si la clave falta o no es un arreglo. */
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Texto recortado; cadena vacia cuando el valor no es un string usable. */
function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Texto recortado, o `undefined` para no tocar el campo al actualizar. */
function optionalText(value: unknown): string | undefined {
  const clean = text(value);
  return clean.length > 0 ? clean : undefined;
}

/**
 * Campo de texto OPCIONAL del archivo. Distingue "la clave no viene" de "viene
 * vacia": ausente devuelve `undefined` (no se toca lo que ya estaba, asi un
 * archivo parcial no borra datos) y presente-vacia devuelve `''` (el `null` del
 * export significa "limpiar el campo").
 */
function optionalFieldText(
  entry: Record<string, unknown>,
  field: string,
): string | undefined {
  if (!(field in entry)) return undefined;
  return text(entry[field]);
}

/** Clave de tasa del archivo, o `undefined` si no es una de las soportadas. */
function rateKeyOf(value: unknown): string | undefined {
  return normalizeRateKey(optionalText(value)) ?? undefined;
}

/** Unidad del producto de `PRODUCT_UNITS` (`undefined` = se conserva la actual). */
function unitOf(value: unknown): ProductUnit | undefined {
  const unit = optionalText(value);
  return unit && (PRODUCT_UNITS as readonly string[]).includes(unit)
    ? (unit as ProductUnit)
    : undefined;
}

/** Unidades de la presentacion: entero >= 1, o `undefined` para no tocarlo. */
function unitsPerBoxOf(value: unknown): number | undefined {
  const units = optionalNumber(value);
  if (units === undefined) return undefined;
  const rounded = Math.round(units);
  return rounded >= 1 ? rounded : undefined;
}

/** Disponibilidad del menu de `MENU_AVAILABILITIES` (`undefined` = no tocarla). */
function availabilityOf(value: unknown): MenuAvailability | undefined {
  const availability = optionalText(value);
  return availability &&
    (MENU_AVAILABILITIES as readonly string[]).includes(availability)
    ? (availability as MenuAvailability)
    : undefined;
}

/** Seccion de una linea de receta de `MENU_SECTIONS` (`undefined` = otra). */
function sectionOf(value: unknown): MenuSection | undefined {
  const section = optionalText(value);
  return section && (MENU_SECTIONS as readonly string[]).includes(section)
    ? (section as MenuSection)
    : undefined;
}

/** Numero finito del archivo, o `undefined` (para conservar el valor actual). */
function optionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** Booleano del archivo, o `undefined` para conservar el valor actual. */
function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/** Clave natural normalizada (los nombres se comparan sin mayusculas). */
function keyOf(value: unknown): string {
  return text(value).toLowerCase();
}

/**
 * Parte las filas en DOS grupos conservando el orden recibido: primero las
 * principales y despues las subcategorias. Al importar, la subcategoria necesita
 * que su principal ya exista.
 */
function parentsFirst<T extends { parentId: string | null }>(rows: T[]): T[] {
  return [
    ...rows.filter((row) => !row.parentId),
    ...rows.filter((row) => row.parentId),
  ];
}

/** Datos de cada producto que viajan en el archivo (sin ids). */
const PRODUCT_EXPORT_SELECT = {
  sku: true,
  name: true,
  description: true,
  imageUrl: true,
  price: true,
  priceCurrency: true,
  priceRateKey: true,
  priceEntered: true,
  cost: true,
  costCurrency: true,
  costRateKey: true,
  costEntered: true,
  unitCost: true,
  unitCostCurrency: true,
  unitCostRateKey: true,
  unitCostEntered: true,
  unitPrice: true,
  unitPriceCurrency: true,
  unitPriceRateKey: true,
  unitPriceEntered: true,
  stock: true,
  minStock: true,
  unit: true,
  unitsPerBox: true,
  trackStock: true,
  active: true,
  // La categoria y el proveedor viajan por NOMBRE (clave natural del archivo).
  category: { select: { name: true } },
  supplier: { select: { name: true } },
} satisfies Prisma.ProductSelect;

/** Datos de cada menu con su receta (el ingrediente viaja por SKU). */
const MENU_EXPORT_SELECT = {
  code: true,
  name: true,
  description: true,
  imageUrl: true,
  price: true,
  priceCurrency: true,
  priceEntered: true,
  availability: true,
  preparationMinutes: true,
  active: true,
  category: { select: { name: true } },
  ingredients: {
    orderBy: { sortOrder: 'asc' },
    select: {
      quantity: true,
      section: true,
      note: true,
      sortOrder: true,
      product: { select: { sku: true, name: true } },
    },
  },
} satisfies Prisma.MenuSelect;

/** Producto ya existente, indexado por sus claves naturales al importar. */
interface ProductRef {
  id: string;
  name: string;
  sku: string;
  stock: number;
  active: boolean;
}

/** Indice de productos: por SKU (clave del archivo) y por nombre (tolerancia). */
interface ProductIndex {
  bySku: Map<string, ProductRef>;
  byName: Map<string, ProductRef>;
}

/** Indice de menus: por codigo (clave del archivo) y por nombre (tolerancia). */
interface MenuIndex {
  byCode: Map<string, string>;
  byName: Map<string, string>;
}

/** Estado de una importacion en curso (lo que se va guardando y contando). */
interface ImportContext {
  companyId: string;
  mode: CatalogImportMode;
  userId?: string;
  result: CatalogImportResult;
  categories: Map<string, string>;
  menuCategories: Map<string, string>;
  suppliers: Map<string, string>;
  products: ProductIndex;
  menus: MenuIndex;
}

/** Archivo ya reconocido como catalogo: solo quedan sus listas por recorrer. */
interface CatalogFile {
  version: number;
  categories: unknown[];
  menuCategories: unknown[];
  suppliers: unknown[];
  products: unknown[];
  menus: unknown[];
}

/** Mensaje legible de un error cualquiera (los del dominio ya vienen escritos). */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Reconoce el archivo subido y devuelve sus listas. Rechaza lo que no es un
 * catalogo de Nexo Hub y los archivos de una version MAS NUEVA que esta
 * aplicacion (la version nueva lee la vieja, nunca al reves).
 */
function assertCatalogDocument(payload: unknown): CatalogFile {
  if (!isPlainObject(payload)) {
    throw new BadRequestException(
      'El archivo no es un catalogo de Nexo Hub (se esperaba un objeto JSON).',
    );
  }
  if (payload.format !== CATALOG_FORMAT) {
    throw new BadRequestException(
      `El archivo no es un catalogo de Nexo Hub (se esperaba "${CATALOG_FORMAT}").`,
    );
  }
  const version = optionalNumber(payload.version) ?? CATALOG_FORMAT_VERSION;
  if (version > CATALOG_FORMAT_VERSION) {
    throw new BadRequestException(
      `El archivo usa una version mas nueva del formato (v${version}) que esta aplicacion (v${CATALOG_FORMAT_VERSION}). Actualiza el sistema para poder importarlo.`,
    );
  }

  return {
    version,
    categories: asArray(payload.categories),
    menuCategories: asArray(payload.menuCategories),
    suppliers: asArray(payload.suppliers),
    products: asArray(payload.products),
    menus: asArray(payload.menus),
  };
}

/**
 * Exportacion / importacion del catalogo en un archivo JSON.
 *
 * La importacion NO escribe en Prisma a mano: reusa los servicios de cada
 * dominio, de modo que cada registro pasa por las MISMAS reglas que si se
 * cargara desde la interfaz (validacion de moneda y tasa, movimiento de
 * inventario trazable, receta del menu, jerarquia de categorias, ...).
 */
@Injectable()
export class DataTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
    private readonly menuCategories: MenuCategoriesService,
    private readonly suppliers: SuppliersService,
    private readonly products: ProductsService,
    private readonly menus: MenusService,
    private readonly inventory: InventoryService,
  ) {}

  // =========================================================================
  //  EXPORTACION
  // =========================================================================

  /**
   * Arma el documento exportable de la empresa: categorias de productos,
   * categorias de menu, proveedores, productos (con su stock) y menus (con su
   * receta).
   *
   * No viaja ningun id de la base como referencia entre entidades: cada registro
   * lleva su CLAVE NATURAL (nombre de categoria/proveedor, SKU del producto,
   * codigo del menu) y el nombre de lo que referencia. Asi el archivo se puede
   * importar en otra empresa, despues de un borrado o tras un `db:reset`.
   *
   * El dinero se copia tal como lo entrega el codec de Prisma (decimales) junto
   * a la moneda y la tasa elegidas: al importar, el monto se vuelve a convertir
   * con la tasa vigente (los `*Usd` viajan solo como referencia).
   */
  async exportCatalog(companyId: string): Promise<CatalogDocument> {
    const [company, categories, menuCategories, suppliers, products, menus] =
      await this.prisma.$transaction([
        this.prisma.company.findUnique({
          where: { id: companyId },
          select: { id: true, name: true },
        }),
        this.prisma.category.findMany({
          where: tenantWhere(companyId),
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            description: true,
            parentId: true,
            active: true,
          },
        }),
        this.prisma.menuCategory.findMany({
          where: tenantWhere(companyId),
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: {
            id: true,
            name: true,
            description: true,
            color: true,
            sortOrder: true,
            parentId: true,
            active: true,
          },
        }),
        this.prisma.supplier.findMany({
          where: tenantWhere(companyId),
          orderBy: { name: 'asc' },
          select: {
            name: true,
            contactName: true,
            phone: true,
            email: true,
            address: true,
            taxId: true,
            notes: true,
            active: true,
          },
        }),
        this.prisma.product.findMany({
          where: tenantWhere(companyId),
          orderBy: { name: 'asc' },
          select: PRODUCT_EXPORT_SELECT,
        }),
        this.prisma.menu.findMany({
          where: tenantWhere(companyId),
          orderBy: { name: 'asc' },
          select: MENU_EXPORT_SELECT,
        }),
      ]);

    if (!company) throw new NotFoundException('Empresa no encontrada');

    // Los ids de las categorias se traducen a NOMBRES: son la unica referencia
    // que sobrevive a un cambio de empresa o de base de datos.
    const categoryNames = new Map(
      categories.map((category) => [category.id, category.name]),
    );
    const menuCategoryNames = new Map(
      menuCategories.map((category) => [category.id, category.name]),
    );

    const categoryEntries: CatalogCategoryEntry[] = parentsFirst(categories).map(
      (category) => ({
        name: category.name,
        description: category.description,
        parent: category.parentId
          ? categoryNames.get(category.parentId) ?? null
          : null,
        active: category.active,
      }),
    );

    const menuCategoryEntries: CatalogMenuCategoryEntry[] = parentsFirst(
      menuCategories,
    ).map((category) => ({
      name: category.name,
      description: category.description,
      color: category.color,
      sortOrder: category.sortOrder,
      parent: category.parentId
        ? menuCategoryNames.get(category.parentId) ?? null
        : null,
      active: category.active,
    }));

    const supplierEntries: CatalogSupplierEntry[] = suppliers.map(
      (supplier) => ({
        name: supplier.name,
        contactName: supplier.contactName,
        phone: supplier.phone,
        email: supplier.email,
        address: supplier.address,
        taxId: supplier.taxId,
        notes: supplier.notes,
        active: supplier.active,
      }),
    );

    const productEntries: CatalogProductEntry[] = products.map((product) => ({
      sku: product.sku,
      name: product.name,
      description: product.description,
      imageUrl: product.imageUrl,
      // El monto viaja como lo escribio el operador: `priceEntered` es el valor
      // en `priceCurrency` y `price` su equivalente en la moneda base (USD).
      price: product.priceEntered ?? product.price,
      priceCurrency: product.priceCurrency,
      priceRateKey: product.priceRateKey,
      priceUsd: product.price,
      cost: product.costEntered ?? product.cost,
      costCurrency: product.costCurrency,
      costRateKey: product.costRateKey,
      costUsd: product.cost,
      unitCost: product.unitCostEntered ?? product.unitCost,
      unitCostCurrency: product.unitCostCurrency,
      unitCostRateKey: product.unitCostRateKey,
      unitPrice: product.unitPriceEntered ?? product.unitPrice,
      unitPriceCurrency: product.unitPriceCurrency,
      unitPriceRateKey: product.unitPriceRateKey,
      stock: product.stock,
      minStock: product.minStock,
      unit: product.unit,
      unitsPerBox: product.unitsPerBox,
      trackStock: product.trackStock,
      active: product.active,
      category: product.category?.name ?? null,
      supplier: product.supplier?.name ?? null,
    }));

    const menuEntries: CatalogMenuEntry[] = menus.map((menu) => ({
      code: menu.code,
      name: menu.name,
      description: menu.description,
      imageUrl: menu.imageUrl,
      price: menu.priceEntered ?? menu.price,
      priceCurrency: menu.priceCurrency,
      priceUsd: menu.price,
      availability: menu.availability,
      preparationMinutes: menu.preparationMinutes,
      category: menu.category?.name ?? null,
      active: menu.active,
      ingredients: menu.ingredients.map((line) => ({
        // El ingrediente viaja por SKU: unica clave estable entre empresas.
        product: line.product.sku,
        productName: line.product.name,
        quantity: line.quantity,
        section: line.section,
        note: line.note,
        sortOrder: line.sortOrder,
      })),
    }));

    return {
      format: CATALOG_FORMAT,
      version: CATALOG_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      company,
      counts: {
        categories: categoryEntries.length,
        menuCategories: menuCategoryEntries.length,
        suppliers: supplierEntries.length,
        products: productEntries.length,
        menus: menuEntries.length,
      },
      categories: categoryEntries,
      menuCategories: menuCategoryEntries,
      suppliers: supplierEntries,
      products: productEntries,
      menus: menuEntries,
    };
  }

  // =========================================================================
  //  IMPORTACION
  // =========================================================================

  /**
   * Importa un catalogo exportado (o escrito a mano) en la empresa activa.
   *
   * Es INCREMENTAL, no atomica: cada registro se guarda por separado y los
   * problemas se acumulan en `issues` (un producto con el precio roto no impide
   * importar los otros 200). El resultado dice cuantos registros se crearon, se
   * actualizaron y se omitieron por entidad.
   *
   * Orden de dependencias: categorias -> categorias de menu -> proveedores ->
   * productos -> menus (la receta necesita los SKU ya resueltos). La clave natural
   * es el NOMBRE para categorias y proveedores, el SKU para productos y el codigo
   * para menus; un producto tambien se reconoce por nombre (asi el mismo catalogo
   * cargado en otra empresa actualiza los platos que ya existen en vez de
   * duplicarlos) y un menu tambien por nombre.
   */
  async importCatalog(
    companyId: string,
    payload: unknown,
    options: CatalogImportOptions = {},
  ): Promise<CatalogImportResult> {
    const document = assertCatalogDocument(payload);
    const mode: CatalogImportMode = options.mode ?? 'merge';

    const ctx: ImportContext = {
      companyId,
      mode,
      userId: options.userId,
      result: {
        mode,
        created: emptyCatalogImportCounts(),
        updated: emptyCatalogImportCounts(),
        skipped: emptyCatalogImportCounts(),
        issues: [],
      },
      // Los indices se llenan con lo que YA existe y se amplian al crear: una
      // subcategoria encuentra a su principal aunque se acabe de crear ahora.
      categories: await this.categoryIndex(companyId),
      menuCategories: await this.menuCategoryIndex(companyId),
      suppliers: await this.supplierIndex(companyId),
      products: await this.productIndex(companyId),
      menus: await this.menuIndex(companyId),
    };

    await this.importCategories(ctx, document.categories);
    await this.importMenuCategories(ctx, document.menuCategories);
    await this.importSuppliers(ctx, document.suppliers);
    await this.importProducts(ctx, document.products);
    await this.importMenus(ctx, document.menus);

    return ctx.result;
  }

  /** Aviso de la importacion: no interrumpe el resto del archivo. */
  private report(
    ctx: ImportContext,
    entity: CatalogEntity,
    level: 'warning' | 'error',
    reference: string,
    message: string,
  ): void {
    ctx.result.issues.push({ entity, level, reference, message });
  }

  /** Suma un registro al conteo de la entidad segun lo que paso con el. */
  private count(
    ctx: ImportContext,
    entity: CatalogEntity,
    outcome: 'created' | 'updated' | 'skipped',
  ): void {
    ctx.result[outcome][entity] += 1;
  }

  /**
   * `true` cuando el registro ya existe y hay que dejar `merge` de lado: en modo
   * `skip` no se toca nada de lo que ya estaba (ni el stock).
   */
  private shouldSkip(ctx: ImportContext, exists: boolean): boolean {
    if (!exists) return false;
    if (ctx.mode === 'skip') {
      return true;
    }
    return false;
  }

  private async categoryIndex(companyId: string): Promise<Map<string, string>> {
    const rows = await this.prisma.category.findMany({
      where: tenantWhere(companyId),
      select: { id: true, name: true },
    });
    return new Map(rows.map((row) => [keyOf(row.name), row.id]));
  }

  private async menuCategoryIndex(
    companyId: string,
  ): Promise<Map<string, string>> {
    const rows = await this.prisma.menuCategory.findMany({
      where: tenantWhere(companyId),
      select: { id: true, name: true },
    });
    return new Map(rows.map((row) => [keyOf(row.name), row.id]));
  }

  private async supplierIndex(companyId: string): Promise<Map<string, string>> {
    const rows = await this.prisma.supplier.findMany({
      where: tenantWhere(companyId),
      select: { id: true, name: true },
    });
    return new Map(rows.map((row) => [keyOf(row.name), row.id]));
  }

  private async productIndex(companyId: string): Promise<ProductIndex> {
    const rows = await this.prisma.product.findMany({
      where: tenantWhere(companyId),
      select: { id: true, name: true, sku: true, stock: true, active: true },
    });
    const bySku = new Map<string, ProductRef>();
    const byName = new Map<string, ProductRef>();
    for (const row of rows) {
      const ref: ProductRef = {
        id: row.id,
        name: row.name,
        sku: row.sku,
        stock: toQty(row.stock),
        active: row.active,
      };
      const sku = keyOf(row.sku);
      if (sku && !bySku.has(sku)) bySku.set(sku, ref);
      const name = keyOf(row.name);
      if (name && !byName.has(name)) byName.set(name, ref);
    }
    return { bySku, byName };
  }

  private async menuIndex(companyId: string): Promise<MenuIndex> {
    const rows = await this.prisma.menu.findMany({
      where: tenantWhere(companyId),
      select: { id: true, name: true, code: true },
    });
    const byCode = new Map<string, string>();
    const byName = new Map<string, string>();
    for (const row of rows) {
      const code = keyOf(row.code);
      if (code && !byCode.has(code)) byCode.set(code, row.id);
      const name = keyOf(row.name);
      if (name && !byName.has(name)) byName.set(name, row.id);
    }
    return { byCode, byName };
  }

  /** Entradas del archivo que SI son objetos; la basura se reporta y se saltea. */
  private objects(
    ctx: ImportContext,
    entity: CatalogEntity,
    rows: unknown[],
  ): Record<string, unknown>[] {
    const objects: Record<string, unknown>[] = [];
    rows.forEach((row, index) => {
      if (isPlainObject(row)) {
        objects.push(row);
        return;
      }
      this.report(
        ctx,
        entity,
        'error',
        `#${index + 1}`,
        'La entrada no es un objeto JSON valido: se omite.',
      );
    });
    return objects;
  }

  /**
   * Categorias de PRODUCTOS. Primero las principales y despues las
   * subcategorias, asi el nombre del padre siempre se puede resolver (el archivo
   * viaja ya en ese orden).
   */
  private async importCategories(
    ctx: ImportContext,
    rows: unknown[],
  ): Promise<void> {
    for (const entry of this.objects(ctx, 'categories', rows)) {
      const name = text(entry.name);
      if (!name) {
        this.report(
          ctx,
          'categories',
          'error',
          `#${rows.indexOf(entry) + 1}`,
          'La categoria no tiene nombre: se omite.',
        );
        continue;
      }

      const parentName = text(entry.parent);
      let parentId: string | null = null;
      if (parentName) {
        parentId = ctx.categories.get(keyOf(parentName)) ?? null;
        if (!parentId) {
          this.report(
            ctx,
            'categories',
            'warning',
            name,
            `No se encontro la categoria principal "${parentName}": queda como principal.`,
          );
        }
      }

      const existingId = ctx.categories.get(keyOf(name));
      if (existingId && this.shouldSkip(ctx, true)) {
        this.count(ctx, 'categories', 'skipped');
        continue;
      }

      const payload: CreateCategoryDto = {
        name,
        description: text(entry.description),
        parentId,
        active: optionalBoolean(entry.active) ?? true,
      };

      try {
        if (existingId) {
          await this.categories.update(ctx.companyId, existingId, payload);
          this.count(ctx, 'categories', 'updated');
        } else {
          const created = await this.categories.create(ctx.companyId, payload);
          ctx.categories.set(keyOf(created.name), created.id);
          this.count(ctx, 'categories', 'created');
        }
      } catch (error) {
        this.report(ctx, 'categories', 'error', name, messageOf(error));
      }
    }
  }

  /** Categorias de MENU: mismo esquema, con color y orden de la carta. */
  private async importMenuCategories(
    ctx: ImportContext,
    rows: unknown[],
  ): Promise<void> {
    for (const entry of this.objects(ctx, 'menuCategories', rows)) {
      const name = text(entry.name);
      if (!name) {
        this.report(
          ctx,
          'menuCategories',
          'error',
          `#${rows.indexOf(entry) + 1}`,
          'La categoria de menu no tiene nombre: se omite.',
        );
        continue;
      }

      const parentName = text(entry.parent);
      let parentId: string | null = null;
      if (parentName) {
        parentId = ctx.menuCategories.get(keyOf(parentName)) ?? null;
        if (!parentId) {
          this.report(
            ctx,
            'menuCategories',
            'warning',
            name,
            `No se encontro la categoria de menu principal "${parentName}": queda como principal.`,
          );
        }
      }

      const existingId = ctx.menuCategories.get(keyOf(name));
      if (existingId && this.shouldSkip(ctx, true)) {
        this.count(ctx, 'menuCategories', 'skipped');
        continue;
      }

      const sortOrder = optionalNumber(entry.sortOrder);
      const payload: CreateMenuCategoryDto = {
        name,
        description: text(entry.description),
        color: text(entry.color),
        active: optionalBoolean(entry.active) ?? true,
        parentId,
      };
      if (sortOrder !== undefined) {
        payload.sortOrder = Math.max(0, Math.round(sortOrder));
      }

      try {
        if (existingId) {
          await this.menuCategories.update(ctx.companyId, existingId, payload);
          this.count(ctx, 'menuCategories', 'updated');
        } else {
          const created = await this.menuCategories.create(ctx.companyId, payload);
          ctx.menuCategories.set(keyOf(created.name), created.id);
          this.count(ctx, 'menuCategories', 'created');
        }
      } catch (error) {
        this.report(ctx, 'menuCategories', 'error', name, messageOf(error));
      }
    }
  }

  /** Proveedores: los productos se enlazan a ellos por NOMBRE. */
  private async importSuppliers(
    ctx: ImportContext,
    rows: unknown[],
  ): Promise<void> {
    for (const entry of this.objects(ctx, 'suppliers', rows)) {
      const name = text(entry.name);
      if (!name) {
        this.report(
          ctx,
          'suppliers',
          'error',
          `#${rows.indexOf(entry) + 1}`,
          'El proveedor no tiene nombre: se omite.',
        );
        continue;
      }

      const existingId = ctx.suppliers.get(keyOf(name));
      if (existingId && this.shouldSkip(ctx, true)) {
        this.count(ctx, 'suppliers', 'skipped');
        continue;
      }

      const payload: CreateSupplierDto = {
        name,
        contactName: text(entry.contactName),
        phone: text(entry.phone),
        email: text(entry.email),
        address: text(entry.address),
        taxId: text(entry.taxId),
        notes: text(entry.notes),
        active: optionalBoolean(entry.active) ?? true,
      };

      try {
        if (existingId) {
          await this.suppliers.update(ctx.companyId, existingId, payload);
          this.count(ctx, 'suppliers', 'updated');
        } else {
          const created = await this.suppliers.create(ctx.companyId, payload);
          ctx.suppliers.set(keyOf(created.name), created.id);
          this.count(ctx, 'suppliers', 'created');
        }
      } catch (error) {
        this.report(ctx, 'suppliers', 'error', name, messageOf(error));
      }
    }
  }

  /**
   * Productos: se reconocen por SKU y, si ese SKU no existe en la empresa, por
   * NOMBRE (importar el catalogo de otra sucursal ACTUALIZA los que ya estan en
   * vez de duplicarlos).
   *
   * El stock no se escribe en la fila del producto: entra por el motor de
   * inventario (`applyMovement` al crear, `adjustStock` al actualizar), asi el
   * archivo deja la MISMA trazabilidad que una carga hecha a mano.
   */
  private async importProducts(
    ctx: ImportContext,
    rows: unknown[],
  ): Promise<void> {
    for (const entry of this.objects(ctx, 'products', rows)) {
      const name = text(entry.name);
      if (!name) {
        this.report(
          ctx,
          'products',
          'error',
          `#${rows.indexOf(entry) + 1}`,
          'El producto no tiene nombre: se omite.',
        );
        continue;
      }

      const fields = this.productFields(ctx, entry, name);
      if (!fields) continue; // Ya se reporto el motivo (precio invalido).

      const existing = this.findProduct(ctx, entry);
      // El SKU se reescribe solo si el producto no tenia o si coincide con el del
      // archivo: asi no se le cambia el codigo a un producto que ya lo tenia.
      const fileSku = optionalText(entry.sku);
      if (fileSku && (!existing?.sku || keyOf(existing.sku) === keyOf(fileSku))) {
        fields.sku = fileSku;
      }

      if (existing && this.shouldSkip(ctx, true)) {
        this.count(ctx, 'products', 'skipped');
        continue;
      }

      const stock = optionalNumber(entry.stock);
      const targetStock = stock === undefined ? 0 : toQty(Math.max(0, stock));

      try {
        if (existing) {
          await this.products.update(ctx.companyId, existing.id, fields);
          if (
            stock !== undefined &&
            compareQty(existing.stock, targetStock) !== 0
          ) {
            await this.inventory.adjustStock(
              ctx.companyId,
              existing.id,
              {
                newStock: targetStock,
                reason: 'Importacion de catalogo',
              },
              ctx.userId,
            );
            existing.stock = targetStock;
          }
          this.count(ctx, 'products', 'updated');
        } else {
          const created = await this.products.create(
            ctx.companyId,
            { ...fields, stock: targetStock },
            ctx.userId,
          );
          this.registerProduct(ctx, {
            id: created.id,
            name: created.name,
            sku: created.sku,
            stock: toQty(created.stock),
            active: created.active,
          });
          this.count(ctx, 'products', 'created');
        }
      } catch (error) {
        this.report(ctx, 'products', 'error', name, messageOf(error));
      }
    }
  }

  /** Producto ya existente para esa entrada (por SKU y, si no, por nombre). */
  private findProduct(
    ctx: ImportContext,
    entry: Record<string, unknown>,
  ): ProductRef | undefined {
    return (
      ctx.products.bySku.get(keyOf(entry.sku)) ??
      ctx.products.byName.get(keyOf(entry.name))
    );
  }

  /** Suma un producto recien creado a los indices (lo usan las recetas). */
  private registerProduct(ctx: ImportContext, ref: ProductRef): void {
    if (ref.sku && !ctx.products.bySku.has(keyOf(ref.sku))) {
      ctx.products.bySku.set(keyOf(ref.sku), ref);
    }
    if (!ctx.products.byName.has(keyOf(ref.name))) {
      ctx.products.byName.set(keyOf(ref.name), ref);
    }
  }

  /**
   * Id de una relacion por su NOMBRE (categoria o proveedor). Ausente devuelve
   * `undefined` (no se toca el enlace actual) y no encontrada devuelve `''` (se
   * desenlaza) con un aviso, para que el archivo no quede silenciosamente mal.
   */
  private linkedId(
    ctx: ImportContext,
    entity: CatalogEntity,
    index: Map<string, string>,
    value: unknown,
    ownerName: string,
    label: string,
  ): string | undefined {
    const name = text(value);
    if (!name) return undefined;
    const id = index.get(keyOf(name));
    if (!id) {
      this.report(
        ctx,
        entity,
        'warning',
        ownerName,
        `No se encontro ${label} "${name}": queda sin asignar.`,
      );
      return '';
    }
    return id;
  }

  /**
   * Campos del producto tal como los espera el servicio (moneda, tasa, unidad y
   * relaciones resueltas). Devuelve `null` si el precio no sirve: en ese caso ya
   * se reporto el motivo y el registro se saltea.
   */
  private productFields(
    ctx: ImportContext,
    entry: Record<string, unknown>,
    name: string,
  ): CreateProductDto | null {
    const price = optionalNumber(entry.price);
    if (price === undefined || price < 0) {
      this.report(
        ctx,
        'products',
        'error',
        name,
        'El precio debe ser un numero mayor o igual a 0: el producto se omite.',
      );
      return null;
    }

    const fields: CreateProductDto = {
      name,
      description: optionalFieldText(entry, 'description'),
      // La foto viaja como data URL o URL; `null` en el archivo la elimina.
      imageUrl: optionalFieldText(entry, 'imageUrl'),
      price,
      priceCurrency: optionalText(entry.priceCurrency),
      priceRateKey: rateKeyOf(entry.priceRateKey),
      cost: optionalNumber(entry.cost),
      costCurrency: optionalText(entry.costCurrency),
      costRateKey: rateKeyOf(entry.costRateKey),
      unitCost: optionalNumber(entry.unitCost),
      unitCostCurrency: optionalText(entry.unitCostCurrency),
      unitCostRateKey: rateKeyOf(entry.unitCostRateKey),
      unitPrice: optionalNumber(entry.unitPrice),
      unitPriceCurrency: optionalText(entry.unitPriceCurrency),
      unitPriceRateKey: rateKeyOf(entry.unitPriceRateKey),
      unit: unitOf(entry.unit),
      unitsPerBox: unitsPerBoxOf(entry.unitsPerBox),
      trackStock: optionalBoolean(entry.trackStock),
      active: optionalBoolean(entry.active),
      // Cadena vacia = sin categoria / sin proveedor (el servicio lo interpreta
      // como `disconnect`), asi un `null` del archivo limpia el enlace.
      categoryId: this.linkedId(
        ctx,
        'products',
        ctx.categories,
        entry.category,
        name,
        'la categoria',
      ),
      supplierId: this.linkedId(
        ctx,
        'products',
        ctx.suppliers,
        entry.supplier,
        name,
        'el proveedor',
      ),
    };

    const minStock = optionalNumber(entry.minStock);
    if (minStock !== undefined) {
      fields.minStock = Math.max(0, minStock);
    }

    return fields;
  }

  /**
   * Menus: se reconocen por CODIGO y, si ese codigo no existe en la empresa, por
   * NOMBRE (mismo criterio que los productos). La receta se resuelve por SKU y se
   * reemplaza completa cuando el archivo la trae.
   */
  private async importMenus(
    ctx: ImportContext,
    rows: unknown[],
  ): Promise<void> {
    for (const entry of this.objects(ctx, 'menus', rows)) {
      const name = text(entry.name);
      if (!name) {
        this.report(
          ctx,
          'menus',
          'error',
          `#${rows.indexOf(entry) + 1}`,
          'El menu no tiene nombre: se omite.',
        );
        continue;
      }

      const price = optionalNumber(entry.price);
      if (price === undefined || price < 0) {
        this.report(
          ctx,
          'menus',
          'error',
          name,
          'El precio debe ser un numero mayor o igual a 0: el menu se omite.',
        );
        continue;
      }

      const existingId = this.findMenu(ctx, entry);
      if (existingId && this.shouldSkip(ctx, true)) {
        this.count(ctx, 'menus', 'skipped');
        continue;
      }

      const payload: CreateMenuDto = {
        name,
        description: optionalFieldText(entry, 'description'),
        imageUrl: optionalFieldText(entry, 'imageUrl'),
        price,
        priceCurrency: optionalText(entry.priceCurrency),
        availability: availabilityOf(entry.availability),
        // Cadena vacia = sin categoria de menu (el servicio la limpia).
        categoryId: this.linkedId(
          ctx,
          'menus',
          ctx.menuCategories,
          entry.category,
          name,
          'la categoria de menu',
        ),
        active: optionalBoolean(entry.active),
      };

      const code = optionalText(entry.code);
      if (code) payload.code = code;

      const minutes = optionalNumber(entry.preparationMinutes);
      if (minutes !== undefined) {
        payload.preparationMinutes = Math.min(600, Math.max(1, Math.round(minutes)));
      }

      // El archivo trae la receta completa: solo se toca si la clave existe (un
      // archivo parcial no borra la receta del menu) y enviarla vacia la elimina.
      if ('ingredients' in entry) {
        payload.ingredients = this.recipeLines(ctx, entry.ingredients, name);
      }

      try {
        if (existingId) {
          await this.menus.update(ctx.companyId, existingId, payload);
          this.count(ctx, 'menus', 'updated');
        } else {
          const created = await this.menus.create(ctx.companyId, payload);
          if (!ctx.menus.byCode.has(keyOf(created.code))) {
            ctx.menus.byCode.set(keyOf(created.code), created.id);
          }
          if (!ctx.menus.byName.has(keyOf(created.name))) {
            ctx.menus.byName.set(keyOf(created.name), created.id);
          }
          this.count(ctx, 'menus', 'created');
        }
      } catch (error) {
        this.report(ctx, 'menus', 'error', name, messageOf(error));
      }
    }
  }

  /** Menu ya existente para esa entrada (por codigo y, si no, por nombre). */
  private findMenu(
    ctx: ImportContext,
    entry: Record<string, unknown>,
  ): string | undefined {
    return (
      ctx.menus.byCode.get(keyOf(entry.code)) ??
      ctx.menus.byName.get(keyOf(entry.name))
    );
  }

  /**
   * Receta del archivo: cada linea se resuelve por SKU (y, si ese SKU no existe,
   * por el nombre del producto). Un ingrediente que no se pueda resolver, que
   * este inactivo, repetido o con cantidad invalida se AVISA y se saltea: una
   * linea rota no debe tumbar la receta completa.
   */
  private recipeLines(
    ctx: ImportContext,
    value: unknown,
    menuName: string,
  ): MenuIngredientDto[] {
    const lines: MenuIngredientDto[] = [];
    const used = new Set<string>();

    for (const row of asArray(value)) {
      if (!isPlainObject(row)) {
        this.report(
          ctx,
          'menus',
          'warning',
          menuName,
          'Se salteo una linea de receta con formato invalido.',
        );
        continue;
      }

      const sku = optionalText(row.product);
      const productName = optionalText(row.productName);
      const ref =
        (sku ? ctx.products.bySku.get(keyOf(sku)) : undefined) ??
        (productName ? ctx.products.byName.get(keyOf(productName)) : undefined);
      if (!ref) {
        this.report(
          ctx,
          'menus',
          'warning',
          menuName,
          `No se encontro el producto "${sku ?? productName ?? '?'}": queda fuera de la receta.`,
        );
        continue;
      }

      const quantity = optionalNumber(row.quantity);
      if (quantity === undefined || quantity <= 0) {
        this.report(
          ctx,
          'menus',
          'warning',
          menuName,
          `La cantidad de "${ref.name}" debe ser mayor a 0: queda fuera de la receta.`,
        );
        continue;
      }

      if (!ref.active) {
        this.report(
          ctx,
          'menus',
          'warning',
          menuName,
          `El producto "${ref.name}" esta inactivo y no puede usarse en una receta: queda fuera.`,
        );
        continue;
      }

      if (used.has(ref.id)) {
        this.report(
          ctx,
          'menus',
          'warning',
          menuName,
          `El producto "${ref.name}" esta repetido en la receta: se conserva la primera linea.`,
        );
        continue;
      }

      used.add(ref.id);
      lines.push({
        productId: ref.id,
        quantity: toQty(quantity),
        section: sectionOf(row.section) ?? 'Principal',
        note: optionalText(row.note),
        sortOrder: lines.length,
      });
    }

    return lines;
  }
}
