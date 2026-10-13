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

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  phone?: string | null;
  active: boolean;
  lastLoginAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
  expiresIn?: number;
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
  price: number;
  cost: number;
  stock: number;
  minStock: number;
  unit: ProductUnit;
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
  stock: number;
  unit: ProductUnit;
}

export interface ProductPayload {
  sku?: string;
  name: string;
  description?: string;
  price: number;
  cost?: number;
  stock?: number;
  minStock?: number;
  unit?: ProductUnit;
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
  role?: Role;
  phone?: string;
  active?: boolean;
}
