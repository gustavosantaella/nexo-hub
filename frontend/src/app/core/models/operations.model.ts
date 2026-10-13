/** Modelos de operacion: inventario, pedidos y caja. */

export type StockMovementType = 'IN' | 'OUT' | 'ADJUSTMENT';

export interface StockLevel {
  id: string;
  sku: string;
  name: string;
  stock: number;
  minStock: number;
  unit: string;
  cost: number;
  price: number;
  stockValue: number;
  isLowStock: boolean;
  category?: { id: string; name: string } | null;
}

export interface StockMovement {
  id: string;
  productId: string;
  type: StockMovementType;
  quantity: number;
  stockBefore: number;
  stockAfter: number;
  unitCost?: number | null;
  reason?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  createdAt: string;
  product?: { id: string; name: string; sku: string; unit: string } | null;
  createdBy?: { id: string; name: string } | null;
}

export interface MovementResult {
  movement: StockMovement;
  stockBefore: number;
  stockAfter: number;
}

export interface MovementPayload {
  productId: string;
  type: StockMovementType;
  quantity: number;
  unitCost?: number;
  reason?: string;
  referenceType?: string;
  referenceId?: string;
}

export type OrderStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'PREPARING'
  | 'READY'
  | 'COMPLETED'
  | 'CANCELLED';

export type OrderType = 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';

export type PaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID';

export type PaymentMethod =
  | 'CASH'
  | 'CARD'
  | 'TRANSFER'
  | 'YAPE'
  | 'PLIN'
  | 'CREDIT'
  | 'MIXED';

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface OrderPayment {
  id: string;
  orderId: string;
  /** Monto en la moneda en la que pago el cliente. */
  amount: number;
  method: PaymentMethod;
  /** Moneda en la que pago el cliente (USD, VES, ...). */
  currency: string;
  /** Bolivares por 1 unidad de `currency` al momento del cobro. */
  exchangeRate?: number | null;
  /** Equivalente en USD (moneda base del sistema). */
  baseAmount: number;
  note?: string | null;
  createdAt: string;
  createdBy?: { id: string; name: string } | null;
}

export interface Order {
  id: string;
  code: string;
  customerId?: string | null;
  type: OrderType;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  tableNumber?: string | null;
  notes?: string | null;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paidAmount: number;
  cashSessionId?: string | null;
  createdAt: string;
  updatedAt: string;
  customer?: { id: string; name: string; phone?: string | null } | null;
  createdBy?: { id: string; name: string } | null;
  items?: OrderItem[];
  payments?: OrderPayment[];
  _count?: { items: number; payments: number };
}

export interface OrderItemPayload {
  productId: string;
  quantity: number;
  unitPrice?: number;
}

export interface OrderPayload {
  customerId?: string | null;
  type?: OrderType;
  tableNumber?: string;
  notes?: string;
  discount?: number;
  taxRate?: number;
  items: OrderItemPayload[];
}

export interface CashMovement {
  id: string;
  sessionId: string;
  type: 'IN' | 'OUT';
  category: string;
  paymentMethod: PaymentMethod;
  /** Monto en la moneda en la que entro/salio el dinero. */
  amount: number;
  /** Moneda del movimiento (USD cuando no se indica otra). */
  currency: string;
  /** Bolivares por 1 unidad de `currency` al momento del registro. */
  exchangeRate?: number | null;
  /** Equivalente en USD (moneda base del sistema). */
  baseAmount: number;
  description?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  createdAt: string;
  createdBy?: { id: string; name: string } | null;
}

/** Efectivo de una moneda: montos originales + su equivalente en USD. */
export interface CurrencyBreakdown {
  currency: string;
  in: number;
  out: number;
  net: number;
  baseIn: number;
  baseOut: number;
  baseNet: number;
}

/** Una parte del fondo inicial: monto contado en su moneda + equivalente en USD. */
export interface CashOpeningLine {
  currency: string;
  /** Monto que se contó físicamente en `currency`. */
  amount: number;
  /** Bolívares por 1 unidad de `currency` (tasa usada al abrir). */
  rate?: number | null;
  /** Equivalente en USD (moneda base) de `amount`. */
  baseAmount: number;
}

/**
 * Arqueo de caja.
 * Los totales agregados estan en USD (moneda base); `byCurrency` conserva los
 * montos originales de cada moneda.
 */
export interface CashSummary {
  cashIn: number;
  cashOut: number;
  expectedCash: number;
  totalIn: number;
  totalOut: number;
  net: number;
  salesTotal: number;
  movementCount: number;
  byMethod: { method: string; in: number; out: number; net: number }[];
  byCategory: { category: string; in: number; out: number; net: number }[];
  byCurrency: CurrencyBreakdown[];
  /** Cómo se contó el fondo inicial, moneda por moneda (vacío en sesiones antiguas). */
  openingByCurrency?: CashOpeningLine[];
  /** `true` cuando el fondo inicial se contó en más de una moneda. */
  openingMixed?: boolean;
}

export interface CashSession {
  id: string;
  code: string;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  closedAt?: string | null;
  /** Fondo inicial expresado en USD (moneda base). */
  openingAmount: number;
  /** Moneda en la que se conto el fondo al abrir (`MIX` si fueron varias). */
  openingCurrency?: string | null;
  /** Bolivares por 1 unidad de `openingCurrency` al abrir. */
  openingRate?: number | null;
  /** Desglose del fondo contado (varias monedas o una distinta a USD). */
  openingLines?: CashOpeningLine[] | null;
  /** `true` cuando el fondo se conto en varias monedas a la vez. */
  openingMixed?: boolean;
  openingNotes?: string | null;
  /** Efectivo contado al cerrar, expresado en USD (moneda base). */
  countedAmount?: number | null;
  /** Moneda en la que se conto el efectivo al cerrar. */
  countedCurrency?: string | null;
  /** Bolivares por 1 unidad de `countedCurrency` al cerrar. */
  countedRate?: number | null;
  expectedAmount?: number | null;
  difference?: number | null;
  closingNotes?: string | null;
  openedBy?: { id: string; name: string; email?: string } | null;
  closedBy?: { id: string; name: string; email?: string } | null;
  movements?: CashMovement[];
  summary?: CashSummary;
}

export interface CashCurrentResponse {
  session: CashSession | null;
  summary: CashSummary | null;
  reconciliation?: unknown;
}

export interface CashMovementPayload {
  type?: 'IN' | 'OUT';
  /** Moneda en la que se paga/recibe (USD por defecto). */
  currency?: string;
  category:
    | 'SALE'
    | 'EXPENSE'
    | 'WITHDRAWAL'
    | 'DEPOSIT'
    | 'REFUND'
    | 'PAYMENT'
    | 'ADJUSTMENT'
    | 'OTHER';
  paymentMethod?: PaymentMethod;
  amount: number;
  description?: string;
}
