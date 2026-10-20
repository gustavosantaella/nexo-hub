import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { tenantWhere } from '../../common/utils/tenant.util';
import { PrismaService } from '../../prisma/prisma.service';

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

/** Columnas de las categorias de productos en el archivo. */
const CATEGORY_EXPORT_SELECT = {
  id: true,
  name: true,
  description: true,
  parentId: true,
  active: true,
} satisfies Prisma.CategorySelect;

/** Columnas de las categorias de menu en el archivo. */
const MENU_CATEGORY_EXPORT_SELECT = {
  id: true,
  name: true,
  description: true,
  color: true,
  sortOrder: true,
  parentId: true,
  active: true,
} satisfies Prisma.MenuCategorySelect;

/** Columnas de los proveedores en el archivo. */
const SUPPLIER_EXPORT_SELECT = {
  name: true,
  contactName: true,
  phone: true,
  email: true,
  address: true,
  taxId: true,
  notes: true,
  active: true,
} satisfies Prisma.SupplierSelect;

/**
 * Acceso a datos de la exportacion / importacion del catalogo. Toda consulta de
 * Prisma del modulo vive aqui: el servicio arma el archivo y delega cada
 * registro en el servicio de su dominio, pero no conoce la base de datos.
 */
@Injectable()
export class DataTransferRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lectura completa del catalogo exportable de la empresa. Va en una sola
   * transaccion para que el archivo sea una foto consistente: un producto no
   * puede quedar apuntando a una categoria que se borro a mitad de la lectura.
   */
  async exportSnapshot(companyId: string) {
    const [company, categories, menuCategories, suppliers, products, menus] =
      await this.prisma.$transaction([
        this.prisma.company.findUnique({
          where: { id: companyId },
          select: { id: true, name: true },
        }),
        this.prisma.category.findMany({
          where: tenantWhere(companyId),
          orderBy: { name: 'asc' },
          select: CATEGORY_EXPORT_SELECT,
        }),
        this.prisma.menuCategory.findMany({
          where: tenantWhere(companyId),
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: MENU_CATEGORY_EXPORT_SELECT,
        }),
        this.prisma.supplier.findMany({
          where: tenantWhere(companyId),
          orderBy: { name: 'asc' },
          select: SUPPLIER_EXPORT_SELECT,
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

    return { company, categories, menuCategories, suppliers, products, menus };
  }

  /** Claves naturales ya existentes: categorias de productos (nombre -> id). */
  findCategoryNames(companyId: string) {
    return this.prisma.category.findMany({
      where: tenantWhere(companyId),
      select: { id: true, name: true },
    });
  }

  /** Claves naturales ya existentes: categorias de menu (nombre -> id). */
  findMenuCategoryNames(companyId: string) {
    return this.prisma.menuCategory.findMany({
      where: tenantWhere(companyId),
      select: { id: true, name: true },
    });
  }

  /** Claves naturales ya existentes: proveedores (nombre -> id). */
  findSupplierNames(companyId: string) {
    return this.prisma.supplier.findMany({
      where: tenantWhere(companyId),
      select: { id: true, name: true },
    });
  }

  /** Productos ya existentes, con el stock con el que se comparan las filas. */
  findProductRefs(companyId: string) {
    return this.prisma.product.findMany({
      where: tenantWhere(companyId),
      select: { id: true, name: true, sku: true, stock: true, active: true },
    });
  }

  /** Menus ya existentes (codigo y nombre son sus claves naturales). */
  findMenuRefs(companyId: string) {
    return this.prisma.menu.findMany({
      where: tenantWhere(companyId),
      select: { id: true, name: true, code: true },
    });
  }
}
