import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import type { PaginationMeta } from '../models/api.model';
import type { AccountSummary, Expense, ExpenseSummary } from '../models/finance.model';
import type { CashSession, Order } from '../models/operations.model';
import type { ReportCompany, ReportData } from '../models/report.model';
import type { SalesSeries } from '../models/stats.model';
import { ReportService, assembleReport, reportRangeLabel } from './report.service';
import type { ReportParts } from './report.service';

const API = environment.apiUrl;

const META: PaginationMeta = {
  total: 1,
  page: 1,
  limit: 100,
  totalPages: 1,
  hasNextPage: false,
  hasPreviousPage: false,
};

const SALES: SalesSeries = {
  range: { from: '2026-10-01', to: '2026-10-13', granularity: 'day' },
  series: [
    {
      period: '2026-10-01',
      orders: 3,
      sales: 120.5,
      collected: 100,
      expenses: 20,
      profit: 100.5,
    },
  ],
  totals: {
    orders: 3,
    sales: 120.5,
    collected: 100,
    expenses: 20,
    profit: 100.5,
    ticketAverage: 40.17,
  },
};

const ORDER = {
  id: 'o1',
  code: 'PD-0001',
  type: 'DINE_IN',
  status: 'COMPLETED',
  paymentStatus: 'PAID',
  subtotal: 100,
  discount: 0,
  tax: 0,
  total: 120.5,
  paidAmount: 100,
  createdAt: '2026-10-01T15:00:00.000Z',
  updatedAt: '2026-10-01T15:00:00.000Z',
} as unknown as Order;

const EXPENSE = {
  id: 'e1',
  category: 'OPERATIVO',
  description: 'Compra de hielo',
  amount: 20,
  currency: 'USD',
  baseAmount: 20,
  date: '2026-10-01T10:00:00.000Z',
  paymentMethod: 'CASH',
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
} as unknown as Expense;

const CASH_SESSION = {
  id: 'c1',
  code: 'CJ-0001',
  status: 'CLOSED',
  openedAt: '2026-10-01T08:00:00.000Z',
  openingAmount: 10,
} as unknown as CashSession;

const EXPENSE_SUMMARY: ExpenseSummary = {
  total: 20,
  count: 1,
  byCategory: [{ category: 'OPERATIVO', amount: 20, count: 1 }],
  byMethod: [{ method: 'CASH', amount: 20, count: 1 }],
};

const ACCOUNTS: AccountSummary = {
  openAmount: 50,
  openPaid: 10,
  openBalance: 40,
  openCount: 2,
  byStatus: [{ status: 'PENDING', count: 2, amount: 50, paid: 10, balance: 40 }],
};

const COMPANY: ReportCompany = {
  name: 'Panaderia El Trigal',
  rif: 'J-12345678-9',
  logoUrl: 'data:image/png;base64,AAAA',
};

/** Todas las respuestas crudas del API con las que se arma un reporte. */
function parts(): ReportParts {
  return {
    company: COMPANY,
    from: '2026-10-01',
    to: '2026-10-13',
    generatedAt: '2026-10-13T18:30:00.000Z',
    rates: [{ label: 'BCV $', rate: 905 }],
    sales: SALES,
    topProducts: [],
    paymentMethods: { total: 100, items: [] },
    paymentsByCurrency: { total: 100, items: [] },
    categories: {
      total: 120.5,
      items: [{ name: 'Panaderia', quantity: 4, revenue: 120.5, share: 100 }],
    },
    lowStock: [],
    orders: { items: [ORDER], meta: { ...META, total: 1 } },
    expenses: { items: [EXPENSE], meta: { ...META, total: 1 }, totals: { amount: 20 } },
    expenseSummary: EXPENSE_SUMMARY,
    cashSessions: { items: [CASH_SESSION], meta: { ...META, total: 1 } },
    receivables: ACCOUNTS,
    payables: ACCOUNTS,
  };
}

/** Rango legible y armado del documento (logica pura del reporte). */
describe('ReportService (rango y armado del reporte)', () => {
  it('escribe el rango como una sola fecha o como rango completo', () => {
    expect(reportRangeLabel('2026-10-01', '2026-10-13')).toBe('01 oct. 2026 — 13 oct. 2026');
    expect(reportRangeLabel('2026-10-13', '2026-10-13')).toBe('13 oct. 2026');
  });

  it('no se corre un dia por la zona horaria', () => {
    expect(reportRangeLabel('2026-01-01', '2026-01-01')).toBe('01 ene. 2026');
    expect(reportRangeLabel('2026-12-31', '2027-01-01')).toBe('31 dic. 2026 — 01 ene. 2027');
  });

  it('arma el documento con los totales, listas y tasas recibidas', () => {
    const data = assembleReport(parts());
    expect(data.company).toEqual(COMPANY);
    expect(data.range.label).toBe('01 oct. 2026 — 13 oct. 2026');
    expect(data.range.granularity).toBe('day');
    expect(data.totals).toEqual({
      orders: 3,
      sales: 120.5,
      collected: 100,
      expenses: 20,
      profit: 100.5,
      ticketAverage: 40.17,
    });
    expect(data.orders.length).toBe(1);
    expect(data.ordersTotal).toBe(1);
    expect(data.expenses.length).toBe(1);
    expect(data.categories).toEqual([
      { name: 'Panaderia', quantity: 4, revenue: 120.5, share: 100 },
    ]);
    expect(data.cashSessions.length).toBe(1);
    expect(data.receivables.openBalance).toBe(40);
    expect(data.rates).toEqual([{ label: 'BCV $', rate: 905 }]);
  });

  it('conserva el total del rango aunque el detalle impreso sea una pagina', () => {
    const data = assembleReport({
      ...parts(),
      orders: { items: [ORDER], meta: { ...META, total: 900 } },
      expenses: { items: [EXPENSE], meta: { ...META, total: 400 }, totals: { amount: 20 } },
    });
    expect(data.orders.length).toBe(1);
    expect(data.ordersTotal).toBe(900);
    expect(data.expensesTotal).toBe(400);
  });
});

/** Respuesta minima valida para cada endpoint que consulta el reporte. */
function payloadFor(url: string): object {
  if (url.endsWith('/stats/sales')) return SALES;
  if (url.endsWith('/stats/top-products')) {
    return [
      {
        productId: 'p1',
        name: 'Pan canilla',
        sku: 'PAN-1',
        quantity: 4,
        revenue: 120.5,
        cost: 20,
        profit: 100.5,
      },
    ];
  }
  if (url.endsWith('/stats/payment-methods')) {
    return { total: 100, items: [{ method: 'CASH', amount: 100, count: 2, share: 100 }] };
  }
  if (url.endsWith('/stats/currencies')) {
    return { total: 100, items: [{ currency: 'USD', amount: 100, baseAmount: 100, count: 2 }] };
  }
  if (url.endsWith('/stats/categories')) {
    return {
      total: 120.5,
      items: [{ name: 'Panaderia', quantity: 4, revenue: 120.5, share: 100 }],
    };
  }
  if (url.endsWith('/stats/low-stock')) {
    return [{ id: 'p1', sku: 'PAN-1', name: 'Pan canilla', stock: 1, minStock: 5, unit: 'UND' }];
  }
  if (url.endsWith('/orders')) return { items: [ORDER], meta: { ...META, total: 1 } };
  if (url.endsWith('/expenses')) {
    return { items: [EXPENSE], meta: { ...META, total: 1 }, totals: { amount: 20 } };
  }
  if (url.endsWith('/expenses/summary')) return EXPENSE_SUMMARY;
  if (url.endsWith('/cash/sessions')) return { items: [CASH_SESSION], meta: { ...META, total: 1 } };
  if (url.includes('/receivables/summary')) return ACCOUNTS;
  if (url.includes('/payables/summary')) return ACCOUNTS;
  throw new Error(`Sin respuesta de prueba para ${url}`);
}

/** El reporte se pide de una sola pasada: sin endpoints nuevos en el backend. */
describe('ReportService.build', () => {
  let http: HttpTestingController;
  let service: ReportService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(ReportService);
  });

  afterEach(() => http.verify());

  it('pide todo lo del rango y arma el documento', () => {
    let result: ReportData | undefined;
    service.build('2026-10-01', '2026-10-13', COMPANY).subscribe((data) => (result = data));

    const requests = http.match(() => true);
    expect(requests.length).toBe(12);

    for (const request of requests) {
      // Los recursos del periodo llevan el filtro de fechas; el stock bajo y los
      // saldos de cuentas son el estado actual y no lo llevan.
      const url = request.request.url;
      if (!url.endsWith('/stats/low-stock') && !url.includes('/summary')) {
        expect(request.request.params.get('from')).toBe('2026-10-01');
        expect(request.request.params.get('to')).toBe('2026-10-13');
      }
    }

    const orders = requests.find((item) => item.request.url === `${API}/orders`);
    // El API pagina de a 100 como máximo; el reporte pide la primera página.
    expect(orders?.request.params.get('limit')).toBe('100');
    expect(orders?.request.params.get('page')).toBe('1');
    expect(orders?.request.params.get('from')).toBe('2026-10-01');
    expect(orders?.request.params.get('to')).toBe('2026-10-13');

    for (const request of requests) {
      request.flush(payloadFor(request.request.url));
    }

    expect(result?.company).toEqual(COMPANY);
    expect(result?.totals.sales).toBe(120.5);
    expect(result?.orders[0]?.code).toBe('PD-0001');
    expect(result?.expenses[0]?.description).toBe('Compra de hielo');
    expect(result?.range.label).toBe('01 oct. 2026 — 13 oct. 2026');
  });

  it('junta las páginas del detalle cuando hay más de una', () => {
    let result: ReportData | undefined;
    service.build('2026-10-01', '2026-10-13', COMPANY).subscribe((data) => (result = data));

    const orderRequests = () => http.match((request) => request.url === `${API}/orders`);

    // Primero llega todo lo que no es pedidos (cada uno de una sola página).
    for (const request of http.match((item) => item.url !== `${API}/orders`)) {
      request.flush(payloadFor(request.request.url));
    }

    // La página 1 anuncia 3 páginas de pedidos: se piden la 2 y la 3.
    const first = orderRequests();
    expect(first.length).toBe(1);
    first[0].flush({
      items: [ORDER],
      meta: { ...META, total: 250, totalPages: 3, hasNextPage: true },
    });

    const rest = orderRequests();
    expect(rest.map((request) => request.request.params.get('page'))).toEqual(['2', '3']);
    rest[0].flush({ items: [{ ...ORDER, id: 'o2' }], meta: META });
    rest[1].flush({ items: [{ ...ORDER, id: 'o3' }], meta: META });

    expect(result?.orders.length).toBe(3);
    // El total impreso es el del rango completo, no el de las filas traídas.
    expect(result?.ordersTotal).toBe(250);
  });
});

