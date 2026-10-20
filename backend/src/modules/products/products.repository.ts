import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { toSkip } from '../../common/utils/pagination.util';
import { tenantWhere } from '../../common/utils/tenant.util';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductQueryDto } from './dto/product-query.dto';

const PRODUCT_INCLUDE = {
  category: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
} satisfies Prisma.ProductInclude;

export type ProductWithRelations = Prisma.ProductGetPayload<{
  include: typeof PRODUCT_INCLUDE;
}>;

/** Menu activo que quedaria sin poder venderse al desactivar un producto. */
export type MenuUsingProduct = { id: string; code: string; name: string };

/**
 * Acceso a datos del catalogo de productos. Toda consulta/escritura de Prisma
 * del modulo vive aqui: el servicio conserva las reglas de negocio (SKU unico,
 * monedas/tasas de cada monto, stock inicial), pero no conoce el cliente de
 * base de datos.
 */
@Injectable()
export class ProductsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.ProductUncheckedCreateInput) {
    return this.prisma.product.create({
      data,
      include: PRODUCT_INCLUDE,
    });
  }

  async findPage(
    companyId: string,
    query: ProductQueryDto,
    /** Categoria elegida + sus subcategorias (filtro por categoria principal). */
    categoryIds?: string[],
  ) {
    const where = this.listWhere(companyId, query, categoryIds);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: PRODUCT_INCLUDE,
        orderBy: query.toOrderBy(['name', 'price', 'stock', 'createdAt'], {
          name: 'asc',
        }),
        skip: toSkip(query.page, query.limit),
        take: query.limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { items, total };
  }

  /** Productos activos para selects y para la grilla del POS (punto de venta). */
  findOptions(companyId: string) {
    return this.prisma.product.findMany({
      where: { active: true, ...tenantWhere(companyId) },
      select: {
        id: true,
        sku: true,
        name: true,
        // La busqueda del POS tambien mira la descripcion y la categoria.
        description: true,
        price: true,
        // El costo viaja con las opciones para que el formulario de menus pueda
        // costear la receta en vivo (producto x cantidad).
        cost: true,
        stock: true,
        unit: true,
        // Precio de venta de UNA unidad suelta (cajas/paquetes): el POS y los
        // pedidos lo cobran cuando la presentacion se vende por unidades.
        unitPrice: true,
        unitsPerBox: true,
        // Contexto de moneda de los montos (que viajan en USD): la grilla del POS
        // vuelve a mostrar el monto tal como lo escribio el operador (Bs 350,00) y
        // no su equivalente en dolares redondeado a centavos.
        priceCurrency: true,
        priceRateKey: true,
        priceEntered: true,
        unitPriceCurrency: true,
        unitPriceRateKey: true,
        unitPriceEntered: true,
        imageUrl: true,
        categoryId: true,
        // Nombre de la categoria para buscarla sin depender de otra peticion.
        category: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  findOne(companyId: string, id: string): Promise<ProductWithRelations | null> {
    return this.prisma.product.findFirst({
      where: { id, ...tenantWhere(companyId) },
      include: PRODUCT_INCLUDE,
    });
  }

  /**
   * `update` con filtro por empresa: nunca se toca un producto de otra. Se usa
   * `update` (y no `updateMany`) porque los enlaces `category`/`supplier` son
   * escrituras de relacion y `updateMany` solo admite campos escalares.
   */
  update(companyId: string, id: string, data: Prisma.ProductUpdateInput) {
    return this.prisma.product.update({
      where: { id, ...tenantWhere(companyId) },
      data,
    });
  }

  /** Menus ACTIVOS que usan el producto en su receta. */
  async findActiveMenusUsing(
    companyId: string,
    productId: string,
  ): Promise<MenuUsingProduct[]> {
    const lines = await this.prisma.menuIngredient.findMany({
      where: {
        productId,
        ...tenantWhere(companyId),
        menu: { active: true },
      },
      select: { menu: { select: { id: true, code: true, name: true } } },
      orderBy: { menu: { name: 'asc' } },
    });
    return lines.map((line) => line.menu);
  }

  /** Baja logica: pedidos y recetas siguen referenciando al producto. */
  deactivate(companyId: string, id: string) {
    return this.prisma.product.updateMany({
      where: { id, ...tenantWhere(companyId) },
      data: { active: false },
    });
  }

  /** El SKU es unico por empresa (no global). */
  findSku(companyId: string, sku: string, excludeId?: string) {
    return this.prisma.product.findFirst({
      where: {
        ...tenantWhere(companyId),
        sku,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
  }

  findCategory(companyId: string, categoryId: string) {
    return this.prisma.category.findFirst({
      where: { id: categoryId, ...tenantWhere(companyId) },
      select: { id: true },
    });
  }

  findSupplier(companyId: string, supplierId: string) {
    return this.prisma.supplier.findFirst({
      where: { id: supplierId, ...tenantWhere(companyId) },
      select: { id: true },
    });
  }

  /**
   * Ids que abarca el filtro de categoria: la categoria elegida y sus
   * subcategorias (un solo nivel).
   */
  async categoryScopeIds(companyId: string, categoryId: string) {
    const subcategories = await this.prisma.category.findMany({
      where: { parentId: categoryId, ...tenantWhere(companyId) },
      select: { id: true },
    });
    return [categoryId, ...subcategories.map((subcategory) => subcategory.id)];
  }

  private listWhere(
    companyId: string,
    query: ProductQueryDto,
    categoryIds?: string[],
  ): Prisma.ProductWhereInput {
    return {
      ...tenantWhere(companyId),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search } },
              { sku: { contains: query.search } },
              { description: { contains: query.search } },
            ],
          }
        : {}),
      ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.onlyActive ? { active: true } : {}),
    };
  }
}

export { PRODUCT_INCLUDE };
