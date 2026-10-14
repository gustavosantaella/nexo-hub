/** Modelos base compartidos (contratos del API NestJS). */

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface Paginated<T> {
  items: T[];
  meta: PaginationMeta;
  totals?: Record<string, number>;
}

export interface PageQuery {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export type Role = 'ADMIN' | 'MANAGER' | 'CASHIER';

/** Cuenta global del sistema (puede pertenecer a varias empresas). */
export interface User {
  id: string;
  email: string;
  name: string;
  documentId?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  active: boolean;
  lastLoginAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Empresa (tenant) del sistema multi-empresa. */
export interface Company {
  id: string;
  name: string;
  rif: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  /** Logo para los reportes: URL publica o data URL (base64) reducida. */
  logoUrl?: string | null;
  notes?: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Empresa del usuario con el rol que tiene EN ESA empresa. */
export interface UserCompanySummary {
  id: string;
  name: string;
  rif: string;
  role: Role;
  active: boolean;
}

/** Respuesta de login, registro, cambio de empresa y `GET /auth/me`. */
export interface SessionResponse {
  accessToken: string;
  user: User;
  company: Company;
  role: Role;
  companies: UserCompanySummary[];
}

/** Miembro de la empresa activa (el rol es el de ESTA empresa). */
export interface CompanyMember {
  id: string;
  email: string;
  name: string;
  documentId?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  role: Role;
  active: boolean;
  lastLoginAt?: string | null;
  joinedAt: string;
}

/** Usuario con el contexto de la empresa activa (lo que usa la interfaz). */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  documentId?: string | null;
  role: Role;
  companyId: string;
  companyName: string;
}

/** Cuerpo de `POST /auth/register` (empresa + administrador). */
export interface RegisterPayload {
  company: {
    name: string;
    rif: string;
    phone?: string;
    email?: string;
    address?: string;
  };
  user: {
    name: string;
    documentId: string;
    email: string;
    phone?: string;
    password: string;
  };
}

/** Cuerpo de `PATCH /auth/profile`. */
export interface UpdateProfilePayload {
  name?: string;
  documentId?: string;
  email?: string;
  phone?: string;
  /** Nueva contraseña (requiere enviar `currentPassword`). */
  password?: string;
  currentPassword?: string;
}

/** Cuerpo de `POST /companies` y `PATCH /companies/current`. */
export interface CompanyPayload {
  name: string;
  rif: string;
  phone?: string;
  email?: string;
  address?: string;
  /** Logo para los reportes (URL o data URL). Cadena vacia lo elimina. */
  logoUrl?: string;
  notes?: string;
}

export type ProductUnit = 'UND' | 'KG' | 'LT' | 'CAJA' | 'PAQUETE';

export interface ProductRef {
  id: string;
  name: string;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  description?: string | null;
  /** Foto para la grilla del POS: URL o data URL. */
  imageUrl?: string | null;
  price: number;
  /**
   * Contexto de la moneda con la que se cargo el precio: `price` siempre esta en
   * USD (moneda base contable), `priceEntered` es lo que escribio el usuario en
   * `priceCurrency`, `priceRate` la tasa usada (bolivares por 1 unidad) y
   * `priceRateKey` CUAL de las tasas del sistema eligio (`BCV_USD`, `BCV_EUR` o
   * `CUSTOM_USD`).
   */
  priceCurrency: string;
  priceRate?: number | null;
  priceRateKey?: string | null;
  priceEntered?: number | null;
  cost: number;
  costCurrency: string;
  costRate?: number | null;
  costRateKey?: string | null;
  costEntered?: number | null;
  /** Costo de UNA unidad suelta (el de la presentacion es `cost`). */
  unitCost: number;
  unitCostEntered?: number | null;
  /**
   * Moneda con la que se escribio el costo unitario: es INDEPENDIENTE de
   * `costCurrency` (cada monto tiene su propio selector de moneda), por eso
   * `unitCostEntered` se expresa en esta moneda y `unitCostRate` es su tasa.
   */
  unitCostCurrency?: string;
  unitCostRate?: number | null;
  /** Tasa elegida para el costo unitario (independiente de las otras). */
  unitCostRateKey?: string | null;
  /**
   * PRECIO DE VENTA de UNA unidad suelta de la presentacion (cajas/paquetes): el
   * de la presentacion completa es `price`. `0` = sin definir, y la venta por
   * unidad reparte `price / unitsPerBox`.
   */
  unitPrice: number;
  unitPriceEntered?: number | null;
  /**
   * Moneda con la que se escribio el precio unitario: es INDEPENDIENTE de
   * `priceCurrency` (cada monto tiene su propio selector de moneda), por eso
   * `unitPriceEntered` se expresa en esta moneda y `unitPriceRate` es su tasa.
   */
  unitPriceCurrency?: string;
  unitPriceRate?: number | null;
  /** Tasa elegida para el precio unitario (independiente de las otras). */
  unitPriceRateKey?: string | null;
  stock: number;
  minStock: number;
  unit: ProductUnit;
  /**
   * Unidades individuales que trae la presentacion (caja/paquete): `price` es
   * el de la caja completa y `stock` se lleva en unidades, asi el POS vende
   * sueltas a `unitPrice` y, si esta sin definir, a `price / unitsPerBox`.
   * `1` = se vende suelto.
   */
  unitsPerBox: number;
  trackStock: boolean;
  active: boolean;
  categoryId?: string | null;
  supplierId?: string | null;
  category?: ProductRef | null;
  supplier?: ProductRef | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductOption {
  id: string;
  sku: string;
  name: string;
  price: number;
  /**
   * Costo de referencia. El API siempre lo envia (lo usa el formulario de menús
   * para costear la receta); opcional porque las pruebas arman opciones minimas.
   */
  cost?: number;
  stock: number;
  unit: ProductUnit;
  /**
   * Unidades individuales de la presentacion (1 = se vende suelto).
   */
  unitsPerBox: number;
  /**
   * PRECIO DE VENTA de UNA unidad suelta (cajas/paquetes); `0` = sin definir, y
   * la venta por unidad reparte `price / unitsPerBox`. Opcional porque las
   * pruebas arman opciones minimas.
   */
  unitPrice?: number;
  /**
   * Contexto de moneda de los montos (`price` y `unitPrice` viajan en USD): con
   * `*Entered` / `*Currency` la grilla del POS vuelve a mostrar el monto escrito
   * a mano (Bs 350,00) en vez de su equivalente en dolares redondeado a centavos.
   */
  priceEntered?: number | null;
  priceCurrency?: string;
  priceRateKey?: string | null;
  unitPriceEntered?: number | null;
  unitPriceCurrency?: string;
  unitPriceRateKey?: string | null;
  /** Foto para la grilla del POS (URL o data URL); `null` si no tiene. */
  imageUrl?: string | null;
  categoryId?: string | null;
}

export interface ProductPayload {
  sku?: string;
  name: string;
  description?: string;
  /** Foto del producto (URL o data URL). Cadena vacia la elimina. */
  imageUrl?: string;
  /** Precio de venta EN LA MONEDA de `priceCurrency` (USD si se omite). */
  price: number;
  /** Moneda en la que se escribio el precio (USD por defecto). */
  priceCurrency?: string;
  /** Tasa con la que se convierte el precio a USD (`BCV_USD`, `BCV_EUR`, `CUSTOM_USD`). */
  priceRateKey?: string;
  cost?: number;
  /** Moneda en la que se escribio el costo (por defecto la del precio). */
  costCurrency?: string;
  /** Tasa con la que se convierte el costo de la presentacion a USD. */
  costRateKey?: string;
  /** Costo de una unidad suelta de la presentacion (cajas/paquetes). */
  unitCost?: number;
  /** Moneda del costo unitario (independiente de `costCurrency`). */
  unitCostCurrency?: string;
  /** Tasa con la que se convierte el costo unitario a USD (independiente de las otras). */
  unitCostRateKey?: string;
  /**
   * PRECIO DE VENTA de una unidad suelta de la presentacion (cajas/paquetes), en
   * `unitPriceCurrency`. 0 = sin definir: al vender suelto se reparte el precio.
   */
  unitPrice?: number;
  /** Moneda del precio unitario (independiente de `priceCurrency`). */
  unitPriceCurrency?: string;
  /** Tasa con la que se convierte el precio unitario a USD (independiente de las otras). */
  unitPriceRateKey?: string;
  stock?: number;
  minStock?: number;
  unit?: ProductUnit;
  /** Unidades individuales de la presentacion (1 = se vende suelto). */
  unitsPerBox?: number;
  trackStock?: boolean;
  categoryId?: string | null;
  supplierId?: string | null;
  active?: boolean;
}

/**
 * Respuesta de la baja logica de un producto. Desactivarlo NO lo quita de las
 * recetas que ya lo usan: esos menus quedan sin poder venderse hasta corregir la
 * receta, por eso el API los devuelve en `affectedMenus`.
 */
export interface ProductDeactivation {
  count: number;
  affectedMenus: { id: string; code: string; name: string }[];
}

export interface Category {
  id: string;
  name: string;
  description?: string | null;
  /** Categoria principal a la que pertenece (`null` = es principal). */
  parentId?: string | null;
  /** Padre resuelto por el API, para pintarlo en el listado. */
  parent?: { id: string; name: string } | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  productCount?: number;
  _count?: { products: number; subcategories?: number };
}

export interface CategoryPayload {
  name: string;
  description?: string;
  /** `null` la deja como categoria principal. */
  parentId?: string | null;
  active?: boolean;
}

// ================================ Menus ====================================
// El MENU es lo que se vende (plato, combo, "parrilla"): una receta de
// ingredientes tomados del inventario. Vender un menu descuenta del stock cada
// ingrediente segun su cantidad (100 g de carne que se controla en kilos = 0.1).

/** Como se ofrece el menu en la carta. */
export type MenuAvailability = 'ALL' | 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';

/** Seccion del ingrediente dentro del combo (Bebida, Postre, ...). */
export type MenuSection =
  | 'Principal'
  | 'Bebida'
  | 'Postre'
  | 'Acompanamiento'
  | 'Otro';

export interface MenuCategoryRef {
  id: string;
  name: string;
  color?: string | null;
  /** Categoria de menu principal a la que pertenece (`null` = es principal). */
  parentId?: string | null;
}

/** Categoria comercial del menu (Desayunos, Almuerzos, Combos...). */
export interface MenuCategory extends MenuCategoryRef {
  description?: string | null;
  sortOrder: number;
  /** Padre resuelto por el API, para pintarlo en el listado. */
  parent?: { id: string; name: string } | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { menus: number; subcategories?: number };
}

export interface MenuCategoryPayload {
  name: string;
  description?: string;
  color?: string;
  sortOrder?: number;
  /** `null` la deja como categoria principal. */
  parentId?: string | null;
  active?: boolean;
}

/** Referencia minima de un ingrediente desactivado (aviso en la interfaz). */
export interface InactiveIngredientRef {
  id: string;
  name: string;
}

/** Linea de la receta: cuanto consume una unidad del menu. */
export interface MenuIngredient {
  /** Id de la linea de receta (el listado no lo envia; la ficha si). */
  id?: string;
  productId: string;
  /** En la unidad del stock del producto (0.1 = 100 g de algo medido en kg). */
  quantity: number;
  section?: string | null;
  note?: string | null;
  sortOrder: number;
  product?: {
    id: string;
    name: string;
    sku: string;
    unit: ProductUnit;
    price: number;
    cost: number;
    stock: number;
    trackStock: boolean;
    /** `false` = producto desactivado: el menu no se puede vender. */
    active: boolean;
  } | null;
}

export interface MenuIngredientPayload {
  productId: string;
  quantity: number;
  section?: MenuSection;
  note?: string;
  sortOrder?: number;
}

export interface Menu {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  price: number;
  /** Moneda con la que se cargo el precio (`price` siempre esta en USD). */
  priceCurrency: string;
  /** Bolivares por 1 unidad de `priceCurrency` al momento de guardar. */
  priceRate?: number | null;
  /** Monto tal como lo escribio el usuario, en `priceCurrency`. */
  priceEntered?: number | null;
  /** Costo de la receta (calculado al guardar, en USD). */
  cost: number;
  availability: MenuAvailability;
  preparationMinutes?: number | null;
  categoryId?: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  category?: MenuCategoryRef | null;
  ingredients: MenuIngredient[];
  /** Precio - costo. */
  margin: number;
  /** Porciones preparables con el stock actual (`null` = sin tope). */
  maxServings: number | null;
  available: boolean;
  /**
   * Ingredientes de la receta cuyo producto fue desactivado: mientras sigan ahi
   * el menu no se puede vender (`available` = false aunque haya stock).
   */
  inactiveIngredients: InactiveIngredientRef[];
}

/** Menu tal como lo consume el POS / el buscador de pedidos. */
export interface MenuOption {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  price: number;
  cost: number;
  availability: MenuAvailability;
  preparationMinutes?: number | null;
  categoryId?: string | null;
  category?: MenuCategoryRef | null;
  ingredients: {
    quantity: number;
    section?: string | null;
    product?: {
      id: string;
      name: string;
      unit: ProductUnit;
      stock: number;
      trackStock: boolean;
      /** `false` = producto desactivado: el menu no se puede vender. */
      active: boolean;
    } | null;
  }[];
  margin: number;
  maxServings: number | null;
  available: boolean;
  /** Ingredientes desactivados que bloquean la venta del menu. */
  inactiveIngredients: InactiveIngredientRef[];
}

export interface MenuPayload {
  code?: string;
  name: string;
  description?: string;
  imageUrl?: string;
  /** Precio de venta EN LA MONEDA de `priceCurrency` (USD si se omite). */
  price: number;
  /** Moneda en la que se escribio el precio de la carta. */
  priceCurrency?: string;
  availability?: MenuAvailability;
  preparationMinutes?: number;
  categoryId?: string | null;
  active?: boolean;
  ingredients: MenuIngredientPayload[];
}

export interface Supplier {
  id: string;
  name: string;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  taxId?: string | null;
  notes?: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { products: number; payables: number };
}

export interface SupplierPayload {
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  taxId?: string;
  notes?: string;
  active?: boolean;
}

export interface Customer {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  docNumber?: string | null;
  notes?: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { orders: number; receivables: number };
}

export interface CustomerPayload {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  docNumber?: string;
  notes?: string;
  active?: boolean;
}

export interface UserPayload {
  email: string;
  password?: string;
  name: string;
  documentId?: string;
  role?: Role;
  phone?: string;
  active?: boolean;
}
