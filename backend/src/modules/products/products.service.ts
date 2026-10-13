import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { StockMovementType } from '../../common/constants/enums';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { buildPaginatedResult, toSkip } from '../../common/utils/pagination.util';
import { toMoney } from '../../common/utils/money.util';
import { normalizeNullableId } from '../../common/utils/normalize.util';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductQueryDto } from './dto/product-query.dto';
import { UpdateProductDto } from './dto/update-product.dto';

const PRODUCT_INCLUDE = {
  category: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
} satisfies Prisma.ProductInclude;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
  ) {}

  async create(dto: CreateProductDto, userId?: string) {
    const { stock, cost, categoryId, supplierId, sku, ...rest } = dto;

    const product = await this.prisma.product.create({
      data: {
        ...rest,
        sku: sku?.trim() || (await this.generateSku(dto.name)),
        price: toMoney(dto.price),
        cost: toMoney(cost ?? 0),
        stock: 0,
        minStock: dto.minStock ?? 0,
        unit: dto.unit ?? 'UND',
        trackStock: dto.trackStock ?? true,
        active: dto.active ?? true,
        categoryId: normalizeNullableId(categoryId),
        supplierId: normalizeNullableId(supplierId),
      },
      include: PRODUCT_INCLUDE,
    });

    // Stock inicial => movimiento de inventario trazable.
    if (stock && stock > 0) {
      await this.inventory.applyMovement({
        productId: product.id,
        type: StockMovementType.IN,
        quantity: stock,
        unitCost: cost,
        reason: 'Stock inicial',
        referenceType: 'INITIAL',
        createdById: userId,
      });
    }

    return this.findOne(product.id);
  }

  async findAll(query: ProductQueryDto) {
    const where: Prisma.ProductWhereInput = {
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

  /** Productos activos para selects (POS / pedidos). */
  findOptions() {
    return this.prisma.product.findMany({
      where: { active: true },
      select: {
        id: true,
        sku: true,
        name: true,
        price: true,
        stock: true,
        unit: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: PRODUCT_INCLUDE,
    });
    if (!product) throw new NotFoundException('Producto no encontrado');
    return product;
  }

  async update(id: string, dto: UpdateProductDto) {
    await this.findOne(id);
    const { cost, categoryId, supplierId, sku, ...rest } = dto;

    const data: Prisma.ProductUpdateInput = {
      ...rest,
      ...(cost !== undefined ? { cost: toMoney(cost) } : {}),
      ...(rest.price !== undefined ? { price: toMoney(rest.price) } : {}),
      ...(sku !== undefined ? { sku: sku.trim() } : {}),
      ...(categoryId !== undefined
        ? { category: categoryId ? { connect: { id: categoryId } } : { disconnect: true } }
        : {}),
      ...(supplierId !== undefined
        ? { supplier: supplierId ? { connect: { id: supplierId } } : { disconnect: true } }
        : {}),
    };

    await this.prisma.product.update({ where: { id }, data });
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.product.update({
      where: { id },
      data: { active: false },
    });
  }

  /** Genera un SKU unico y legible a partir del nombre. */
  private async generateSku(name: string): Promise<string> {
    const base = name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 4)
      .toUpperCase()
      .padEnd(4, 'X');

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate = `${base}-${Math.floor(1000 + Math.random() * 9000)}`;
      const exists = await this.prisma.product.findUnique({
        where: { sku: candidate },
      });
      if (!exists) return candidate;
    }
    throw new BadRequestException('No se pudo generar un SKU unico');
  }
}

export { PRODUCT_INCLUDE };
