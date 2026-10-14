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
  cost: number;
  stock: number;
  minStock: number;
  unit: ProductUnit;
  /**
   * Unidades individuales que trae la presentacion (caja/paquete): `price` es
   * el de la caja completa y `stock` se lleva en unidades, asi el POS vende
   * sueltas a `price / unitsPerBox`. `1` = se vende suelto.
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
  /** Unidades individuales de la presentacion (1 = se vende suelto). */
  unitsPerBox: number;
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
  price: number;
  cost?: number;
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

export interface Category {
  id: string;
  name: string;
  description?: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  productCount?: number;
  _count?: { products: number };
}

export interface CategoryPayload {
  name: string;
  description?: string;
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
}

/** Categoria comercial del menu (Desayunos, Almuerzos, Combos...). */
export interface MenuCategory extends MenuCategoryRef {
  description?: string | null;
  sortOrder: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { menus: number };
}

export interface MenuCategoryPayload {
  name: string;
  description?: string;
  color?: string;
  sortOrder?: number;
  active?: boolean;
}

/** Linea de la receta: cuanto consume una unidad del menu. */
export interface MenuIngredient {
  id: string;
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
  /** Costo de la receta (calculado al guardar). */
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
    } | null;
  }[];
  margin: number;
  maxServings: number | null;
  available: boolean;
}

export interface MenuPayload {
  code?: string;
  name: string;
  description?: string;
  imageUrl?: string;
  price: number;
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
