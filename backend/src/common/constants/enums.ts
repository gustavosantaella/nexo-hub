/**
 * Fuente de verdad de todos los "enums" de dominio.
 * Se modelan como objetos `as const` porque la base de datos (SQLite) guarda
 * los valores como String. Cada objeto expone tambien su arreglo de valores
 * validos para usarlos en validaciones (class-validator / class-transformer).
 */

// ----------------------------- Usuarios / Auth -----------------------------
export const Role = {
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  CASHIER: 'CASHIER',
} as const;
export type Role = (typeof Role)[keyof typeof Role];
export const ROLES = Object.values(Role);

// --------------------------------- Producto ---------------------------------
export const ProductUnit = {
  UND: 'UND',
  KG: 'KG',
  LT: 'LT',
  CAJA: 'CAJA',
  PAQUETE: 'PAQUETE',
} as const;
export type ProductUnit = (typeof ProductUnit)[keyof typeof ProductUnit];
export const PRODUCT_UNITS = Object.values(ProductUnit);

// -------------------------------- Inventario --------------------------------
export const StockMovementType = {
  IN: 'IN',
  OUT: 'OUT',
  ADJUSTMENT: 'ADJUSTMENT',
} as const;
export type StockMovementType =
  (typeof StockMovementType)[keyof typeof StockMovementType];
export const STOCK_MOVEMENT_TYPES = Object.values(StockMovementType);

export const StockReferenceType = {
  ORDER: 'ORDER',
  PURCHASE: 'PURCHASE',
  MANUAL: 'MANUAL',
  ADJUSTMENT: 'ADJUSTMENT',
  INITIAL: 'INITIAL',
} as const;
export type StockReferenceType =
  (typeof StockReferenceType)[keyof typeof StockReferenceType];

// ---------------------------------- Pedidos ---------------------------------
export const OrderStatus = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  PREPARING: 'PREPARING',
  READY: 'READY',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];
export const ORDER_STATUSES = Object.values(OrderStatus);

export const OrderType = {
  DINE_IN: 'DINE_IN',
  TAKEAWAY: 'TAKEAWAY',
  DELIVERY: 'DELIVERY',
} as const;
export type OrderType = (typeof OrderType)[keyof typeof OrderType];
export const ORDER_TYPES = Object.values(OrderType);

export const PaymentStatus = {
  UNPAID: 'UNPAID',
  PARTIAL: 'PARTIAL',
  PAID: 'PAID',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];
export const PAYMENT_STATUSES = Object.values(PaymentStatus);

// -------------------------------- Pagos -------------------------------------
export const PaymentMethod = {
  CASH: 'CASH',
  CARD: 'CARD',
  TRANSFER: 'TRANSFER',
  YAPE: 'YAPE',
  PLIN: 'PLIN',
  CREDIT: 'CREDIT',
  MIXED: 'MIXED',
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];
export const PAYMENT_METHODS = Object.values(PaymentMethod);
/** Metodos que impactan el efectivo fisico de la caja. */
export const CASH_PAYMENT_METHOD = PaymentMethod.CASH;

// -------------------------------- Finanzas ----------------------------------
export const AccountStatus = {
  PENDING: 'PENDING',
  PARTIAL: 'PARTIAL',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED',
} as const;
export type AccountStatus = (typeof AccountStatus)[keyof typeof AccountStatus];
export const ACCOUNT_STATUSES = Object.values(AccountStatus);

export const ExpenseCategory = {
  OPERATIVO: 'OPERATIVO',
  SERVICIOS: 'SERVICIOS',
  SUELDOS: 'SUELDOS',
  COMPRAS: 'COMPRAS',
  MANTENIMIENTO: 'MANTENIMIENTO',
  IMPUESTOS: 'IMPUESTOS',
  OTROS: 'OTROS',
} as const;
export type ExpenseCategory =
  (typeof ExpenseCategory)[keyof typeof ExpenseCategory];
export const EXPENSE_CATEGORIES = Object.values(ExpenseCategory);

// ----------------------------------- Caja -----------------------------------
export const CashSessionStatus = {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
} as const;
export type CashSessionStatus =
  (typeof CashSessionStatus)[keyof typeof CashSessionStatus];

export const CashMovementType = {
  IN: 'IN',
  OUT: 'OUT',
} as const;
export type CashMovementType =
  (typeof CashMovementType)[keyof typeof CashMovementType];

export const CashMovementCategory = {
  SALE: 'SALE',
  EXPENSE: 'EXPENSE',
  WITHDRAWAL: 'WITHDRAWAL',
  DEPOSIT: 'DEPOSIT',
  REFUND: 'REFUND',
  PAYMENT: 'PAYMENT',
  ADJUSTMENT: 'ADJUSTMENT',
  OTHER: 'OTHER',
} as const;
export type CashMovementCategory =
  (typeof CashMovementCategory)[keyof typeof CashMovementCategory];
export const CASH_MOVEMENT_CATEGORIES = Object.values(CashMovementCategory);

/** Categorias que implican sacar efectivo de la caja (egreso por defecto). */
export const CASH_OUT_CATEGORIES: string[] = [
  CashMovementCategory.EXPENSE,
  CashMovementCategory.WITHDRAWAL,
  CashMovementCategory.REFUND,
  CashMovementCategory.PAYMENT,
];
