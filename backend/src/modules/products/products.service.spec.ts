import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { InventoryService } from '../inventory/inventory.service';
import { ProductsService } from './products.service';

const COMPANY_ID = 'company-1';

/** Producto de ejemplo que ya existe en la empresa activa. */
const PRODUCT = {
  id: 'p1',
  companyId: COMPANY_ID,
  sku: 'BEB-001',
  name: 'Gaseosa 500ml',
  price: 4,
  cost: 2,
  stock: 10,
  minStock: 2,
  unit: 'UND',
  trackStock: true,
  active: true,
  categoryId: 'cat1',
  supplierId: null,
  imageUrl: null,
};

interface UpdateArgs {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
}

/**
 * Prisma simulado: `findFirst` resuelve el producto (o `null`) y `update` es un
 * espia para poder inspeccionar el `where`/`data` que arma el servicio.
 */
function createService(product: typeof PRODUCT | null = PRODUCT) {
  const prisma = {
    product: {
      findFirst: jest.fn(async () => product),
      create: jest.fn(),
      update: jest.fn(async (args: UpdateArgs) => ({ ...product, ...args.data })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    category: {
      findFirst: jest.fn(async () => ({ id: 'cat1' })),
    },
    supplier: {
      findFirst: jest.fn(async () => ({ id: 'sup1' })),
    },
  };
  const inventory = {} as unknown as InventoryService;
  const service = new ProductsService(
    prisma as unknown as PrismaService,
    inventory,
  );
  return { service, prisma };
}

describe('ProductsService.update', () => {
  /**
   * Regresion: `updateMany` no admite escrituras de relacion, asi que enlazar
   * la categoria/proveedor debe hacerse con `update` (filtrado por empresa),
   * de lo contrario el PATCH respondia 500 (PrismaClientValidationError).
   */
  it('enlaza la categoria con `update` (no `updateMany`) para no romper el PATCH', async () => {
    const { service, prisma } = createService();

    await service.update(COMPANY_ID, 'p1', { categoryId: 'cat1' });

    expect(prisma.product.updateMany).not.toHaveBeenCalled();
    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1', companyId: COMPANY_ID },
        data: expect.objectContaining({
          category: { connect: { id: 'cat1' } },
        }),
      }),
    );
  });

  it('desconecta la categoria cuando llega como `null`', async () => {
    const { service, prisma } = createService();

    // El frontend envia `null` para quitar la categoria (el DTO lo acepta con
    // `@IsOptional`, aunque su tipo declare solo `string`).
    await service.update(COMPANY_ID, 'p1', {
      categoryId: null as unknown as string,
    });

    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ category: { disconnect: true } }),
      }),
    );
  });

  it('normaliza una foto vacia a `null`', async () => {
    const { service, prisma } = createService();

    await service.update(COMPANY_ID, 'p1', { imageUrl: '   ' });

    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ imageUrl: null }),
      }),
    );
  });

  it('guarda las unidades por caja como escalar (no como dinero)', async () => {
    const { service, prisma } = createService();

    await service.update(COMPANY_ID, 'p1', { unitsPerBox: 24 });

    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ unitsPerBox: 24 }),
      }),
    );
  });

  it('rechaza el producto que no pertenece a la empresa activa', async () => {
    const { service, prisma } = createService(null);

    await expect(
      service.update(COMPANY_ID, 'ajeno', { name: 'Otro' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.product.update).not.toHaveBeenCalled();
  });
});
