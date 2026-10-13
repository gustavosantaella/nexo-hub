/** Modelos de finanzas: gastos y cuentas por cobrar / pagar. */

import type { PaymentMethod } from './operations.model';

export type ExpenseCategory =
  | 'OPERATIVO'
  | 'SERVICIOS'
  | 'SUELDOS'
  | 'COMPRAS'
  | 'MANTENIMIENTO'
  | 'IMPUESTOS'
  | 'OTROS';

export type AccountStatus = 'PENDING' | 'PARTIAL' | 'PAID' | 'CANCELLED';

export interface Expense {
  id: string;
  category: ExpenseCategory;
  description: string;
  /** Monto en la moneda en la que se pago el gasto. */
  amount: number;
  /** Moneda del gasto (USD cuando no se indica otra). */
  currency: string;
  /** Bolivares por 1 unidad de `currency` al registrar el gasto. */
  exchangeRate?: number | null;
  /** Equivalente en USD (moneda base del sistema). */
  baseAmount: number;
  date: string;
  paymentMethod: PaymentMethod;
  supplierId?: string | null;
  cashMovementId?: string | null;
  createdAt: string;
  updatedAt: string;
  supplier?: { id: string; name: string } | null;
  createdBy?: { id: string; name: string } | null;
}

export interface ExpensePayload {
  category: ExpenseCategory;
  description: string;
  amount: number;
  /** Moneda en la que se paga el gasto (USD por defecto). */
  currency?: string;
  date?: string;
  paymentMethod?: PaymentMethod;
  supplierId?: string | null;
  payFromCash?: boolean;
}

export interface AccountPayment {
  id: string;
  /** Monto en la moneda en la que se pago/cobro. */
  amount: number;
  method: PaymentMethod;
  /** Moneda del pago (USD cuando no se indica otra). */
  currency: string;
  exchangeRate?: number | null;
  /** Equivalente en USD (moneda base del sistema). */
  baseAmount: number;
  note?: string | null;
  createdAt: string;
  createdBy?: { id: string; name: string } | null;
}

export interface AccountBase {
  id: string;
  description: string;
  /** Monto en la moneda en la que se registro la cuenta. */
  amount: number;
  /** Moneda de la cuenta (USD cuando no se indica otra). */
  currency: string;
  /** Bolivares por 1 unidad de `currency` al registrar la cuenta. */
  exchangeRate?: number | null;
  /** Equivalente en USD (moneda base del sistema). */
  baseAmount: number;
  paidAmount: number;
  balance: number;
  status: AccountStatus;
  dueDate?: string | null;
  reference?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy?: { id: string; name: string } | null;
  payments?: AccountPayment[];
  paymentsCount?: number;
}

export interface Payable extends AccountBase {
  supplierId?: string | null;
  supplier?: { id: string; name: string; phone?: string | null } | null;
}

export interface Receivable extends AccountBase {
  customerId?: string | null;
  orderId?: string | null;
  customer?: { id: string; name: string; phone?: string | null } | null;
}

export interface AccountPayload {
  description: string;
  amount: number;
  /** Moneda en la que se registra la deuda (USD por defecto). */
  currency?: string;
  supplierId?: string | null;
  customerId?: string | null;
  orderId?: string | null;
  dueDate?: string;
  reference?: string;
  notes?: string;
}

export interface AccountPaymentPayload {
  amount: number;
  method?: PaymentMethod;
  /** Moneda en la que se cobra/paga (USD por defecto). */
  currency?: string;
  note?: string;
  payFromCash?: boolean;
  depositToCash?: boolean;
}

export interface AccountSummary {
  openAmount: number;
  openPaid: number;
  openBalance: number;
  openCount: number;
  byStatus: {
    status: AccountStatus;
    count: number;
    amount: number;
    paid: number;
    balance: number;
  }[];
}

export interface ExpenseSummary {
  total: number;
  count: number;
  byCategory: { category: ExpenseCategory; amount: number; count: number }[];
  byMethod: { method: PaymentMethod; amount: number; count: number }[];
  byMonth?: { month: string; amount: number }[];
}
