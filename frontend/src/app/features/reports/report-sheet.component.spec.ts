import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Expense } from '../../core/models/finance.model';
import type { CashSession, Order } from '../../core/models/operations.model';
import type { ReportCompany, ReportData } from '../../core/models/report.model';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/services/auth.service';
import { ReportSheetComponent } from './report-sheet.component';

const COMPANY: ReportCompany = {
  name: 'Panadería El Trigal',
  rif: 'J-12345678-9',
  logoUrl: '/media/J-1/logo/logo.png',
  address: 'Av. Principal, Caracas',
  phone: '0212-1234567',
  email: 'contacto@trigal.com',
};

const ORDER = {
  id: 'o1',
  code: 'PD-0001',
  type: 'DINE_IN',
  status: 'COMPLETED',
  paymentStatus: 'PARTIAL',
  total: 120.5,
  paidAmount: 100,
  createdAt: '2026-10-01T15:00:00.000Z',
  customer: { id: 'c1', name: 'María Pérez' },
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
  supplier: { id: 's1', name: 'Distribuidora Sur' },
} as unknown as Expense;

const CASH_SESSION = {
  id: 'c1',
  code: 'CJ-0001',
  status: 'CLOSED',
  openedAt: '2026-10-01T08:00:00.000Z',
  openingAmount: 10,
  expectedAmount: 110,
  countedAmount: 108,
  difference: -2,
} as unknown as CashSession;

/** Documento de prueba: TODO lo que cae dentro del rango pedido. */
function report(partial: Partial<ReportData> = {}): ReportData {
  return {
    company: COMPANY,
    range: {
      from: '2026-10-01',
      to: '2026-10-13',
      label: '01 oct 2026 — 13 oct 2026',
      granularity: 'day',
      generatedAt: '2026-10-13T18:30:00.000Z',
    },
    totals: {
      orders: 3,
      sales: 120.5,
      collected: 100,
      expenses: 20,
      profit: 100.5,
      ticketAverage: 40.17,
    },
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
    topProducts: [
      {
        productId: 'p1',
        name: 'Pan canilla',
        sku: 'PAN-1',
        quantity: 4,
        revenue: 120.5,
        cost: 20,
        profit: 100.5,
      },
    ],
    paymentMethods: {
      total: 100,
      items: [{ method: 'CASH', amount: 100, count: 2, share: 100 }],
    },
    paymentsByCurrency: {
      total: 100,
      items: [{ currency: 'USD', amount: 100, baseAmount: 100, count: 2 }],
    },
    categories: [{ name: 'Panadería', quantity: 4, revenue: 120.5, share: 100 }],
    lowStock: [
      { id: 'p1', sku: 'PAN-1', name: 'Pan canilla', stock: 1, minStock: 5, unit: 'UND' },
    ],
    orders: [ORDER],
    ordersTotal: 1,
    expenses: [EXPENSE],
    expensesTotal: 1,
    expenseSummary: {
      total: 20,
      count: 1,
      byCategory: [{ category: 'OPERATIVO', amount: 20, count: 1 }],
      byMethod: [{ method: 'CASH', amount: 20, count: 1 }],
    },
    cashSessions: [CASH_SESSION],
    receivables: {
      openAmount: 50,
      openPaid: 10,
      openBalance: 40,
      openCount: 2,
      byStatus: [{ status: 'PENDING', count: 2, amount: 50, paid: 10, balance: 40 }],
    },
    payables: {
      openAmount: 30,
      openPaid: 5,
      openBalance: 25,
      openCount: 1,
      byStatus: [{ status: 'PARTIAL', count: 1, amount: 30, paid: 5, balance: 25 }],
    },
    rates: [{ label: 'BCV $', rate: 905 }],
    ...partial,
  };
}

/** Doble mínimo de `AuthService`: solo se usa el nombre de quien elabora. */
const authStub = { user: () => ({ name: 'Ana Pérez' }) };

/** El documento que se imprime en PDF: cabecera, secciones y cierre. */
describe('ReportSheetComponent (documento del reporte)', () => {
  let fixture: ComponentFixture<ReportSheetComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReportSheetComponent],
      providers: [{ provide: AuthService, useValue: authStub }],
    }).compileComponents();
  });

  function mount(data: ReportData = report()): ReportSheetComponent {
    fixture = TestBed.createComponent(ReportSheetComponent);
    fixture.componentRef.setInput('data', data);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  function text(): string {
    return (fixture.nativeElement.textContent ?? '') as string;
  }

  /** Encuentra el botón por su texto (los botones del documento llevan icono). */
  function button(label: string): HTMLButtonElement {
    const found = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find((item) => item.textContent?.includes(label));
    if (!found) throw new Error(`No se encontró el botón "${label}"`);
    return found;
  }

  it('encabeza el reporte con el logo, el RIF y el nombre de la empresa', () => {
    mount();

    expect(text()).toContain('Panadería El Trigal');
    expect(text()).toContain('J-12345678-9');
    expect(text()).toContain('Av. Principal, Caracas');
    expect(text()).toContain('contacto@trigal.com');

    const logo = fixture.nativeElement.querySelector('.rp-logo img') as HTMLImageElement;
    expect(logo.getAttribute('src')).toBe(`${environment.mediaUrl}/J-1/logo/logo.png`);
  });

  it('usa las iniciales cuando la empresa todavía no tiene logo', () => {
    mount(report({ company: { ...COMPANY, logoUrl: null } }));

    expect(fixture.nativeElement.querySelector('.rp-logo img')).toBeNull();
    const initials = fixture.nativeElement.querySelector('.rp-logo span') as HTMLElement;
    expect(initials.textContent?.trim()).toBe('PE');
  });

  it('imprime el rango, la fecha de generación y quién lo elabora', () => {
    mount();

    expect(text()).toContain('01 oct 2026 — 13 oct 2026');
    expect(text()).toContain('Generado el');
    expect(text()).toContain('Ana Pérez');
    expect(text()).toContain('BCV $ 905.0000 Bs');
  });

  it('detalla totales, ventas, productos, pedidos y gastos del rango', () => {
    mount();

    expect(text()).toContain('$ 120.50'); // ventas
    expect(text()).toContain('$ 100.50'); // utilidad
    // Equivalente en bolívares del total de ventas (905 Bs por dólar).
    expect(text()).toContain('≈ Bs 109,052.50');
    expect(text()).toContain('Pan canilla');
    expect(text()).toContain('PD-0001');
    expect(text()).toContain('María Pérez');
    expect(text()).toContain('Compra de hielo');
    expect(text()).toContain('Distribuidora Sur');
    expect(text()).toContain('CJ-0001');
  });

  it('avisa cuando el detalle impreso no cubre todo el rango', () => {
    mount(report({ ordersTotal: 900, expensesTotal: 400 }));

    expect(text()).toContain('los 1 más recientes');
    expect(text()).toContain('900 pedidos');
  });

  it('cierra con el botón y con la tecla Escape', () => {
    const sheet = mount();
    let closed = 0;
    sheet.closed.subscribe(() => (closed += 1));

    button('Cerrar').click();
    expect(closed).toBe(1);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closed).toBe(2);
  });

  it('lleva el papel a la ventana de impresión al descargar el PDF', () => {
    mount();
    const open = spyOn(window, 'open').and.returnValue(null);

    button('Descargar PDF').click();

    expect(open).toHaveBeenCalled();
  });
});
