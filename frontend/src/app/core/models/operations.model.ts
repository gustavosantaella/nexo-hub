/** Modelos de operacion: inventario, pedidos y caja. */

import type { RateHistory, RateKey } from './rates.model';

export type StockMovementType = 'IN' | 'OUT' | 'ADJUSTMENT';

export interface StockLevel {
  id: string;
  sku: string;
  name: string;
  stock: number;
  minStock: number;
  unit: string;
  /**
   * Unidades sueltas de la presentacion (1 = producto suelto). El formulario de
   * movimientos lo usa para convertir cajas <-> unidades.
   */
  unitsPerBox?: number;
  /**
   * Precio de venta de una unidad suelta (0 = se reparte el de la presentacion).
   */
  unitPrice?: number;
  /**
   * Contexto de moneda de `price` (que viaja en USD): `priceEntered` /
   * `priceCurrency` / `priceRateKey` recuerdan el monto que escribio el operador,
   * para volver a mostrarlo tal cual en la moneda de visualizacion.
   */
  priceEntered?: number | null;
  priceCurrency?: string;
  priceRateKey?: string | null;
  cost: number;
  /** Contexto de moneda del costo de la presentacion (mismas claves que `price`). */
  costEntered?: number | null;
  costCurrency?: string;
  costRateKey?: string | null;
  /**
   * Contexto de moneda del precio de la unidad suelta (independiente del de la
   * presentacion): `unitPriceEntered` se expresa en `unitPriceCurrency`.
   */
  unitPriceEntered?: number | null;
  unitPriceCurrency?: string;
  unitPriceRateKey?: string | null;
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
  /** Unidad con la que se escribio el movimiento (CAJA, UND, KG, G, LT, ML). */
  inputUnit?: string | null;
  /** Cantidad escrita en `inputUnit` (puede ser distinta a `quantity`). */
  inputQuantity?: number | null;
  unitCost?: number | null;
  /** Contexto de moneda del costo unitario (`unitCost` esta en USD). */
  unitCostCurrency?: string | null;
  unitCostRate?: number | null;
  unitCostEntered?: number | null;
  reason?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  createdAt: string;
  product?: {
    id: string;
    name: string;
    sku: string;
    unit: string;
    unitsPerBox?: number;
  } | null;
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
  /** Cantidad en la unidad de stock (se puede omitir si se envia `inputUnit`). */
  quantity?: number;
  /** Unidad con la que se escribio la cantidad (cajas, unidades, g, ml). */
  inputUnit?: string;
  /** Cantidad escrita en `inputUnit`; el backend la convierte a stock. */
  inputQuantity?: number;
  unitCost?: number;
  /** Moneda en la que se escribio el costo unitario (USD por defecto). */
  unitCostCurrency?: string;
  /**
   * Precio de venta de la unidad suelta (entradas). Omitirlo (o enviar 0) deja
   * el precio del producto tal como estaba.
   */
  unitPrice?: number;
  /** Moneda en la que se escribio el precio unitario (USD por defecto). */
  unitPriceCurrency?: string;
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
  /** Producto vendido (`null` cuando la linea es un menu). */
  productId?: string | null;
  /** Menu vendido (`null` cuando la linea es un producto suelto). */
  menuId?: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
  /**
   * Precio de la unidad en la moneda de la vitrina (`Order.priceCurrency`), tal
   * como lo vio el cajero. `null` en pedidos sin recargo o anteriores al
   * snapshot: en esos casos el precio en USD es el monto exacto.
   */
  unitPriceEntered?: number | null;
  total: number;
}

/**
 * Desglose del pedido en la moneda de la vitrina (`Order.priceCurrency`),
 * congelado al vender.
 *
 * Volver a multiplicar el USD guardado por la tasa devuelve otro monto
 * (Bs 15.520,00 -> Bs 15.521,27): la pantalla muestra estos valores y no el
 * resultado de reconvertir.
 */
export interface SalePriceBreakdown {
  subtotal: number;
  discount: number;
  tax: number;
  tip: number;
  deliveryFee: number;
  total: number;
}

/**
 * Parte de un cobro o de un vuelto: metodo, moneda y monto. Los pagos mixtos y
 * los vueltos entregados en varias formas se guardan como lista de estas lineas.
 */
export interface PaymentBreakdownLine {
  method: PaymentMethod;
  currency: string;
  /** Monto en `currency` (lo que entrego o recibio el cliente). */
  amount: number;
  exchangeRate?: number | null;
  rateKey?: RateKey | null;
  /** Equivalente en USD (moneda base del sistema). */
  baseAmount: number;
}

export interface OrderPayment {
  id: string;
  orderId: string;
  /** Monto aplicado al pedido (pagos menos vuelto) en `currency`. */
  amount: number;
  method: PaymentMethod;
  /** Referencia bancaria del comprobante (transferencia / pago movil). */
  paymentReference?: string | null;
  /** Foto del comprobante: URL local `/media/...` subida por multipart. */
  paymentPhotoUrl?: string | null;
  /** Moneda en la que pago el cliente (USD, VES, ...). */
  currency: string;
  /** Bolivares por 1 unidad de `currency` al momento del cobro. */
  exchangeRate?: number | null;
  /** Tasa ELEGIDA para el cobro (`null` = la activa del sistema al cobrar). */
  rateKey?: RateKey | null;
  /** Historial de TODAS las tasas vigentes ese dia cuando se cobro. */
  ratesHistory?: RateHistory | null;
  /** Equivalente en USD (moneda base del sistema). */
  baseAmount: number;
  /** Desglose del pago (vacio en cobros de una sola parte anteriores). */
  parts?: PaymentBreakdownLine[];
  /** Vuelto entregado, por metodo y moneda (vacio si no hubo vuelto). */
  change?: PaymentBreakdownLine[];
  /** Total del vuelto en USD (moneda base). */
  changeBaseAmount?: number;
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
  /** Propina del cliente (no paga IGV). */
  tip: number;
  /** Costo de delivery en USD (moneda base); 0 en pedidos sin delivery. */
  deliveryFee: number;
  /**
   * Contexto de moneda del delivery: `deliveryFeeEntered` en `deliveryFeeCurrency`
   * con la tasa `deliveryFeeRate` (`deliveryFeeRateKey`), para volver a mostrarlo
   * tal cual se escribió.
   */
  deliveryFeeEntered?: number | null;
  deliveryFeeCurrency?: string;
  deliveryFeeRate?: number | null;
  deliveryFeeRateKey?: string | null;
  /**
   * Precios de la vitrina congelados al vender: moneda, tasa y desglose.
   * Con el catalogo en bolivares a una tasa con recargo el monto en bolivares no
   * se puede re-derivar del USD guardado (Bs 15.520,00 volveria como 15.521,27),
   * asi que la pantalla muestra este snapshot. `null` sin recargo: el USD es el
   * monto exacto.
   */
  priceCurrency?: string | null;
  priceRate?: number | null;
  priceBreakdown?: SalePriceBreakdown | null;
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
  /** Producto suelto del inventario (excluyente con `menuId`). */
  productId?: string;
  /** Menu con receta: descuenta sus ingredientes (excluyente con `productId`). */
  menuId?: string;
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
  /** Propina en monto absoluto (no se le aplica IGV). */
  tip?: number;
  /**
   * Costo de delivery en `deliveryFeeCurrency` (USD por defecto). Sin IGV; en 0
   * (u omitido) el pedido queda sin costo de delivery.
   */
  deliveryFee?: number;
  /** Moneda en la que se escribió el costo de delivery. */
  deliveryFeeCurrency?: string;
  /** Tasa elegida para convertir el costo de delivery (sin tasa = la activa). */
  deliveryFeeRateKey?: string;
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
  /**
   * Unidades de `currency` por 1 USD al momento del registro. El arqueo valora
   * el movimiento con esta tasa (`amount / baseRate`), no con el equivalente ya
   * recortado a centavos.
   */
  baseRate?: number | null;
  /** Equivalente en USD (moneda base del sistema). */
  baseAmount: number;
  description?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  /** Referencia bancaria del comprobante (transferencia / pago movil). */
  paymentReference?: string | null;
  /** Foto del comprobante: URL local `/media/...`. */
  paymentPhotoUrl?: string | null;
  createdAt: string;
  createdBy?: { id: string; name: string } | null;
}

/** Totales de un método de pago dentro de una moneda. */
export interface CurrencyMethodTotal {
  method: string;
  /** Montos en la moneda de la fila. */
  in: number;
  out: number;
  net: number;
  /** Los mismos montos expresados en USD (moneda base). */
  baseIn: number;
  baseOut: number;
  baseNet: number;
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
  /** Efectivo (método CASH) que entró y salió en esta moneda. */
  cashIn: number;
  cashOut: number;
  baseCashIn: number;
  baseCashOut: number;
  /** Ventas brutas (categoría SALE) cobradas en esta moneda, con propina. */
  sales: number;
  /** Propina incluida en esos cobros, en esta moneda. */
  tips: number;
  /** Vueltos entregados (categoría CHANGE) en esta moneda. */
  change: number;
  baseSales: number;
  baseTips: number;
  baseChange: number;
  /** Desglose de esta moneda por método de pago. */
  methods: CurrencyMethodTotal[];
}

/** Una parte del fondo inicial: monto contado en su moneda + equivalente en USD. */
export interface CashOpeningLine {
  currency: string;
  /** Monto que se contó físicamente en `currency`. */
  amount: number;
  /** Bolívares por 1 unidad de `currency` (tasa usada al abrir). */
  rate?: number | null;
  /**
   * Unidades de `currency` por 1 USD con las que se valorizó el fondo
   * (`amount / baseRate`). Falta en aperturas antiguas.
   */
  baseRate?: number | null;
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
  /** Fondo inicial valorizado con su tasa y recortado a centavos (USD). */
  openingCash?: number;
  expectedCash: number;
  totalIn: number;
  totalOut: number;
  net: number;
  /** Ventas del turno (categoría SALE), sin propinas. */
  salesTotal: number;
  /** Propinas cobradas en el turno (vienen dentro de los cobros por venta). */
  tipsTotal: number;
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
  /** Monto del movimiento simple. En un pago mixto viaja el desglose en `parts`. */
  amount?: number;
  description?: string;
  /**
   * Desglose de un pago mixto: cada parte (metodo + moneda + monto) se guarda
   * como un movimiento de caja propio.
   */
  parts?: CashMovementPartPayload[];
  /** Referencia bancaria del comprobante (transferencia / Yape / Plin). */
  paymentReference?: string;
  /** Foto del comprobante: URL local `/media/...` ya subida por multipart. */
  paymentPhotoUrl?: string;
}

/** Parte de un pago mixto registrado desde la caja. */
export interface CashMovementPartPayload {
  paymentMethod: Exclude<PaymentMethod, 'MIXED'>;
  amount: number;
  currency?: string;
  paymentReference?: string;
  paymentPhotoUrl?: string;
}
