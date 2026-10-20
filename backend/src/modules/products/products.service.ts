import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  BASE_CURRENCY_CODE,
  normalizeCurrencyCode,
} from '../../common/constants/currencies';
import { StockMovementType } from '../../common/constants/enums';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { buildPaginatedResult } from '../../common/utils/pagination.util';
import { money, toMoney } from '../../common/utils/money.util';
import { normalizeImageUrl, normalizeNullableId } from '../../common/utils/normalize.util';
import { boxUnitsOf } from '../../common/utils/packaging.util';
import { toQty } from '../../common/utils/quantity.util';
import { InventoryService } from '../inventory/inventory.service';
import { RatesService, normalizeRateKey } from '../rates/rates.service';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductQueryDto } from './dto/product-query.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsRepository } from './products.repository';

@Injectable()
export class ProductsService {
  constructor(
    private readonly products: ProductsRepository,
    private readonly inventory: InventoryService,
    private readonly rates: RatesService,
  ) {}

  async create(companyId: string, dto: CreateProductDto, userId?: string) {
    const {
      stock,
      categoryId,
      supplierId,
      sku,
      imageUrl,
      price,
      priceCurrency,
      priceRateKey,
      cost,
      costCurrency,
      costRateKey,
      unitCost,
      unitCostCurrency,
      unitCostRateKey,
      unitPrice,
      unitPriceCurrency,
      unitPriceRateKey,
      unitsPerBox,
      ...rest
    } = dto;

    const units = boxUnitsOf({ unitsPerBox: unitsPerBox ?? 1 });
    // Precios en la moneda elegida -> columnas en USD + contexto de la moneda y
    // de la tasa elegida para ESE monto.
    const priceData = await this.convertAmount({
      companyId,
      amount: price,
      currency: priceCurrency,
      rateKey: priceRateKey,
    });
    const costData = await this.convertAmount({
      companyId,
      amount: cost ?? 0,
      currency: costCurrency ?? priceCurrency,
      rateKey: costRateKey,
    });
    // El costo unitario se escribe en SU propia moneda (no la del costo de la
    // presentacion) y con SU propia tasa: si no se indica la moneda, se asume la
    // de la presentacion.
    const unitCostData =
      unitCost !== undefined
        ? await this.convertAmount({
            companyId,
            amount: unitCost,
            currency: unitCostCurrency ?? costCurrency ?? priceCurrency,
            rateKey: unitCostRateKey,
          })
        : {
            currency: costData.currency,
            entered: money.div(costData.entered, units),
            base: money.div(costData.base, units),
            rate: costData.rate,
            rateKey: costData.rateKey,
          };
    // PRECIO DE VENTA de la unidad suelta: es independiente del precio de la
    // presentacion y tiene su propia moneda/tasa (si no se indica la moneda, se
    // asume la del precio). 0 = sin definir: la interfaz reparte
    // `price / unitsPerBox`, asi los productos que no lo traen no cambian.
    const unitPriceData = await this.convertAmount({
      companyId,
      amount: unitPrice ?? 0,
      currency: unitPriceCurrency ?? priceCurrency,
      rateKey: unitPriceRateKey,
    });

    const finalSku = sku?.trim() || (await this.generateSku(companyId, dto.name));
    await this.assertSkuAvailable(companyId, finalSku);
    await this.assertRelationsInCompany(companyId, categoryId, supplierId);

    const product = await this.products.create({
      ...rest,
      companyId,
      sku: finalSku,
      price: priceData.base,
      priceCurrency: priceData.currency,
      priceRate: priceData.rate,
      priceRateKey: priceData.rateKey,
      priceEntered: priceData.entered,
      cost: costData.base,
      costCurrency: costData.currency,
      costRate: costData.rate,
      costRateKey: costData.rateKey,
      costEntered: costData.entered,
      unitCost: unitCostData.base,
      unitCostEntered: unitCostData.entered,
      unitCostCurrency: unitCostData.currency,
      unitCostRate: unitCostData.rate,
      unitCostRateKey: unitCostData.rateKey,
      unitPrice: unitPriceData.base,
      unitPriceEntered: unitPriceData.entered,
      unitPriceCurrency: unitPriceData.currency,
      unitPriceRate: unitPriceData.rate,
      unitPriceRateKey: unitPriceData.rateKey,
      stock: 0,
      minStock: toQty(dto.minStock ?? 0),
      unit: dto.unit ?? 'UND',
      unitsPerBox: units,
      trackStock: dto.trackStock ?? true,
      active: dto.active ?? true,
      imageUrl: normalizeImageUrl(imageUrl),
      categoryId: normalizeNullableId(categoryId),
      supplierId: normalizeNullableId(supplierId),
    });

    // Stock inicial => movimiento de inventario trazable (siempre en la empresa).
    // Se valora con el costo UNITARIO porque el stock se lleva en unidades
    // sueltas (una caja de 24 deja 24 unidades en el inventario).
    if (stock && stock > 0) {
      await this.inventory.applyMovement(companyId, {
        productId: product.id,
        type: StockMovementType.IN,
        quantity: stock,
        unitCost: unitCostData.base,
        reason: 'Stock inicial',
        referenceType: 'INITIAL',
        createdById: userId,
      });
    }

    return this.findOne(companyId, product.id);
  }

  async findAll(companyId: string, query: ProductQueryDto) {
    // Elegir una categoria principal tambien trae lo agrupado en sus subcategorias.
    const categoryIds = query.categoryId
      ? await this.categoryScopeIds(companyId, query.categoryId)
      : undefined;

    const { items, total } = await this.products.findPage(
      companyId,
      query,
      categoryIds,
    );

    return buildPaginatedResult(items, total, query.page, query.limit);
  }

  /**
   * Ids que abarca el filtro de categoria: la categoria elegida y sus
   * subcategorias (un solo nivel), para que filtrar por "Bebidas" incluya lo que
   * esta agrupado en "Refrescos".
   */
  private categoryScopeIds(
    companyId: string,
    categoryId: string,
  ): Promise<string[]> {
    return this.products.categoryScopeIds(companyId, categoryId);
  }

  /** Productos activos para selects y para la grilla del POS (punto de venta). */
  findOptions(companyId: string) {
    return this.products.findOptions(companyId);
  }

  async findOne(companyId: string, id: string) {
    const product = await this.products.findOne(companyId, id);
    if (!product) throw new NotFoundException('Producto no encontrado');
    return product;
  }

  async update(companyId: string, id: string, dto: UpdateProductDto) {
    const current = await this.findOne(companyId, id);
    const {
      categoryId,
      supplierId,
      sku,
      imageUrl,
      price,
      priceCurrency,
      priceRateKey,
      cost,
      costCurrency,
      costRateKey,
      unitCost,
      unitCostCurrency,
      unitCostRateKey,
      unitPrice,
      unitPriceCurrency,
      unitPriceRateKey,
      unitsPerBox,
      ...rest
    } = dto;

    if (sku !== undefined && sku.trim()) {
      await this.assertSkuAvailable(companyId, sku.trim(), id);
    }
    await this.assertRelationsInCompany(companyId, categoryId, supplierId);

    // Valores vigentes de la presentacion: lo que llega en el DTO o lo guardado.
    const units = boxUnitsOf({ unitsPerBox: unitsPerBox ?? current.unitsPerBox });
    const priceCode = priceCurrency ?? current.priceCurrency;
    const costCode = costCurrency ?? current.costCurrency ?? priceCode;
    // El costo unitario tiene su PROPIA moneda: la del DTO, la guardada o (si el
    // producto es anterior a esa columna) la del costo de la presentacion.
    const unitCostCode =
      unitCostCurrency ?? current.unitCostCurrency ?? costCode;
    // El precio de venta de la unidad suelta tambien tiene su PROPIA moneda: la
    // del DTO, la guardada o (si el producto es anterior a esa columna) la del
    // precio de la presentacion.
    const unitPriceCode =
      unitPriceCurrency ?? current.unitPriceCurrency ?? priceCode;
    const pricing: Prisma.ProductUpdateInput = {};

    // Cambiar el monto, la moneda O la tasa obliga a recalcular el equivalente en
    // USD: la tasa elegida es la que hace la conversion.
    if (
      price !== undefined ||
      priceCurrency !== undefined ||
      priceRateKey !== undefined
    ) {
      const converted = await this.convertAmount({
        companyId,
        amount: price,
        currency: priceCode,
        currentBase: current.price,
        rateKey: priceRateKey,
        currentRateKey: current.priceRateKey,
      });
      pricing.priceCurrency = converted.currency;
      pricing.priceRate = converted.rate;
      pricing.priceRateKey = converted.rateKey;
      pricing.price = converted.base;
      pricing.priceEntered = converted.entered;
    }

    const costData =
      cost !== undefined || costCurrency !== undefined || costRateKey !== undefined
        ? await this.convertAmount({
            companyId,
            amount: cost,
            currency: costCode,
            currentBase: current.cost,
            rateKey: costRateKey,
            currentRateKey: current.costRateKey,
          })
        : null;
    if (costData) {
      pricing.costCurrency = costData.currency;
      pricing.costRate = costData.rate;
      pricing.costRateKey = costData.rateKey;
      pricing.cost = costData.base;
      pricing.costEntered = costData.entered;
    }

    if (unitCost !== undefined || unitCostRateKey !== undefined) {
      const converted = await this.convertAmount({
        companyId,
        amount: unitCost,
        currency: unitCostCode,
        currentBase: current.unitCost,
        rateKey: unitCostRateKey,
        currentRateKey: current.unitCostRateKey,
      });
      pricing.unitCost = converted.base;
      pricing.unitCostEntered = converted.entered;
      pricing.unitCostCurrency = converted.currency;
      pricing.unitCostRate = converted.rate;
      pricing.unitCostRateKey = converted.rateKey;
      // Si el operador SOLO mando el MONTO del costo unitario, la presentacion se
      // deriva en la misma moneda y a la misma tasa (asi `costo de la caja =
      // unitario x unidades` sigue siendo coherente). Cuando el formulario manda
      // los dos montos, este bloque no se ejecuta: cada campo conserva lo que
      // escribio el operador. Cambiar solo la TASA del unitario tampoco lo
      // dispara: re-expresa ese monto sin reinterpretar la presentacion.
      if (unitCost !== undefined && cost === undefined) {
        pricing.cost = money.mul(converted.base, units);
        pricing.costEntered = money.mul(converted.entered, units);
        pricing.costCurrency = converted.currency;
        pricing.costRate = converted.rate;
        pricing.costRateKey = converted.rateKey;
      }
    } else if (costData || unitsPerBox !== undefined) {
      // Sin costo unitario explicito: se reparte el costo de la presentacion, en la
      // moneda y con la tasa del costo de la presentacion.
      const canonicalCost = costData ? costData.base : current.cost;
      const derivedCode = costData ? costData.currency : unitCostCode;
      const derivedRateKey = costData ? costData.rateKey : current.costRateKey;
      const enteredCost = costData
        ? costData.entered
        : await this.rates.toCurrencyAmount(
            companyId,
            current.cost,
            derivedCode,
            derivedRateKey,
          );
      pricing.unitCost = money.div(canonicalCost, units);
      pricing.unitCostEntered = money.div(enteredCost, units);
      pricing.unitCostCurrency = derivedCode;
      pricing.unitCostRateKey = derivedRateKey;
      pricing.unitCostRate = costData
        ? costData.rate
        : (
            await this.rates.resolveAmount(
              companyId,
              1,
              derivedCode,
              derivedRateKey,
            )
          ).exchangeRate;
    }

    // PRECIO DE VENTA de la unidad suelta: monto independiente del de la
    // presentacion, con su propia moneda y tasa. El formulario lo reenvia tal
    // como se ve (0 = sin definir), de modo que al dejar de ser una presentacion
    // la columna queda limpia y la interfaz vuelve a repartir `price/unitsPerBox`.
    if (
      unitPrice !== undefined ||
      unitPriceCurrency !== undefined ||
      unitPriceRateKey !== undefined
    ) {
      const converted = await this.convertAmount({
        companyId,
        amount: unitPrice,
        currency: unitPriceCode,
        currentBase: current.unitPrice,
        rateKey: unitPriceRateKey,
        currentRateKey: current.unitPriceRateKey,
      });
      pricing.unitPrice = converted.base;
      pricing.unitPriceEntered = converted.entered;
      pricing.unitPriceCurrency = converted.currency;
      pricing.unitPriceRate = converted.rate;
      pricing.unitPriceRateKey = converted.rateKey;
    }

    const data: Prisma.ProductUpdateInput = {
      ...rest,
      ...pricing,
      // Las existencias se normalizan a 3 decimales (misma regla que el motor de
      // inventario) aunque el campo no sea dinero.
      ...(rest.minStock !== undefined ? { minStock: toQty(rest.minStock) } : {}),
      ...(unitsPerBox !== undefined ? { unitsPerBox: units } : {}),
      ...(imageUrl !== undefined ? { imageUrl: normalizeImageUrl(imageUrl) } : {}),
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
    await this.products.update(companyId, id, data);
    return this.findOne(companyId, id);
  }

  /**
   * Baja logica del producto: no se borra porque los pedidos y las recetas lo
   * referencian.
   *
   * Si algun menu ACTIVO lo usa como ingrediente, ese menu queda sin poder
   * venderse (su receta tiene un producto inactivo): se devuelve la lista en
   * `affectedMenus` para que la interfaz lo avise y se corrija la receta.
   */
  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);

    const affectedMenus = await this.products.findActiveMenusUsing(
      companyId,
      id,
    );

    const result = await this.products.deactivate(companyId, id);

    return {
      ...result,
      affectedMenus,
    };
  }

  /**
   * Contexto de moneda de un precio/costo del catalogo.
   *
   * Con `amount` (lo que escribio el usuario, en `currency`) devuelve su
   * equivalente en USD (`base`), el monto tal como se escribio (`entered`) y la
   * tasa aplicada (`rate`, bolivares por 1 unidad). Cuando solo cambia la moneda
   * (`amount` ausente) se conserva el valor en USD (`currentBase`) y se vuelve a
   * expresar en la moneda nueva, para no perder el precio ya guardado.
   *
   * `rateKey` es la TASA elegida por el operador para ESE monto (`BCV_USD`,
   * `BCV_EUR` o `CUSTOM_USD`): es la que se usa como puente bolivares -> USD y la
   * que se guarda, para que al reabrir el formulario la conversion sea la misma.
   * Cada monto tiene la suya (precio, costo de la presentacion y costo unitario
   * son independientes); si no llega ninguna se conserva la guardada y, si el
   * producto tampoco tiene, se usa la activa del sistema.
   */
  private async convertAmount(input: {
    companyId: string;
    /** Lo que escribio el operador, en `currency` (ausente = solo cambio de moneda). */
    amount?: number;
    currency?: string | null;
    /** Valor en USD ya guardado (se usa cuando `amount` no viene). */
    currentBase?: number;
    /** Tasa elegida en el DTO. */
    rateKey?: string | null;
    /** Tasa guardada en el producto. */
    currentRateKey?: string | null;
  }): Promise<{
    currency: string;
    base: number;
    entered: number;
    rate: number | null;
    rateKey: string | null;
  }> {
    const { companyId, amount, currentBase } = input;
    const code = normalizeCurrencyCode(input.currency) || BASE_CURRENCY_CODE;
    const rateKey =
      normalizeRateKey(input.rateKey) ?? normalizeRateKey(input.currentRateKey);

    if (amount === undefined) {
      const base = toMoney(currentBase ?? 0);
      return {
        currency: code,
        base,
        entered: await this.rates.toCurrencyAmount(companyId, base, code, rateKey),
        rate: (await this.rates.resolveAmount(companyId, 1, code, rateKey))
          .exchangeRate,
        rateKey,
      };
    }

    const entered = toMoney(amount);
    const conversion = await this.rates.resolveAmount(
      companyId,
      entered,
      code,
      rateKey,
    );
    return {
      currency: conversion.currency,
      base: conversion.baseAmount,
      entered,
      rate: conversion.exchangeRate,
      rateKey,
    };
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
      const exists = await this.products.findSku(companyId, candidate);
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
    const existing = await this.products.findSku(companyId, sku, excludeId);
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
      const category = await this.products.findCategory(companyId, categoryId);
      if (!category) {
        throw new BadRequestException('La categoria indicada no existe');
      }
    }
    if (supplierId) {
      const supplier = await this.products.findSupplier(companyId, supplierId);
      if (!supplier) {
        throw new BadRequestException('El proveedor indicado no existe');
      }
    }
  }
}
