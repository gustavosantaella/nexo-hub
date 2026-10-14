import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  StockMovementType,
  type StockMovementType as StockMovementTypeT,
} from '../../common/constants/enums';
import { buildPaginatedResult, toSkip } from '../../common/utils/pagination.util';
import { buildDateRange } from '../../common/utils/date.util';
import { money } from '../../common/utils/money.util';
import { compareQty, toQty } from '../../common/utils/quantity.util';
import { tenantWhere } from '../../common/utils/tenant.util';
import { PrismaService, type PrismaClientLike } from '../../prisma/prisma.service';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { CreateMovementDto } from './dto/create-movement.dto';
import { MovementQueryDto } from './dto/movement-query.dto';

/** Entrada del motor de stock. `tx` permite participar de una transaccion. */
export interface MovementInput {
  productId: string;
  type: StockMovementTypeT;
  /** Cantidad en la unidad del producto (3 decimales: 0.1 = 100 g). */
  quantity: number;
  unitCost?: number;
  reason?: string;
  referenceType?: string;
  referenceId?: string;
  createdById?: string;
  allowNegative?: boolean;
}

/** Resultado del motor de stock. */
export interface MovementResult {
  movement: { id: string };
  stockBefore: number;
  stockAfter: number;
}

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * MOTOR DE STOCK. Unico punto autorizado para variar el stock de un producto.
   * Calcula el stock resultante, valida disponibilidad y deja trazabilidad
   * (movimiento append-only con stockBefore/stockAfter).
   */
  async applyMovement(
    companyId: string,
    input: MovementInput,
    tx?: PrismaClientLike,
  ): Promise<MovementResult> {
    const client = tx ?? this.prisma;

    // El producto debe pertenecer a la empresa activa (aislamiento).
    const product = await client.product.findFirst({
      where: { id: input.productId, ...tenantWhere(companyId) },
      select: { id: true, name: true, stock: true },
    });
    if (!product) {
      throw new NotFoundException(`Producto no encontrado: ${input.productId}`);
    }

    const stockBefore = toQty(product.stock);
    const quantity = toQty(input.quantity);
    let stockAfter = stockBefore;

    switch (input.type) {
      case StockMovementType.IN:
        stockAfter = toQty(stockBefore + quantity);
        break;
      case StockMovementType.OUT:
        stockAfter = toQty(stockBefore - quantity);
        if (stockAfter < 0 && !input.allowNegative) {
          throw new BadRequestException(
            `Stock insuficiente para "${product.name}". Disponible: ${stockBefore}, requerido: ${quantity}.`,
          );
        }
        break;
      case StockMovementType.ADJUSTMENT:
        // En ajustes, `quantity` representa el stock FINAL deseado.
        stockAfter = quantity;
        if (stockAfter < 0) {
          throw new BadRequestException('El stock no puede ser negativo');
        }
        break;
      default:
        throw new BadRequestException('Tipo de movimiento invalido');
    }

    const movement = await client.stockMovement.create({
      data: {
        companyId,
        productId: product.id,
        type: input.type,
        quantity: toQty(Math.abs(stockAfter - stockBefore)),
        stockBefore,
        stockAfter,
        unitCost: input.unitCost ?? null,
        reason: input.reason,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        createdById: input.createdById,
      },
    });

    // updateMany + filtro por empresa: nunca se toca un producto de otra.
    await client.product.updateMany({
      where: { id: product.id, ...tenantWhere(companyId) },
      data: {
        stock: stockAfter,
        // Al ingresar mercaderia podemos actualizar el costo de referencia.
        ...(input.type === StockMovementType.IN && input.unitCost != null
          ? { cost: input.unitCost }
          : {}),
      },
    });

    return { movement, stockBefore, stockAfter };
  }

  /** Crea un movimiento a partir del DTO del endpoint. */
  create(companyId: string, dto: CreateMovementDto, userId?: string) {
    return this.applyMovement(companyId, { ...dto, createdById: userId });
  }

  /** Ajusta el stock al valor final indicado (crea IN u OUT implicitamente). */
  adjustStock(
    companyId: string,
    productId: string,
    dto: AdjustStockDto,
    userId?: string,
  ) {
    return this.applyMovement(companyId, {
      productId,
      type: StockMovementType.ADJUSTMENT,
      quantity: dto.newStock,
      reason: dto.reason ?? 'Ajuste manual de stock',
      referenceType: 'ADJUSTMENT',
      createdById: userId,
    });
  }

  async findMovements(companyId: string, query: MovementQueryDto) {
    const dateFilter = buildDateRange(query.from, query.to);

    const where: Prisma.StockMovementWhereInput = {
      ...tenantWhere(companyId),
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.from || query.to ? { createdAt: dateFilter } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.stockMovement.findMany({
        where,
        include: {
          // El movimiento ya viene filtrado por empresa; su producto es el mismo.
          product: { select: { id: true, name: true, sku: true, unit: true } },
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: query.toOrderBy(['createdAt', 'quantity'], {
          createdAt: 'desc',
        }),
        skip: toSkip(query.page, query.limit),
        take: query.limit,
      }),
      this.prisma.stockMovement.count({ where }),
    ]);

    return buildPaginatedResult(items, total, query.page, query.limit);
  }

  /** Niveles de stock actuales (opcionalmente solo los que estan bajo minimo). */
  async getStockLevels(
    companyId: string,
    options: { lowOnly?: boolean; search?: string },
  ) {
    const products = await this.prisma.product.findMany({
      where: {
        active: true,
        ...tenantWhere(companyId),
        ...(options.search
          ? {
              OR: [
                { name: { contains: options.search } },
                { sku: { contains: options.search } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        sku: true,
        name: true,
        stock: true,
        minStock: true,
        unit: true,
        cost: true,
        price: true,
        category: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    });

    const items = products.map((p) => ({
      ...p,
      stockValue: money.mul(p.stock, p.cost),
      isLowStock: compareQty(p.stock, p.minStock) <= 0,
    }));

    return options.lowOnly ? items.filter((p) => p.isLowStock) : items;
  }
}
