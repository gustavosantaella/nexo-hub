import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CategoriesService } from '../categories/categories.service';
import type { InventoryService } from '../inventory/inventory.service';
import type { MenuCategoriesService } from '../menus/menu-categories.service';
import type { MenusService } from '../menus/menus.service';
import type { ProductsService } from '../products/products.service';
import type { SuppliersService } from '../suppliers/suppliers.service';
import { CATALOG_FORMAT, CATALOG_FORMAT_VERSION } from './catalog-format';
import { DataTransferRepository } from './data-transfer.repository';
import { DataTransferService } from './data-transfer.service';

const COMPANY_ID = 'company-1';

/** Producto minimo que devuelve la base para exportar. */
function productRow(name: string) {
  return {
    sku: `${name}-sku`,
    name,
    description: null,
    imageUrl: null,
    price: 10,
    priceCurrency: 'USD',
    priceRateKey: 'BCV_USD',
    priceEntered: 10,
    cost: 4,
    costCurrency: 'USD',
    costRateKey: 'BCV_USD',
    costEntered: 4,
    unitCost: 4,
    unitCostCurrency: 'USD',
    unitCostRateKey: 'BCV_USD',
    unitCostEntered: 4,
    unitPrice: 10,
    unitPriceCurrency: 'USD',
    unitPriceRateKey: 'BCV_USD',
    unitPriceEntered: 10,
    stock: 5,
    minStock: 1,
    unit: 'UNIT',
    unitsPerBox: null,
    trackStock: true,
    active: true,
    category: { name: 'Bebidas' },
    supplier: { name: 'Distribuidor' },
  };
}

/**
 * Prisma simulado: el snapshot del export se resuelve con `$transaction`, igual
 * que en la base real (`Promise.all` de las seis lecturas).
 */
function createService(snapshot: {
  company?: unknown;
  categories?: unknown[];
  menuCategories?: unknown[];
  suppliers?: unknown[];
  products?: unknown[];
  menus?: unknown[];
} = {}) {
  const prisma = {
    $transaction: jest.fn((operations: unknown[]) => Promise.all(operations)),
    company: { findUnique: jest.fn().mockResolvedValue(null) },
    category: { findMany: jest.fn().mockResolvedValue([]) },
    menuCategory: { findMany: jest.fn().mockResolvedValue([]) },
    supplier: { findMany: jest.fn().mockResolvedValue([]) },
    product: { findMany: jest.fn().mockResolvedValue([]) },
    menu: { findMany: jest.fn().mockResolvedValue([]) },
  };

  prisma.company.findUnique.mockResolvedValue(
    'company' in snapshot
      ? snapshot.company
      : { id: COMPANY_ID, name: 'Mi local' },
  );
  prisma.category.findMany
    .mockResolvedValueOnce(snapshot.categories ?? [])
    .mockResolvedValue([]);
  prisma.menuCategory.findMany
    .mockResolvedValueOnce(snapshot.menuCategories ?? [])
    .mockResolvedValue([]);
  prisma.supplier.findMany
    .mockResolvedValueOnce(snapshot.suppliers ?? [])
    .mockResolvedValue([]);
  prisma.product.findMany
    .mockResolvedValueOnce(snapshot.products ?? [])
    .mockResolvedValue([]);
  prisma.menu.findMany
    .mockResolvedValueOnce(snapshot.menus ?? [])
    .mockResolvedValue([]);

  const service = new DataTransferService(
    new DataTransferRepository(prisma as unknown as PrismaService),
    {} as CategoriesService,
    {} as MenuCategoriesService,
    {} as SuppliersService,
    {} as ProductsService,
    {} as MenusService,
    {} as InventoryService,
  );

  return { service, prisma };
}

describe('DataTransferService (catalogo)', () => {
  describe('exportCatalog', () => {
    it('lee el catalogo en una sola transaccion y arma el documento', async () => {
      const { service, prisma } = createService({
        categories: [{ id: 'cat-1', name: 'Bebidas', description: null, parentId: null, active: true }],
        products: [productRow('Cafe')],
      });

      const document = await service.exportCatalog(COMPANY_ID);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(document.format).toBe(CATALOG_FORMAT);
      expect(document.version).toBe(CATALOG_FORMAT_VERSION);
      expect(document.company).toEqual({ id: COMPANY_ID, name: 'Mi local' });
      expect(document.counts).toMatchObject({ categories: 1, products: 1 });
      // La categoria y el proveedor viajan por NOMBRE, no por id.
      expect(document.products[0]).toMatchObject({
        name: 'Cafe',
        category: 'Bebidas',
        supplier: 'Distribuidor',
      });
      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ companyId: COMPANY_ID }),
        }),
      );
    });

    it('falla cuando la empresa activa ya no existe', async () => {
      const { service } = createService({ company: null });

      await expect(service.exportCatalog(COMPANY_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('importCatalog', () => {
    it('un archivo vacio no escribe nada y devuelve los conteos en cero', async () => {
      const { service, prisma } = createService();

      const result = await service.importCatalog(COMPANY_ID, {
        format: CATALOG_FORMAT,
        version: CATALOG_FORMAT_VERSION,
      });

      expect(result.mode).toBe('merge');
      expect(result.issues).toEqual([]);
      expect(result.created).toEqual({
        categories: 0,
        menuCategories: 0,
        suppliers: 0,
        products: 0,
        menus: 0,
      });
      // Los indices se leen antes de importar (claves naturales ya existentes).
      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ companyId: COMPANY_ID }),
        }),
      );
    });
  });
});
