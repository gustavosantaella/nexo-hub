import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { buildCode } from '../../common/utils/code.util';
import { money, toMoney } from '../../common/utils/money.util';
import {
  normalizeImageUrl,
  normalizeNullableId,
} from '../../common/utils/normalize.util';
import { buildPaginatedResult, toSkip } from '../../common/utils/pagination.util';
import { toQty, toQtyMilli } from '../../common/utils/quantity.util';
import { tenantWhere } from '../../common/utils/tenant.util';
import { PrismaService, type PrismaClientLike } from '../../prisma/prisma.service';
import { CreateMenuDto, MenuIngredientDto } from './dto/menu.dto';
import { MenuQueryDto } from './dto/menu-query.dto';
import { UpdateMenuDto } from './dto/update-menu.dto';

/** Datos del producto que la receta necesita para costear y medir disponibilidad. */
const INGREDIENT_PRODUCT_SELECT = {
  id: true,
  name: true,
  sku: true,
  unit: true,
  price: true,
  cost: true,
  stock: true,
  trackStock: true,
} satisfies Prisma.ProductSelect;

const INGREDIENT_INCLUDE = {
  product: { select: INGREDIENT_PRODUCT_SELECT },
} satisfies Prisma.MenuIngredientInclude;

/** Detalle completo de un menu: receta con su producto y la categoria. */
const MENU_DETAIL_INCLUDE = {
  category: { select: { id: true, name: true, color: true } },
  ingredients: {
    include: INGREDIENT_INCLUDE,
    orderBy: { sortOrder: 'asc' },
  },
} satisfies Prisma.MenuInclude;

/** Listado: receta minima para calcular disponibilidad sin traer todo. */
const MENU_LIST_INCLUDE = {
  category: { select: { id: true, name: true, color: true } },
  ingredients: {
    select: {
      quantity: true,
      section: true,
      product: { select: { id: true, name: true, stock: true, trackStock: true } },
    },
  },
} satisfies Prisma.MenuInclude;

/** Opciones para el POS / pedidos: catalogo vendible con su receta. */
const MENU_OPTION_SELECT = {
  id: true,
  code: true,
  name: true,
  description: true,
  imageUrl: true,
  price: true,
  cost: true,
  availability: true,
  preparationMinutes: true,
  categoryId: true,
  category: { select: { id: true, name: true, color: true } },
  ingredients: {
    select: {
      quantity: true,
      section: true,
      product: {
        select: { id: true, name: true, unit: true, stock: true, trackStock: true },
      },
    },
  },
} satisfies Prisma.MenuSelect;

/** Receta resuelta: lo que necesita el motor de pedidos para vender un menu. */
export interface MenuRecipe {
  id: string;
  code: string;
  name: string;
  price: number;
  active: boolean;
  ingredients: { productId: string; quantity: number }[];
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
  product: { trackStock: boolean; stock: number } | null;
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

@Injectable()
export class MenusService {
  constructor(private readonly prisma: PrismaService) {}

  // =========================================================================
  //  CRUD
  // =========================================================================

  async create(companyId: string, dto: CreateMenuDto) {
    const code = dto.code?.trim() || (await this.generateCode(companyId));
    await this.assertCodeAvailable(companyId, code);
    await this.assertCategoryInCompany(companyId, dto.categoryId);

    const ingredients = await this.resolveIngredients(companyId, dto.ingredients);

    const menu = await this.prisma.menu.create({
      data: {
        companyId,
        code,
        name: dto.name.trim(),
        description: dto.description,
        imageUrl: normalizeImageUrl(dto.imageUrl),
        price: toMoney(dto.price),
        cost: this.recipeCost(ingredients),
        availability: dto.availability ?? 'ALL',
        preparationMinutes: dto.preparationMinutes ?? null,
        categoryId: normalizeNullableId(dto.categoryId),
        active: dto.active ?? true,
        ingredients: {
          create: this.ingredientRows(ingredients).map((row) => ({
            companyId,
            ...row,
          })),
        },
      },
      include: MENU_DETAIL_INCLUDE,
    });

    return this.decorate(menu);
  }

  async findAll(companyId: string, query: MenuQueryDto) {
    const where: Prisma.MenuWhereInput = {
      ...tenantWhere(companyId),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search } },
              { code: { contains: query.search } },
              { description: { contains: query.search } },
            ],
          }
        : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.onlyActive ? { active: true } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.menu.findMany({
        where,
        include: MENU_LIST_INCLUDE,
        orderBy: query.toOrderBy(['name', 'price', 'createdAt'], { name: 'asc' }),
        skip: toSkip(query.page, query.limit),
        take: query.limit,
      }),
      this.prisma.menu.count({ where }),
    ]);

    const items = rows.map((row) => this.decorate(row));
    const visible = query.onlyAvailable
      ? items.filter((menu) => menu.available)
      : items;

    return buildPaginatedResult(visible, total, query.page, query.limit);
  }

  /** Menus activos listos para vender (grilla del POS y buscador de pedidos). */
  async findOptions(companyId: string) {
    const menus = await this.prisma.menu.findMany({
      where: { active: true, ...tenantWhere(companyId) },
      select: MENU_OPTION_SELECT,
      orderBy: [{ name: 'asc' }],
    });
    return menus.map((menu) => this.decorate(menu));
  }

  async findOne(companyId: string, id: string) {
    const menu = await this.prisma.menu.findFirst({
      where: { id, ...tenantWhere(companyId) },
      include: MENU_DETAIL_INCLUDE,
    });
    if (!menu) throw new NotFoundException('Menu no encontrado');
    return this.decorate(menu);
  }

  /**
   * Actualiza la ficha del menu. Si llega `ingredients` se REEMPLAZA la receta
   * completa (y se recalcula el costo); si se omite, la receta se conserva.
   */
  async update(companyId: string, id: string, dto: UpdateMenuDto) {
    const current = await this.prisma.menu.findFirst({
      where: { id, ...tenantWhere(companyId) },
    });
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

    await this.prisma.$transaction(async (tx) => {
      await tx.menu.update({
        where: { id, ...tenantWhere(companyId) },
        data: {
          ...(code ? { code } : {}),
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.imageUrl !== undefined
            ? { imageUrl: normalizeImageUrl(dto.imageUrl) }
            : {}),
          ...(dto.price !== undefined ? { price: toMoney(dto.price) } : {}),
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
      });

      if (ingredients) {
        await tx.menuIngredient.deleteMany({
          where: { menuId: id, ...tenantWhere(companyId) },
        });
        await tx.menuIngredient.createMany({
          data: this.ingredientRows(ingredients).map((row) => ({
            companyId,
            menuId: id,
            ...row,
          })),
        });
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
    return this.prisma.menu.updateMany({
      where: { id, ...tenantWhere(companyId) },
      data: { active: false },
    });
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

    const client = tx ?? this.prisma;
    const menus = await client.menu.findMany({
      where: { id: { in: unique }, ...tenantWhere(companyId) },
      select: {
        id: true,
        code: true,
        name: true,
        price: true,
        active: true,
        ingredients: { select: { productId: true, quantity: true } },
      },
    });

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
          })),
        } satisfies MenuRecipe,
      ]),
    );
  }

  // =========================================================================
  //  AYUDAS INTERNAS
  // =========================================================================

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
    if (lines.length === 0) {
      throw new BadRequestException('El menu debe tener al menos un ingrediente');
    }

    const productIds = [...new Set(lines.map((line) => line.productId))];
    if (productIds.length !== lines.length) {
      throw new BadRequestException(
        'Un producto no puede repetirse en la receta del menu',
      );
    }

    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, ...tenantWhere(companyId) },
      select: { id: true, name: true, cost: true, active: true },
    });

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
    return {
      ...menu,
      margin: money.sub(menu.price, menu.cost),
      maxServings,
      available: maxServings === null || maxServings > 0,
    };
  }

  /** El codigo de menu es unico por empresa (no global). */
  private async assertCodeAvailable(
    companyId: string,
    code: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.prisma.menu.findFirst({
      where: {
        ...tenantWhere(companyId),
        code,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
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
    const category = await this.prisma.menuCategory.findFirst({
      where: { id, ...tenantWhere(companyId) },
      select: { id: true },
    });
    if (!category) {
      throw new BadRequestException('La categoria de menu indicada no existe');
    }
  }

  /** Codigo legible y unico por empresa: MEN-YYYYMMDD-NNNN. */
  private async generateCode(companyId: string): Promise<string> {
    const total = await this.prisma.menu.count({ where: tenantWhere(companyId) });

    for (let attempt = 0; attempt < 50; attempt += 1) {
      const candidate = buildCode('MEN', total + 1 + attempt);
      const exists = await this.prisma.menu.findFirst({
        where: { code: candidate, ...tenantWhere(companyId) },
        select: { id: true },
      });
      if (!exists) return candidate;
    }
    throw new BadRequestException('No se pudo generar un codigo de menu unico');
  }
}
