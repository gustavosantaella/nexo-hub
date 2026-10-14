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
import { boxUnitsOf, inputUnits, stockQuantity } from '../../common/utils/packaging.util';
import { compareQty, toQty } from '../../common/utils/quantity.util';
import { tenantWhere } from '../../common/utils/tenant.util';
import { PrismaService, type PrismaClientLike } from '../../prisma/prisma.service';
import { RatesService } from '../rates/rates.service';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { CreateMovementDto } from './dto/create-movement.dto';
import { MovementQueryDto } from './dto/movement-query.dto';

/** Entrada del motor de stock. `tx` permite participar de una transaccion. */
export interface MovementInput {
  productId: string;
  type: StockMovementTypeT;
  /**
   * Cantidad en la unidad del producto (3 decimales: 0.1 = 100 g). Se puede
   * omitir cuando llega `inputQuantity` + `inputUnit`: en ese caso el motor la
   * convierte (2 cajas de 24 = 48 unidades).
   */
  quantity?: number;
  /** Unidad con la que el operador escribio la cantidad (CAJA, UND, KG, G, LT, ML). */
  inputUnit?: string;
  /** Cantidad escrita en `inputUnit` (la que el motor convierte a stock). */
  inputQuantity?: number;
  /** Costo unitario YA convertido a la moneda base (USD). */
  unitCost?: number;
  /** Contexto de moneda del costo unitario (lo que se escribio y con que tasa). */
  unitCostCurrency?: string;
  unitCostRate?: number | null;
  unitCostEntered?: number;
  /**
   * Precio de venta de la unidad suelta YA convertido a la moneda base (USD).
   * Solo lo usan las entradas: al ingresar mercaderia el operador puede ajustar
   * a cuanto se vende la unidad suelta al abrir la presentacion.
   */
  unitPrice?: number;
  /** Contexto de moneda del precio unitario (lo que se escribio y con que tasa). */
  unitPriceCurrency?: string;
  unitPriceRate?: number | null;
  unitPriceEntered?: number;
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly rates: RatesService,
  ) {}

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
      select: {
        id: true,
        name: true,
        stock: true,
        unit: true,
        unitsPerBox: true,
      },
    });
    if (!product) {
      throw new NotFoundException(`Producto no encontrado: ${input.productId}`);
    }

    // Cantidad en la unidad de STOCK. El operador puede escribirla en su propia
    // unidad ("2 cajas", "750 g", "1.5 L") y aqui se convierte: el inventario
    // solo se mueve en la unidad del producto.
    const typed = input.inputQuantity ?? input.quantity;
    if (typed === undefined) {
      throw new BadRequestException(
        'Indica la cantidad del movimiento (o `inputQuantity` con `inputUnit`)',
      );
    }
    const quantity = toQty(stockQuantity(typed, input.inputUnit, product));
    // Trazabilidad de lo que el operador escribio: si no lo dijo, la cantidad
    // esta en la unidad de stock (en las presentaciones, en unidades sueltas).
    const stockUnit = inputUnits(product)[0]?.value ?? 'UND';
    const inputUnit = input.inputUnit ?? stockUnit;
    const inputQuantity =
      input.inputUnit === undefined ? quantity : toQty(typed);

    const stockBefore = toQty(product.stock);
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
        // En ajustes, la cantidad representa el stock FINAL deseado.
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
        inputUnit,
        inputQuantity,
        unitCost: input.unitCost ?? null,
        unitCostCurrency: input.unitCostCurrency ?? 'USD',
        unitCostRate: input.unitCostRate ?? null,
        unitCostEntered: input.unitCostEntered ?? null,
        reason: input.reason,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        createdById: input.createdById,
      },
    });

    // updateMany + filtro por empresa: nunca se toca un producto de otra.
    // Al ingresar mercaderia se actualiza el costo de referencia del producto
    // (el unitario y el de la presentacion, que es `unitario x unidades`).
    const units = boxUnitsOf(product);
    const costUpdate =
      input.type === StockMovementType.IN && input.unitCost != null
        ? {
            unitCost: input.unitCost,
            unitCostEntered: input.unitCostEntered ?? null,
            cost: money.mul(input.unitCost, units),
            costEntered:
              input.unitCostEntered == null
                ? null
                : money.mul(input.unitCostEntered, units),
            costCurrency: input.unitCostCurrency ?? 'USD',
            costRate: input.unitCostRate ?? null,
          }
        : {};

    // El ingreso tambien puede ajustar a cuanto se vende la unidad suelta. Solo
    // se toca el precio unitario: el de la presentacion se administra por
    // separado (catalogo) y cada monto guarda su propia moneda y tasa.
    const priceUpdate =
      input.type === StockMovementType.IN && input.unitPrice != null
        ? {
            unitPrice: input.unitPrice,
            unitPriceEntered: input.unitPriceEntered ?? null,
            unitPriceCurrency: input.unitPriceCurrency ?? 'USD',
            unitPriceRate: input.unitPriceRate ?? null,
          }
        : {};

    await client.product.updateMany({
      where: { id: product.id, ...tenantWhere(companyId) },
      data: { stock: stockAfter, ...costUpdate, ...priceUpdate },
    });

    return { movement, stockBefore, stockAfter };
  }

  /**
   * Crea un movimiento a partir del DTO del endpoint: convierte el costo y el
   * precio unitarios que escribio el usuario (en su moneda) a la moneda base.
   */
  async create(companyId: string, dto: CreateMovementDto, userId?: string) {
    const { unitCost, unitCostCurrency, unitPrice, unitPriceCurrency, ...rest } =
      dto;
    const costConversion =
      unitCost === undefined
        ? null
        : await this.rates.resolveAmount(companyId, unitCost, unitCostCurrency);
    const priceConversion =
      unitPrice === undefined
        ? null
        : await this.rates.resolveAmount(
            companyId,
            unitPrice,
            unitPriceCurrency,
          );

    return this.applyMovement(companyId, {
      ...rest,
      createdById: userId,
      ...(costConversion
        ? {
            unitCost: costConversion.baseAmount,
            unitCostCurrency: costConversion.currency,
            unitCostRate: costConversion.exchangeRate,
            unitCostEntered: unitCost,
          }
        : {}),
      ...(priceConversion
        ? {
            unitPrice: priceConversion.baseAmount,
            unitPriceCurrency: priceConversion.currency,
            unitPriceRate: priceConversion.exchangeRate,
            unitPriceEntered: unitPrice,
          }
        : {}),
    });
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
      // El conteo puede venir en la unidad de stock (`newStock`) o en la unidad
      // con la que se conto (`inputQuantity` + `inputUnit`).
      quantity: dto.newStock,
      inputUnit: dto.inputUnit,
      inputQuantity: dto.inputQuantity,
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
        // Presentacion y precio de la unidad suelta: el formulario de movimientos
        // los necesita para convertir cajas <-> unidades y para mostrar a cuanto
        // se vende la unidad que se abre de la presentacion.
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
