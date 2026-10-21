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
  PROCESSING: 'PROCESSING',
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
/**
 * Metodos que se cobran contra una cuenta bancaria/billetera y por eso exigen
 * la referencia del comprobante (4-6 digitos) y admiten una foto opcional.
 */
export const PAYMENT_PROOF_METHODS: PaymentMethod[] = [
  PaymentMethod.TRANSFER,
  PaymentMethod.YAPE,
  PaymentMethod.PLIN,
];

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
  // Vuelto entregado al cliente en un cobro (egreso de caja). No es una
  // devolucion: se registra para que el arqueo y los movimientos muestren como
  // se devolvio el cambio, en la moneda y el metodo que sea.
  CHANGE: 'CHANGE',
  ADJUSTMENT: 'ADJUSTMENT',
  OTHER: 'OTHER',
} as const;
export type CashMovementCategory =
  (typeof CashMovementCategory)[keyof typeof CashMovementCategory];
export const CASH_MOVEMENT_CATEGORIES = Object.values(CashMovementCategory);

// ------------------------------ Preferencias -------------------------------
// Preferencias personales de la interfaz (Configuracion). No son de la empresa
// ni cambian ningun dato de dominio: cada usuario elige como quiere ver el
// sistema y su eleccion lo sigue a cualquier equipo.
export const DialogView = {
  MODAL: 'modal',
  SIDEBAR: 'sidebar',
} as const;
export type DialogView = (typeof DialogView)[keyof typeof DialogView];
export const DIALOG_VIEWS: DialogView[] = Object.values(DialogView);

/**
 * Como lista el catalogo el punto de venta (Configuracion > Cajero):
 * - `cards`: tarjetas con foto.
 * - `table`: tabla de 20 articulos por pagina.
 * - `columns`: listas sin foto, en columnas de 10 articulos.
 */
export const PosView = {
  CARDS: 'cards',
  TABLE: 'table',
  COLUMNS: 'columns',
} as const;
export type PosView = (typeof PosView)[keyof typeof PosView];
export const POS_VIEWS: PosView[] = Object.values(PosView);

/**
 * Tasas del dolar (bolivares por 1 USD) que el administrador puede fijar como
 * **tasa de cobro** del cajero (Configuracion > Cajero).
 *
 * El cobro se hace SIEMPRE a la tasa oficial del BCV. La tasa personalizada del
 * local es solo una tasa de vitrina: infla los precios en bolivares que ve el
 * cajero, pero nunca se usa para valorar un cobro, un pago ni un fondo de caja.
 *
 * La lista se conserva con una sola clave para que las instalaciones y clientes
 * anteriores sigan enviando un valor valido; cualquier otro valor se descarta.
 */
export const CHARGE_RATE_KEYS = ['BCV_USD'] as const;
export type ChargeRateKey = (typeof CHARGE_RATE_KEYS)[number];

/** Categorias que implican sacar efectivo de la caja (egreso por defecto). */
export const CASH_OUT_CATEGORIES: string[] = [
  CashMovementCategory.EXPENSE,
  CashMovementCategory.WITHDRAWAL,
  CashMovementCategory.REFUND,
  CashMovementCategory.PAYMENT,
  CashMovementCategory.CHANGE,
];
