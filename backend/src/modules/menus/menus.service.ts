import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  BASE_CURRENCY_CODE,
  normalizeCurrencyCode,
} from '../../common/constants/currencies';
import { ImageStorageService } from '../../common/media/image-storage.service';
import { buildCode } from '../../common/utils/code.util';
import { money, toMoney } from '../../common/utils/money.util';
import {
  normalizeImageUrl,
  normalizeNullableId,
} from '../../common/utils/normalize.util';
import { buildPaginatedResult } from '../../common/utils/pagination.util';
import { toQty, toQtyMilli } from '../../common/utils/quantity.util';
import type { PrismaClientLike } from '../../prisma/prisma.service';
import { RatesService } from '../rates/rates.service';
import { CreateMenuDto, MenuIngredientDto } from './dto/menu.dto';
import { MenuQueryDto } from './dto/menu-query.dto';
import { UpdateMenuDto } from './dto/update-menu.dto';
import { MenusRepository } from './menus.repository';

/** Receta resuelta: lo que necesita el motor de pedidos para vender un menu. */
export interface MenuRecipe {
  id: string;
  code: string;
  name: string;
  price: number;
  active: boolean;
  ingredients: {
    productId: string;
    quantity: number;
    /** Nombre del producto (para los avisos de validacion). */
    productName?: string;
    /** `false` cuando el producto se desactivo despues de armar la receta. */
    active?: boolean;
  }[];
}

/** Receta resuelta y validada antes de guardarla. */
interface ResolvedIngredient {
  productId: string;
  quantity: number;
  section: string;
  note?: string | null;
  sortOrder: number;
  /** Costo del producto al momento de costear (decimal). */
  unitCost: number;
}

interface RecipeLike {
  quantity: number;
  product: {
    /** Datos para el aviso de "ingrediente inactivo" (siempre vienen del API). */
    id?: string;
    name?: string;
    trackStock: boolean;
    stock: number;
    /** `false` = producto desactivado despues de armar la receta. */
    active?: boolean;
  } | null;
}

/**
 * Unidades completas que se pueden preparar con el stock actual del inventario.
 *
 * Es el minimo entre los ingredientes controlados (`stock / cantidad`); `null`
 * cuando ningun ingrediente lleva control de inventario (no hay tope). El calculo
 * se hace en milesimas para no perder unidades por la deriva del punto flotante
 * (0.9 kg / 0.1 kg deben dar 9, no 8).
 */
export function servingsAvailable(ingredients: RecipeLike[]): number | null {
  let max: number | null = null;
  for (const ingredient of ingredients) {
    if (!ingredient.product?.trackStock) continue;
    const needed = toQtyMilli(ingredient.quantity);
    if (needed <= 0) continue;
    const units = Math.floor(toQtyMilli(ingredient.product.stock) / needed);
    max = max === null ? units : Math.min(max, units);
  }
  return max;
}

/**
 * Ingredientes cuyo producto fue DESACTIVADO despues de armar la receta.
 *
 * Mientras sigan en la receta el menu no se puede vender: el motor de pedidos
 * rechaza la venta y el POS lo muestra bloqueado. Se listan para que la
 * interfaz explique el motivo (en vez de un "agotado" sin salida).
 */
export function inactiveIngredientRefs(
  ingredients: RecipeLike[],
): { id: string; name: string }[] {
  const refs: { id: string; name: string }[] = [];
  for (const line of ingredients) {
    const product = line.product;
    if (!product || product.active !== false) continue;
    refs.push({
      id: product.id ?? product.name ?? `producto-${refs.length + 1}`,
      name: product.name ?? 'Producto',
    });
  }
  return refs;
}

@Injectable()
export class MenusService {
  constructor(
    private readonly menus: MenusRepository,
    private readonly rates: RatesService,
    @Optional() private readonly images?: ImageStorageService,
  ) {}

  // =========================================================================
  //  CRUD
  // =========================================================================

  async create(companyId: string, dto: CreateMenuDto) {
    const code = dto.code?.trim() || (await this.generateCode(companyId));
    await this.assertCodeAvailable(companyId, code);
    await this.assertCategoryInCompany(companyId, dto.categoryId);

    const ingredients = await this.resolveIngredients(
      companyId,
      dto.ingredients ?? [],
    );
    const price = await this.priceColumns(companyId, dto.price, dto.priceCurrency);
    const ingredientRows = this.ingredientRows(ingredients);

    const menu = await this.menus.create({
      companyId,
      code,
      name: dto.name.trim(),
      description: dto.description,
      // Foto local en `private/img/<rif>/menu`; en la fila queda `/media/...`.
      imageUrl: await this.persistImage(companyId, dto.imageUrl),
      price: price.base,
      priceCurrency: price.currency,
      priceRate: price.rate,
      priceEntered: price.entered,
      cost: this.recipeCost(ingredients),
      availability: dto.availability ?? 'ALL',
      preparationMinutes: dto.preparationMinutes ?? null,
      categoryId: normalizeNullableId(dto.categoryId),
      active: dto.active ?? true,
      // Un menu sin receta no crea lineas: no descuenta inventario.
      ...(ingredientRows.length > 0
        ? {
            ingredients: {
              create: ingredientRows.map((row) => ({ companyId, ...row })),
            },
          }
        : {}),
    });

    return this.decorate(menu);
  }

  async findAll(companyId: string, query: MenuQueryDto) {
    // Elegir una categoria principal tambien trae lo agrupado en sus subcategorias.
    const categoryIds = query.categoryId
      ? await this.menus.findCategoryScopeIds(companyId, query.categoryId)
      : undefined;

    const { items: rows, total } = await this.menus.findPage(
      companyId,
      query,
      categoryIds,
    );

    const items = rows.map((row) => this.decorate(row));
    const visible = query.onlyAvailable
      ? items.filter((menu) => menu.available)
      : items;

    return buildPaginatedResult(visible, total, query.page, query.limit);
  }

  /** Menus activos listos para vender (grilla del POS y buscador de pedidos). */
  async findOptions(companyId: string) {
    const menus = await this.menus.findOptions(companyId);
    return menus.map((menu) => this.decorate(menu));
  }

  async findOne(companyId: string, id: string) {
    const menu = await this.menus.findDetail(companyId, id);
    if (!menu) throw new NotFoundException('Menu no encontrado');
    return this.decorate(menu);
  }

  /**
   * Actualiza la ficha del menu. Si llega `ingredients` se REEMPLAZA la receta
   * completa (y se recalcula el costo); si se omite, la receta se conserva.
   */
  async update(companyId: string, id: string, dto: UpdateMenuDto) {
    const current = await this.menus.findCurrent(companyId, id);
    if (!current) throw new NotFoundException('Menu no encontrado');

    const code = dto.code?.trim();
    if (code && code !== current.code) {
      await this.assertCodeAvailable(companyId, code, id);
    }
    if (dto.categoryId !== undefined) {
      await this.assertCategoryInCompany(companyId, dto.categoryId);
    }

    const ingredients = dto.ingredients
      ? await this.resolveIngredients(companyId, dto.ingredients)
      : null;
    const price =
      dto.price !== undefined || dto.priceCurrency !== undefined
        ? await this.priceColumns(
            companyId,
            dto.price,
            dto.priceCurrency ?? current.priceCurrency,
            current.price,
          )
        : null;

    await this.menus.transaction(async (tx) => {
      await this.menus.updateMenu(
        companyId,
        id,
        {
          ...(code ? { code } : {}),
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.imageUrl !== undefined
            ? { imageUrl: await this.persistImage(companyId, dto.imageUrl) }
            : {}),
          ...(price
            ? {
                price: price.base,
                priceCurrency: price.currency,
                priceRate: price.rate,
                priceEntered: price.entered,
              }
            : {}),
          ...(dto.availability !== undefined
            ? { availability: dto.availability }
            : {}),
          ...(dto.preparationMinutes !== undefined
            ? { preparationMinutes: dto.preparationMinutes ?? null }
            : {}),
          ...(dto.categoryId !== undefined
            ? { categoryId: normalizeNullableId(dto.categoryId) }
            : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
          ...(ingredients ? { cost: this.recipeCost(ingredients) } : {}),
        },
        tx,
      );

      if (ingredients) {
        // Enviar la receta (aunque venga vacia) la reemplaza: se borran las
        // lineas actuales y, si queda algo, se vuelve a crear. Con `[]` el menu
        // queda sin receta (no descuenta inventario).
        await this.menus.replaceIngredients(
          companyId,
          id,
          this.ingredientRows(ingredients),
          tx,
        );
      }
    });

    return this.findOne(companyId, id);
  }

  /**
   * Baja logica: los menus vendidos quedan referenciados por los pedidos, asi
   * que no se borran fisicamente (se desactivan y dejan de ofrecerse).
   */
  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    return this.menus.deactivate(companyId, id);
  }

  // =========================================================================
  //  INTEGRACION CON PEDIDOS (receta -> consumo de inventario)
  // =========================================================================

  /**
   * Recetas de los menus indicados, listas para expandir el consumo. Solo trae
   * los menus de la empresa activa; los ids ausentes los reporta el llamador.
   */
  async loadRecipes(
    companyId: string,
    menuIds: string[],
    tx?: PrismaClientLike,
  ): Promise<Map<string, MenuRecipe>> {
    const unique = [...new Set(menuIds)];
    if (unique.length === 0) return new Map();

    const menus = await this.menus.findRecipes(companyId, unique, tx);

    return new Map(
      menus.map((menu) => [
        menu.id,
        {
          id: menu.id,
          code: menu.code,
          name: menu.name,
          price: menu.price,
          active: menu.active,
          ingredients: menu.ingredients.map((ingredient) => ({
            productId: ingredient.productId,
            quantity: ingredient.quantity,
            productName: ingredient.product?.name,
            active: ingredient.product?.active ?? true,
          })),
        } satisfies MenuRecipe,
      ]),
    );
  }

  // =========================================================================
  //  AYUDAS INTERNAS
  // =========================================================================

  /**
   * Normaliza la URL de la foto ya subida por multipart. Sin
   * `ImageStorageService` (pruebas unitarias aisladas) se conserva el valor
   * normalizado, igual que antes.
   */
  private persistImage(
    companyId: string,
    value: string | null | undefined,
  ): Promise<string | null> {
    return this.images
      ? this.images.persist(companyId, 'menu', value)
      : Promise.resolve(normalizeImageUrl(value));
  }

  /**
   * Contexto de moneda del precio del menu: `base` en USD (lo que usan POS y
   * reportes), `entered` (lo que escribio el usuario) y `rate` (bolivares por 1
   * unidad de la moneda). Cuando solo cambia la moneda (`amount` ausente) se
   * conserva el valor en USD ya guardado.
   */
  private async priceColumns(
    companyId: string,
    amount: number | undefined,
    currency?: string | null,
    currentBase?: number,
  ): Promise<{
    currency: string;
    base: number;
    entered: number;
    rate: number | null;
  }> {
    const code = normalizeCurrencyCode(currency) || BASE_CURRENCY_CODE;

    if (amount === undefined) {
      const base = toMoney(currentBase ?? 0);
      return {
        currency: code,
        base,
        entered: await this.rates.toCurrencyAmount(companyId, base, code),
        rate: (await this.rates.resolveAmount(companyId, 1, code)).exchangeRate,
      };
    }

    const entered = toMoney(amount);
    const conversion = await this.rates.resolveAmount(companyId, entered, code);
    return {
      currency: conversion.currency,
      base: conversion.baseAmount,
      entered,
      rate: conversion.exchangeRate,
    };
  }

  /** Suma el costo de la receta (costo del producto x cantidad) en moneda base. */
  private recipeCost(ingredients: ResolvedIngredient[]): number {
    return money.sum(
      ingredients.map((ingredient) =>
        money.mul(ingredient.unitCost, ingredient.quantity),
      ),
    );
  }

  /** Filas de la receta (sin menuId: lo agrega el llamador segun el contexto). */
  private ingredientRows(ingredients: ResolvedIngredient[]) {
    return ingredients.map((ingredient) => ({
      productId: ingredient.productId,
      quantity: ingredient.quantity,
      section: ingredient.section,
      note: ingredient.note ?? null,
      sortOrder: ingredient.sortOrder,
    }));
  }

  /**
   * Valida la receta contra los productos de la empresa: deben existir y estar
   * activos, no pueden repetirse y la cantidad debe ser mayor a 0. La cantidad se
   * normaliza a 3 decimales (misma unidad en la que se lleva el stock).
   */
  private async resolveIngredients(
    companyId: string,
    lines: MenuIngredientDto[],
  ): Promise<ResolvedIngredient[]> {
    // La receta es opcional: sin ingredientes el menu no descuenta inventario.
    if (lines.length === 0) return [];

    const productIds = [...new Set(lines.map((line) => line.productId))];
    if (productIds.length !== lines.length) {
      throw new BadRequestException(
        'Un producto no puede repetirse en la receta del menu',
      );
    }

    const products = await this.menus.findRecipeProducts(companyId, productIds);

    const byId = new Map(products.map((product) => [product.id, product]));
    const missing = productIds.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Producto(s) no encontrado(s) en la receta: ${missing.join(', ')}`,
      );
    }

    return lines.map((line, index) => {
      const product = byId.get(line.productId)!;
      if (!product.active) {
        throw new BadRequestException(
          `El producto "${product.name}" esta inactivo y no puede usarse en una receta`,
        );
      }
      const quantity = toQty(line.quantity);
      if (quantity <= 0) {
        throw new BadRequestException(
          `La cantidad de "${product.name}" debe ser mayor a 0`,
        );
      }
      return {
        productId: product.id,
        quantity,
        section: line.section ?? 'Principal',
        note: line.note ?? null,
        sortOrder: line.sortOrder ?? index,
        unitCost: product.cost,
      };
    });
  }

  /**
   * Agrega los datos calculados que consume la interfaz: margen (precio - costo),
   * unidades preparables con el stock actual y si el menu se puede vender ahora.
   */
  private decorate<
    T extends {
      price: number;
      cost: number;
      ingredients: RecipeLike[];
    },
  >(menu: T) {
    const maxServings = servingsAvailable(menu.ingredients);
    // Un ingrediente desactivado deja el menu invendible: se avisa cual es para
    // que se corrija la receta en vez de fallar al cobrar.
    const inactiveIngredients = inactiveIngredientRefs(menu.ingredients);
    return {
      ...menu,
      margin: money.sub(menu.price, menu.cost),
      maxServings,
      inactiveIngredients,
      available:
        inactiveIngredients.length === 0 &&
        (maxServings === null || maxServings > 0),
    };
  }

  /** El codigo de menu es unico por empresa (no global). */
  private async assertCodeAvailable(
    companyId: string,
    code: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.menus.findCodeOwner(companyId, code, excludeId);
    if (existing) {
      throw new ConflictException(
        'Ya existe un menu con ese codigo en esta empresa',
      );
    }
  }

  /** La categoria de menu enlazada debe pertenecer a la empresa activa. */
  private async assertCategoryInCompany(
    companyId: string,
    categoryId?: string | null,
  ): Promise<void> {
    const id = normalizeNullableId(categoryId);
    if (!id) return;
    const category = await this.menus.findCategoryRef(companyId, id);
    if (!category) {
      throw new BadRequestException('La categoria de menu indicada no existe');
    }
  }

  /**
   * Ids que abarca el filtro de categoria de menu: la categoria elegida y sus
   * subcategorias (un solo nivel), para que filtrar por "Almuerzos" incluya lo
   * agrupado en "Sopas".
   */
  private async categoryScopeIds(
    companyId: string,
    categoryId: string,
  ): Promise<string[]> {
    return this.menus.findCategoryScopeIds(companyId, categoryId);
  }

  /** Codigo legible y unico por empresa: MEN-YYYYMMDD-NNNN. */
  private async generateCode(companyId: string): Promise<string> {
    const total = await this.menus.countMenus(companyId);

    for (let attempt = 0; attempt < 50; attempt += 1) {
      const candidate = buildCode('MEN', total + 1 + attempt);
      const exists = await this.menus.findCodeOwner(companyId, candidate);
      if (!exists) return candidate;
    }
    throw new BadRequestException('No se pudo generar un codigo de menu unico');
  }
}
