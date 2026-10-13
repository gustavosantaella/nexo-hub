/** Modelos de estadisticas / reportes. */

import type { CurrencyBreakdown, PaymentMethod } from './operations.model';

/** Un monto expresado en su moneda original y en USD (moneda base). */
export interface CurrencyAmount {
  currency: string;
  amount: number;
  baseAmount: number;
  count: number;
}

/** Cobros agrupados por moneda (`GET /api/stats/currencies`). */
export interface PaymentsByCurrencyReport {
  total: number;
  items: CurrencyAmount[];
}

/**
 * Movimiento del día por moneda: en qué moneda entró/salió el dinero y los
 * totales del día en USD (moneda base), para poder mostrar el equivalente en
 * bolívares con la tasa activa.
 */
export interface DashboardCurrencySummary {
  /** Cobros de pedidos de hoy por moneda (monto original + equivalente USD). */
  sales: CurrencyAmount[];
  /** Gastos de hoy por moneda (monto original + equivalente USD). */
  expenses: CurrencyAmount[];
  /** Totales del día en moneda base (USD). */
  totals: {
    sales: number;
    collected: number;
    expenses: number;
    profit: number;
    receivable: number;
    payable: number;
    net: number;
  };
}

export interface DashboardStats {
  generatedAt: string;
  today: {
    sales: number;
    collected: number;
    orders: number;
    expenses: number;
    profit: number;
    ticketAverage: number;
  };
  month: {
    sales: number;
    orders: number;
    expenses: number;
    profit: number;
    growth: number;
  };
  cash: {
    id: string;
    code: string;
    status: 'OPEN' | 'CLOSED';
    openingAmount: number;
    expectedCash: number;
    cashIn: number;
    cashOut: number;
    salesTotal: number;
    movementCount?: number;
    /** Desglose del efectivo por moneda (montos originales + USD). */
    byCurrency: CurrencyBreakdown[];
  } | null;
  activeOrders: number;
  lowStock: {
    count: number;
    items: {
      id: string;
      sku: string;
      name: string;
      stock: number;
      minStock: number;
      unit: string;
    }[];
  };
  accounts: { payable: number; receivable: number; net: number };
  catalog: { products: number; customers: number; suppliers: number };
  paymentsToday: { method: PaymentMethod; amount: number; count: number }[];
  /** Cobros del dia por moneda (monto original + equivalente en USD). */
  paymentsTodayByCurrency: CurrencyAmount[];
  /** Movimiento del dia por moneda + totales del dia en USD. */
  currencies: DashboardCurrencySummary;
}

export interface StatsQuery {
  from?: string;
  to?: string;
  limit?: number;
}

export interface SalesPoint {
  period: string;
  orders: number;
  sales: number;
  collected: number;
  expenses: number;
  profit: number;
}

export interface SalesSeries {
  range: { from: string; to: string; granularity: 'day' | 'week' | 'month' };
  series: SalesPoint[];
  totals: {
    orders: number;
    sales: number;
    collected: number;
    expenses: number;
    profit: number;
    ticketAverage: number;
  };
}

export interface TopProduct {
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  revenue: number;
  cost: number;
  profit: number;
}

export interface PaymentMethodsReport {
  total: number;
  items: { method: PaymentMethod; amount: number; count: number; share: number }[];
}

export interface CategorySalesReport {
  total: number;
  items: { name: string; quantity: number; revenue: number; share: number }[];
}

export interface LowStockItem {
  id: string;
  sku: string;
  name: string;
  stock: number;
  minStock: number;
  unit: string;
}
