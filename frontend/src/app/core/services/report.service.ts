import { Injectable, inject } from '@angular/core';
import { forkJoin, map, of, switchMap, type Observable } from 'rxjs';
import type { Paginated } from '../models/api.model';
import type { AccountSummary, Expense, ExpenseSummary } from '../models/finance.model';
import type { CashSession, Order } from '../models/operations.model';
import {
  DETAIL_LIMIT,
  reportCompany,
  type ReportCompany,
  type ReportData,
  type ReportRate,
  type ReportTotals,
} from '../models/report.model';
import type {
  CategorySalesReport,
  LowStockItem,
  PaymentMethodsReport,
  PaymentsByCurrencyReport,
  SalesSeries,
  TopProduct,
} from '../models/stats.model';
import { RATE_META } from '../constants/currency';
import { shortDate } from '../utils/format';
import { CashService } from './cash.service';
import { ExpensesService, PayablesService, ReceivablesService } from './finance.service';
import { OrdersService } from './orders.service';
import { RatesService } from './rates.service';
import { StatsService } from './stats.service';

/** Respuestas crudas del API que forman un reporte (lo que junta `build`). */
export interface ReportParts {
  company: ReportCompany;
  from: string;
  to: string;
  generatedAt: string;
  rates: ReportRate[];
  sales: SalesSeries;
  topProducts: TopProduct[];
  paymentMethods: PaymentMethodsReport;
  paymentsByCurrency: PaymentsByCurrencyReport;
  categories: CategorySalesReport;
  lowStock: LowStockItem[];
  orders: Paginated<Order>;
  expenses: Paginated<Expense>;
  expenseSummary: ExpenseSummary;
  cashSessions: Paginated<CashSession>;
  receivables: AccountSummary;
  payables: AccountSummary;
}

/** Filas por página que acepta el API en los listados (`limit` máximo 100). */
const PAGE_LIMIT = 100;

/** Fecha `YYYY-MM-DD` como `Date` local (mediodía, para no correrse por UTC). */
function localDate(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const date = new Date(`${iso}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Rango legible del reporte: `01 oct 2026 — 13 oct 2026`, o solo la fecha
 * cuando se reporta un único día.
 */
export function reportRangeLabel(from: string, to: string): string {
  const start = shortDate(localDate(from));
  const end = shortDate(localDate(to));
  if (start === end || end === '—') return start;
  if (start === '—') return end;
  return `${start} — ${end}`;
}

/** Arma el documento del reporte a partir de las respuestas del API. */
export function assembleReport(parts: ReportParts): ReportData {
  const totals: ReportTotals = {
    orders: parts.sales.totals.orders,
    sales: parts.sales.totals.sales,
    collected: parts.sales.totals.collected,
    expenses: parts.sales.totals.expenses,
    profit: parts.sales.totals.profit,
    ticketAverage: parts.sales.totals.ticketAverage,
  };

  return {
    company: parts.company,
    range: {
      from: parts.from,
      to: parts.to,
      label: reportRangeLabel(parts.from, parts.to),
      granularity: parts.sales.range.granularity,
      generatedAt: parts.generatedAt,
    },
    totals,
    series: parts.sales.series,
    topProducts: parts.topProducts,
    paymentMethods: parts.paymentMethods,
    paymentsByCurrency: parts.paymentsByCurrency,
    categories: parts.categories.items,
    lowStock: parts.lowStock,
    orders: parts.orders.items,
    ordersTotal: parts.orders.meta.total,
    expenses: parts.expenses.items,
    expensesTotal: parts.expenses.meta.total,
    expenseSummary: parts.expenseSummary,
    cashSessions: parts.cashSessions.items,
    receivables: parts.receivables,
    payables: parts.payables,
    rates: parts.rates,
  };
}

/**
 * Junta TODO lo que hay dentro de un rango de fechas para imprimirlo en el
 * reporte: resumen, serie, productos, categorías, cobros por moneda, detalle de
 * pedidos y gastos, caja y cuentas por cobrar / pagar.
 *
 * Son peticiones de solo lectura a los servicios que ya usa el sistema: no hay
 * endpoint nuevo en el backend.
 */
@Injectable({ providedIn: 'root' })
export class ReportService {
  private readonly stats = inject(StatsService);
  private readonly orders = inject(OrdersService);
  private readonly expenses = inject(ExpensesService);
  private readonly payables = inject(PayablesService);
  private readonly receivables = inject(ReceivablesService);
  private readonly cash = inject(CashService);
  private readonly rates = inject(RatesService);

  /**
   * Todo lo del rango `from`-`to` (ambos `YYYY-MM-DD`), listo para imprimir.
   *
   * Los listados del API aceptan como máximo 100 filas por página (el DTO
   * valida `limit`), así que el detalle de pedidos y gastos se arma juntando
   * páginas hasta `DETAIL_LIMIT` filas.
   */
  build(from: string, to: string, company: ReportCompany | null = null): Observable<ReportData> {
    const range = { from, to };

    return forkJoin({
      sales: this.stats.sales(range),
      topProducts: this.stats.topProducts({ ...range, limit: 20 }),
      paymentMethods: this.stats.paymentMethods(range),
      paymentsByCurrency: this.stats.paymentsByCurrency(range),
      categories: this.stats.salesByCategory(range),
      // El stock bajo es el estado ACTUAL del inventario, no del rango.
      lowStock: this.stats.lowStock({ limit: 50 }),
      orders: this.collectPages((page) =>
        this.orders.list({ ...range, page, limit: PAGE_LIMIT }),
      ),
      expenses: this.collectPages((page) =>
        this.expenses.list({ ...range, page, limit: PAGE_LIMIT }),
      ),
      expenseSummary: this.expenses.summary(range),
      cashSessions: this.collectPages((page) =>
        this.cash.sessions({ ...range, page, limit: PAGE_LIMIT }),
      ),
      receivables: this.receivables.summary(),
      payables: this.payables.summary(),
    }).pipe(
      map((data) =>
        assembleReport({
          company: company ?? reportCompany(null),
          from,
          to,
          generatedAt: new Date().toISOString(),
          rates: this.activeRates(),
          ...data,
        }),
      ),
    );
  }

  /**
   * Junta las páginas de un listado hasta `DETAIL_LIMIT` filas.
   *
   * Primero pide la página 1 y luego, solo si hay más, las restantes en
   * paralelo: con pocos registros el reporte sigue costando una sola petición.
   * El `meta` que se devuelve es el de la primera página, así el documento
   * puede decir cuántos registros hay en total.
   */
  private collectPages<T>(
    fetch: (page: number) => Observable<Paginated<T>>,
  ): Observable<Paginated<T>> {
    const pages = Math.ceil(DETAIL_LIMIT / PAGE_LIMIT);

    return fetch(1).pipe(
      switchMap((first) => {
        const last = Math.min(first.meta.totalPages, pages);
        if (last <= 1) return of(first);

        const rest = Array.from({ length: last - 1 }, (_, index) => fetch(index + 2));
        return forkJoin(rest).pipe(
          map((others) => ({
            items: [first, ...others].flatMap((page) => page.items),
            meta: first.meta,
            totals: first.totals,
          })),
        );
      }),
    );
  }

  /** Tasas vigentes con su etiqueta (lo que se imprime al pie del reporte). */
  private activeRates(): ReportRate[] {
    return this.rates.rates().map((option) => ({
      label: RATE_META[option.key]?.shortLabel ?? option.key,
      rate: option.rate,
    }));
  }
}
