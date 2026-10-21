/**
 * Etiquetas y opciones de los "enums" de dominio (espejo del backend).
 * Centraliza los textos en espanol para no repetirlos en las plantillas.
 */

export interface Option<T extends string = string> {
  value: T;
  label: string;
}

const toOptions = <T extends string>(map: Record<string, string>): Option<T>[] =>
  Object.entries(map).map(([value, label]) => ({ value: value as T, label }));

export const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrador',
  MANAGER: 'Encargado',
  CASHIER: 'Cajero',
};
export const ROLE_OPTIONS = toOptions(ROLE_LABELS);

export const ORDER_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pendiente',
  CONFIRMED: 'Confirmado',
  PREPARING: 'En preparación',
  READY: 'Listo',
  PROCESSING: 'Procesando',
  COMPLETED: 'Completado',
  CANCELLED: 'Cancelado',
};
export const ORDER_STATUS_OPTIONS = toOptions(ORDER_STATUS_LABELS);

export const ORDER_STATUS_CLASSES: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  CONFIRMED: 'bg-sky-100 text-sky-700',
  PREPARING: 'bg-indigo-100 text-indigo-700',
  READY: 'bg-teal-100 text-teal-700',
  PROCESSING: 'bg-amber-100 text-amber-700 animate-pulse',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-rose-100 text-rose-700',
};

export const ORDER_TYPE_LABELS: Record<string, string> = {
  DINE_IN: 'Salón',
  TAKEAWAY: 'Para llevar',
  DELIVERY: 'Delivery',
};
export const ORDER_TYPE_OPTIONS = toOptions(ORDER_TYPE_LABELS);

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  UNPAID: 'Sin pagar',
  PARTIAL: 'Pago parcial',
  PAID: 'Pagado',
};
export const PAYMENT_STATUS_CLASSES: Record<string, string> = {
  UNPAID: 'bg-rose-100 text-rose-700',
  PARTIAL: 'bg-amber-100 text-amber-700',
  PAID: 'bg-emerald-100 text-emerald-700',
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Efectivo',
  CARD: 'Tarjeta',
  TRANSFER: 'Transferencia',
  YAPE: 'Yape',
  PLIN: 'Plin',
  CREDIT: 'Crédito',
  MIXED: 'Mixto',
};
export const PAYMENT_METHOD_OPTIONS = toOptions(PAYMENT_METHOD_LABELS);

/**
 * Metodos que se cobran contra una cuenta bancaria/billetera y por eso piden la
 * referencia del comprobante (4-6 digitos) y admiten una foto opcional.
 * Debe coincidir con `PAYMENT_PROOF_METHODS` del backend.
 */
export const PAYMENT_PROOF_METHODS = ['TRANSFER', 'YAPE', 'PLIN'] as const;

/** `true` si el cobro por ese metodo exige comprobante bancario. */
export function needsPaymentProof(method: string): boolean {
  return PAYMENT_PROOF_METHODS.some((proofMethod) => proofMethod === method);
}

export const PRODUCT_UNIT_LABELS: Record<string, string> = {
  UND: 'Unidad',
  KG: 'Kilogramo',
  LT: 'Litro',
  CAJA: 'Caja',
  PAQUETE: 'Paquete',
};
export const PRODUCT_UNIT_OPTIONS = toOptions(PRODUCT_UNIT_LABELS);

export const STOCK_MOVEMENT_LABELS: Record<string, string> = {
  IN: 'Entrada',
  OUT: 'Salida',
  ADJUSTMENT: 'Ajuste',
};
export const STOCK_MOVEMENT_OPTIONS = toOptions(STOCK_MOVEMENT_LABELS);

/** Seccion del ingrediente dentro de un menu (combo). */
export const MENU_SECTION_LABELS: Record<string, string> = {
  Principal: 'Principal',
  Bebida: 'Bebida',
  Postre: 'Postre',
  Acompanamiento: 'Acompañamiento',
  Otro: 'Otro',
};
export const MENU_SECTION_OPTIONS = Object.keys(MENU_SECTION_LABELS).map(
  (value) => ({ value, label: MENU_SECTION_LABELS[value] }),
) as { value: string; label: string }[];

/** Como se ofrece un menu en la carta. */
export const MENU_AVAILABILITY_LABELS: Record<string, string> = {
  ALL: 'Todos los servicios',
  DINE_IN: 'Solo salón',
  TAKEAWAY: 'Solo para llevar',
  DELIVERY: 'Solo delivery',
};
export const MENU_AVAILABILITY_OPTIONS = toOptions(MENU_AVAILABILITY_LABELS);

export const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  OPERATIVO: 'Operativo',
  SERVICIOS: 'Servicios',
  SUELDOS: 'Sueldos',
  COMPRAS: 'Compras',
  MANTENIMIENTO: 'Mantenimiento',
  IMPUESTOS: 'Impuestos',
  OTROS: 'Otros',
};
export const EXPENSE_CATEGORY_OPTIONS = toOptions(EXPENSE_CATEGORY_LABELS);

export const ACCOUNT_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pendiente',
  PARTIAL: 'Parcial',
  PAID: 'Pagado',
  CANCELLED: 'Anulado',
};
export const ACCOUNT_STATUS_OPTIONS = toOptions(ACCOUNT_STATUS_LABELS);

export const ACCOUNT_STATUS_CLASSES: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  PARTIAL: 'bg-sky-100 text-sky-700',
  PAID: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-slate-200 text-slate-600',
};

export const CASH_CATEGORY_LABELS: Record<string, string> = {
  SALE: 'Venta',
  EXPENSE: 'Gasto',
  WITHDRAWAL: 'Retiro',
  DEPOSIT: 'Depósito',
  REFUND: 'Devolución',
  PAYMENT: 'Pago de cuenta',
  CHANGE: 'Vuelto',
  ADJUSTMENT: 'Ajuste',
  OTHER: 'Otro',
};
export const CASH_CATEGORY_OPTIONS = toOptions(CASH_CATEGORY_LABELS);

export const CASH_IN_CATEGORIES: string[] = ['SALE', 'DEPOSIT'];
export const CASH_OUT_CATEGORIES: string[] = [
  'EXPENSE',
  'WITHDRAWAL',
  'REFUND',
  'PAYMENT',
  'CHANGE',
];

/** Devuelve la fecha de hoy en formato `YYYY-MM-DD` (input type=date). */
export function todayIso(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

/** Primer dia del mes actual en formato `YYYY-MM-DD`. */
export function startOfMonthIso(): string {
  return `${todayIso().slice(0, 7)}-01`;
}
