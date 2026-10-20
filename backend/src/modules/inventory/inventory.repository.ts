import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { buildDateRange } from '../../common/utils/date.util';
import { toSkip } from '../../common/utils/pagination.util';
import { tenantWhere } from '../../common/utils/tenant.util';
import { PrismaService, type PrismaClientLike } from '../../prisma/prisma.service';
import { MovementQueryDto } from './dto/movement-query.dto';

/** Producto con lo necesario para convertir la cantidad y mover el stock. */
const MOVEMENT_PRODUCT_SELECT = {
  id: true,
  name: true,
  stock: true,
  unit: true,
  unitsPerBox: true,
} satisfies Prisma.ProductSelect;

/** Movimiento con su producto y el usuario que lo registro. */
const MOVEMENT_LIST_INCLUDE = {
  // El movimiento ya viene filtrado por empresa; su producto es el mismo.
  product: { select: { id: true, name: true, sku: true, unit: true } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.StockMovementInclude;

/** Niveles de stock para el formulario de movimientos. */
const STOCK_LEVEL_SELECT = {
  id: true,
  sku: true,
  name: true,
  stock: true,
  minStock: true,
  unit: true,
  // Presentacion y precio de la unidad suelta: el formulario de movimientos los
  // necesita para convertir cajas <-> unidades y para mostrar a cuanto se vende
  // la unidad que se abre de la presentacion.
  unitsPerBox: true,
  unitPrice: true,
  cost: true,
  price: true,
  // Contexto de moneda de los montos (que viajan en USD): la tabla vuelve a
  // mostrar el monto tal como lo escribio el operador (Bs 350,00) y no su
  // equivalente en dolares redondeado a centavos.
  priceCurrency: true,
  priceRateKey: true,
  priceEntered: true,
  costCurrency: true,
  costRateKey: true,
  costEntered: true,
  unitPriceCurrency: true,
  unitPriceRateKey: true,
  unitPriceEntered: true,
  category: { select: { id: true, name: true } },
} satisfies Prisma.ProductSelect;

export type MovementProduct = Prisma.ProductGetPayload<{
  select: typeof MOVEMENT_PRODUCT_SELECT;
}>;

export type StockLevelProduct = Prisma.ProductGetPayload<{
  select: typeof STOCK_LEVEL_SELECT;
}>;

/**
 * Acceso a datos de inventario. Toda consulta/escritura de Prisma del modulo
 * vive aqui: el servicio conserva las reglas del motor de stock (cantidades,
 * disponibilidad, trazabilidad), pero no conoce el cliente de base de datos.
 */
@Injectable()
export class InventoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(tx?: PrismaClientLike): PrismaClientLike {
    return tx ?? this.prisma;
  }

  /** Producto de la empresa activa con los datos que necesita el motor. */
  findMovementProduct(
    companyId: string,
    productId: string,
    tx?: PrismaClientLike,
  ): Promise<MovementProduct | null> {
    return this.client(tx).product.findFirst({
      where: { id: productId, ...tenantWhere(companyId) },
      select: MOVEMENT_PRODUCT_SELECT,
    });
  }

  /** Deja el movimiento del inventario (append-only). */
  createMovement(
    data: Prisma.StockMovementUncheckedCreateInput,
    tx?: PrismaClientLike,
  ) {
    return this.client(tx).stockMovement.create({ data });
  }

  /**
   * Actualiza el producto del movimiento. Es `updateMany` con filtro por empresa:
   * nunca se toca un producto de otra.
   */
  updateProductStock(
    companyId: string,
    productId: string,
    data: Prisma.ProductUncheckedUpdateManyInput,
    tx?: PrismaClientLike,
  ) {
    return this.client(tx).product.updateMany({
      where: { id: productId, ...tenantWhere(companyId) },
      data,
    });
  }

  /** Pagina de movimientos con su producto y el usuario que los registro. */
  async findMovementPage(companyId: string, query: MovementQueryDto) {
    const where = this.movementWhere(companyId, query);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.stockMovement.findMany({
        where,
        include: MOVEMENT_LIST_INCLUDE,
        orderBy: query.toOrderBy(['createdAt', 'quantity'], {
          createdAt: 'desc',
        }),
        skip: toSkip(query.page, query.limit),
        take: query.limit,
      }),
      this.prisma.stockMovement.count({ where }),
    ]);

    return { items, total };
  }

  /** Productos activos con su stock actual (la interfaz filtra los bajos). */
  findStockLevels(
    companyId: string,
    options: { search?: string },
  ): Promise<StockLevelProduct[]> {
    return this.prisma.product.findMany({
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
      select: STOCK_LEVEL_SELECT,
      orderBy: { name: 'asc' },
    });
  }

  private movementWhere(
    companyId: string,
    query: MovementQueryDto,
  ): Prisma.StockMovementWhereInput {
    const dateFilter = buildDateRange(query.from, query.to);

    return {
      ...tenantWhere(companyId),
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.from || query.to ? { createdAt: dateFilter } : {}),
    };
  }
}
