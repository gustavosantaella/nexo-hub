/**
 * Modelos del reporte general (botón «Generar reporte» de Reportes).
 *
 * Un reporte es una *foto* de todo lo que cayó dentro del rango de fechas
 * elegido: resumen del período, serie de ventas/gastos/utilidad, productos,
 * categorías, métodos de pago, monedas cobradas, el detalle de pedidos y de
 * gastos, la caja y el estado de las cuentas por cobrar / pagar.
 */

import type { Company } from './api.model';
import type { Expense, ExpenseSummary, AccountSummary } from './finance.model';
import type { CashSession, Order } from './operations.model';
import type {
  CategorySalesReport,
  LowStockItem,
  PaymentMethodsReport,
  PaymentsByCurrencyReport,
  SalesPoint,
  TopProduct,
} from './stats.model';

/** Datos de la empresa que encabezan el reporte (logo, RIF y contacto). */
export interface ReportCompany {
  name: string;
  rif: string;
  logoUrl?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
}

/** Rango de fechas cubierto por el reporte (extremos incluidos). */
export interface ReportRange {
  /** Fecha inicial `YYYY-MM-DD`. */
  from: string;
  /** Fecha final `YYYY-MM-DD`. */
  to: string;
  /** Rango legible: `01 oct 2026 — 13 oct 2026` (o una sola fecha si es un día). */
  label: string;
  /** Detalle de la serie de ventas. */
  granularity: 'day' | 'week' | 'month';
  /** Momento en que se generó el reporte (ISO). */
  generatedAt: string;
}

/** Totales del período en la moneda base (USD). */
export interface ReportTotals {
  orders: number;
  sales: number;
  collected: number;
  expenses: number;
  profit: number;
  ticketAverage: number;
}

/** Tasa que se imprime al pie del reporte (referencia de la conversión a Bs). */
export interface ReportRate {
  label: string;
  /** Bolívares por 1 unidad de la moneda de la tasa. */
  rate: number;
}

/** Todo lo que necesita el documento del reporte (sin llamadas al API). */
export interface ReportData {
  company: ReportCompany;
  range: ReportRange;
  totals: ReportTotals;
  /** Serie del período (día/semana/mes) con ventas, cobros, gastos y utilidad. */
  series: SalesPoint[];
  topProducts: TopProduct[];
  paymentMethods: PaymentMethodsReport;
  paymentsByCurrency: PaymentsByCurrencyReport;
  /** Ventas por categoría (solo el detalle; el total va en cada fila). */
  categories: CategorySalesReport['items'];
  /** Stock bajo: es el estado ACTUAL del inventario, no del período. */
  lowStock: LowStockItem[];
  /** Detalle de pedidos del rango (los primeros `DETAIL_LIMIT`). */
  orders: Order[];
  /** Total de pedidos del rango según el paginador (puede superar `orders`). */
  ordersTotal: number;
  /** Detalle de gastos del rango (los primeros `DETAIL_LIMIT`). */
  expenses: Expense[];
  /** Total de gastos del rango según el paginador. */
  expensesTotal: number;
  expenseSummary: ExpenseSummary;
  /** Sesiones de caja abiertas/cerradas dentro del rango. */
  cashSessions: CashSession[];
  /** Cuentas por cobrar / pagar (saldo actual, sin filtrar por fecha). */
  receivables: AccountSummary;
  payables: AccountSummary;
  /** Tasas vigentes que se imprimen al pie. */
  rates: ReportRate[];
}

/** Filas de detalle (pedidos / gastos) que se traen para imprimir. */
export const DETAIL_LIMIT = 300;

/** Datos de empresa que encabezan el reporte. */
export function reportCompany(company: Company | null): ReportCompany {
  return {
    name: company?.name ?? 'Mi empresa',
    rif: company?.rif ?? '—',
    logoUrl: company?.logoUrl ?? null,
    phone: company?.phone ?? null,
    email: company?.email ?? null,
    address: company?.address ?? null,
  };
}
