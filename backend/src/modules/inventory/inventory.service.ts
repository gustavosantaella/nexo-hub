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
import { PrismaService, type PrismaClientLike } from '../../prisma/prisma.service';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { CreateMovementDto } from './dto/create-movement.dto';
import { MovementQueryDto } from './dto/movement-query.dto';

/** Entrada del motor de stock. `tx` permite participar de una transaccion. */
export interface MovementInput {
  productId: string;
  type: StockMovementTypeT;
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
    input: MovementInput,
    tx?: PrismaClientLike,
  ): Promise<MovementResult> {
    const client = tx ?? this.prisma;

    const product = await client.product.findUnique({
      where: { id: input.productId },
      select: { id: true, name: true, stock: true },
    });
    if (!product) {
      throw new NotFoundException(`Producto no encontrado: ${input.productId}`);
    }

    const stockBefore = product.stock;
    let stockAfter = stockBefore;

    switch (input.type) {
      case StockMovementType.IN:
        stockAfter = stockBefore + input.quantity;
        break;
      case StockMovementType.OUT:
        stockAfter = stockBefore - input.quantity;
        if (stockAfter < 0 && !input.allowNegative) {
          throw new BadRequestException(
            `Stock insuficiente para "${product.name}". Disponible: ${stockBefore}, requerido: ${input.quantity}.`,
          );
        }
        break;
      case StockMovementType.ADJUSTMENT:
        // En ajustes, `quantity` representa el stock FINAL deseado.
        stockAfter = input.quantity;
        if (stockAfter < 0) {
          throw new BadRequestException('El stock no puede ser negativo');
        }
        break;
      default:
        throw new BadRequestException('Tipo de movimiento invalido');
    }

    const movement = await client.stockMovement.create({
      data: {
        productId: product.id,
        type: input.type,
        quantity: Math.abs(stockAfter - stockBefore),
        stockBefore,
        stockAfter,
        unitCost: input.unitCost ?? null,
        reason: input.reason,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        createdById: input.createdById,
      },
    });

    await client.product.update({
      where: { id: product.id },
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
  create(dto: CreateMovementDto, userId?: string) {
    return this.applyMovement({ ...dto, createdById: userId });
  }

  /** Ajusta el stock al valor final indicado (crea IN u OUT implicitamente). */
  adjustStock(productId: string, dto: AdjustStockDto, userId?: string) {
    return this.applyMovement({
      productId,
      type: StockMovementType.ADJUSTMENT,
      quantity: dto.newStock,
      reason: dto.reason ?? 'Ajuste manual de stock',
      referenceType: 'ADJUSTMENT',
      createdById: userId,
    });
  }

  async findMovements(query: MovementQueryDto) {
    const dateFilter = buildDateRange(query.from, query.to);

    const where: Prisma.StockMovementWhereInput = {
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.from || query.to ? { createdAt: dateFilter } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.stockMovement.findMany({
        where,
        include: {
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
  async getStockLevels(options: { lowOnly?: boolean; search?: string }) {
    const products = await this.prisma.product.findMany({
      where: {
        active: true,
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
      isLowStock: p.stock <= p.minStock,
    }));

    return options.lowOnly ? items.filter((p) => p.isLowStock) : items;
  }
}
