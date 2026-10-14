import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { StockMovementType } from '../../common/constants/enums';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { buildPaginatedResult, toSkip } from '../../common/utils/pagination.util';
import { toMoney } from '../../common/utils/money.util';
import { normalizeNullableId } from '../../common/utils/normalize.util';
import { tenantWhere } from '../../common/utils/tenant.util';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductQueryDto } from './dto/product-query.dto';
import { UpdateProductDto } from './dto/update-product.dto';

const PRODUCT_INCLUDE = {
  category: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
} satisfies Prisma.ProductInclude;

/** La foto vacia se guarda como `null` (asi el formulario puede quitarla). */
function normalizeImageUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
  ) {}

  async create(companyId: string, dto: CreateProductDto, userId?: string) {
    const { stock, cost, categoryId, supplierId, sku, imageUrl, ...rest } = dto;

    const finalSku = sku?.trim() || (await this.generateSku(companyId, dto.name));
    await this.assertSkuAvailable(companyId, finalSku);
    await this.assertRelationsInCompany(companyId, categoryId, supplierId);

    const product = await this.prisma.product.create({
      data: {
        ...rest,
        companyId,
        sku: finalSku,
        price: toMoney(dto.price),
        cost: toMoney(cost ?? 0),
        stock: 0,
        minStock: dto.minStock ?? 0,
        unit: dto.unit ?? 'UND',
        unitsPerBox: dto.unitsPerBox ?? 1,
        trackStock: dto.trackStock ?? true,
        active: dto.active ?? true,
        imageUrl: normalizeImageUrl(imageUrl),
        categoryId: normalizeNullableId(categoryId),
        supplierId: normalizeNullableId(supplierId),
      },
      include: PRODUCT_INCLUDE,
    });

    // Stock inicial => movimiento de inventario trazable (siempre en la empresa).
    if (stock && stock > 0) {
      await this.inventory.applyMovement(companyId, {
        productId: product.id,
        type: StockMovementType.IN,
        quantity: stock,
        unitCost: cost,
        reason: 'Stock inicial',
        referenceType: 'INITIAL',
        createdById: userId,
      });
    }

    return this.findOne(companyId, product.id);
  }

  async findAll(companyId: string, query: ProductQueryDto) {
    const where: Prisma.ProductWhereInput = {
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
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.onlyActive ? { active: true } : {}),
    };

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

    return buildPaginatedResult(items, total, query.page, query.limit);
  }

  /** Productos activos para selects y para la grilla del POS (punto de venta). */
  findOptions(companyId: string) {
    return this.prisma.product.findMany({
      where: { active: true, ...tenantWhere(companyId) },
      select: {
        id: true,
        sku: true,
        name: true,
        price: true,
        stock: true,
        unit: true,
        unitsPerBox: true,
        imageUrl: true,
        categoryId: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(companyId: string, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, ...tenantWhere(companyId) },
      include: PRODUCT_INCLUDE,
    });
    if (!product) throw new NotFoundException('Producto no encontrado');
    return product;
  }

  async update(companyId: string, id: string, dto: UpdateProductDto) {
    await this.findOne(companyId, id);
    const { cost, categoryId, supplierId, sku, imageUrl, ...rest } = dto;

    if (sku !== undefined && sku.trim()) {
      await this.assertSkuAvailable(companyId, sku.trim(), id);
    }
    await this.assertRelationsInCompany(companyId, categoryId, supplierId);

    const data: Prisma.ProductUpdateInput = {
      ...rest,
      ...(cost !== undefined ? { cost: toMoney(cost) } : {}),
      ...(imageUrl !== undefined ? { imageUrl: normalizeImageUrl(imageUrl) } : {}),
      ...(rest.price !== undefined ? { price: toMoney(rest.price) } : {}),
      ...(sku !== undefined ? { sku: sku.trim() } : {}),
      ...(categoryId !== undefined
        ? { category: categoryId ? { connect: { id: categoryId } } : { disconnect: true } }
        : {}),
      ...(supplierId !== undefined
        ? { supplier: supplierId ? { connect: { id: supplierId } } : { disconnect: true } }
        : {}),
    };

    // `update` con filtro por empresa: nunca se toca un producto de otra. Se usa
    // `update` (y no `updateMany`) porque los enlaces `category`/`supplier` son
    // escrituras de relacion y `updateMany` solo admite campos escalares.
    await this.prisma.product.update({
      where: { id, ...tenantWhere(companyId) },
      data,
    });
    return this.findOne(companyId, id);
  }

  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    return this.prisma.product.updateMany({
      where: { id, ...tenantWhere(companyId) },
      data: { active: false },
    });
  }

  /** Genera un SKU unico por empresa y legible a partir del nombre. */
  private async generateSku(companyId: string, name: string): Promise<string> {
    const base = name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 4)
      .toUpperCase()
      .padEnd(4, 'X');

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate = `${base}-${Math.floor(1000 + Math.random() * 9000)}`;
      const exists = await this.prisma.product.findFirst({
        where: { sku: candidate, ...tenantWhere(companyId) },
        select: { id: true },
      });
      if (!exists) return candidate;
    }
    throw new BadRequestException('No se pudo generar un SKU unico');
  }

  /** El SKU es unico por empresa (no global). */
  private async assertSkuAvailable(
    companyId: string,
    sku: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.prisma.product.findFirst({
      where: {
        ...tenantWhere(companyId),
        sku,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        'Ya existe un producto con ese SKU en esta empresa',
      );
    }
  }

  /** La categoria/proveedor enlazados deben pertenecer a la empresa activa. */
  private async assertRelationsInCompany(
    companyId: string,
    categoryId?: string | null,
    supplierId?: string | null,
  ): Promise<void> {
    if (categoryId) {
      const category = await this.prisma.category.findFirst({
        where: { id: categoryId, ...tenantWhere(companyId) },
        select: { id: true },
      });
      if (!category) {
        throw new BadRequestException('La categoria indicada no existe');
      }
    }
    if (supplierId) {
      const supplier = await this.prisma.supplier.findFirst({
        where: { id: supplierId, ...tenantWhere(companyId) },
        select: { id: true },
      });
      if (!supplier) {
        throw new BadRequestException('El proveedor indicado no existe');
      }
    }
  }
}

export { PRODUCT_INCLUDE };
