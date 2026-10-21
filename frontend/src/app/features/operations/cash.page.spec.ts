import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { environment } from '../../../environments/environment';
import type { PaginationMeta } from '../../core/models/api.model';
import type {
  CashMovement,
  CashSession,
  CashSummary,
} from '../../core/models/operations.model';
import type {
  CurrencyRateOption,
  RatesSnapshot,
} from '../../core/models/rates.model';
import { RatesService } from '../../core/services/rates.service';
import { setDisplayCurrency } from '../../core/utils/format';
import { ConfirmService } from '../../shared/services/confirm.service';
import { CashPage } from './cash.page';

const API = environment.apiUrl;

/** Tasa del dolar usada en las pruebas (Bs por USD). */
const BS_PER_USD = 905;
/** Bolivares por 1 euro (tasa del BCV). */
const BS_PER_EUR = 982.00454402;

const META: PaginationMeta = {
  total: 0,
  page: 1,
  limit: 20,
  totalPages: 0,
  hasNextPage: false,
  hasPreviousPage: false,
};

function currencyRate(
  code: string,
  label: string,
  bsPerUnit: number | null,
  isBase = false,
): CurrencyRateOption {
  return {
    code,
    label,
    symbol: code,
    enabled: true,
    bsPerUnit,
    source: isBase ? 'CUSTOM' : 'BCV',
    isBase,
    isDisplayBase: isBase,
    bsPerUsd: BS_PER_USD,
  };
}

/** Snapshot de tasas: USD base a 905 Bs, VES a 1 Bs y EUR a 982 Bs. */
const SNAPSHOT: RatesSnapshot = {
  bcv: {
    current: { date: '2026-10-13', usd: BS_PER_USD, eur: BS_PER_EUR },
    previous: { date: '2026-10-12', usd: 900, eur: 980 },
    changePercentage: { usd: 0.56, eur: 0.2 },
    fetchedAt: '2026-10-13T12:00:00.000Z',
    expiresAt: '2026-10-13T18:00:00.000Z',
    stale: false,
    sourceUrl: 'https://rates.dolarvzla.com/bcv/current.json',
  },
  custom: {
    usd: BS_PER_USD,
    updatedAt: '2026-10-13T12:00:00.000Z',
    updatedBy: null,
  },
  rates: [
    {
      key: 'BCV_USD',
      currency: 'USD',
      source: 'BCV',
      rate: BS_PER_USD,
      date: '2026-10-13',
      previousRate: 900,
      changePercentage: 0.56,
    },
    {
      key: 'BCV_EUR',
      currency: 'EUR',
      source: 'BCV',
      rate: BS_PER_EUR,
      date: '2026-10-13',
      previousRate: 980,
      changePercentage: 0.2,
    },
  ],
  activeKey: 'CUSTOM_USD',
  currencies: [
    currencyRate('USD', 'Dolares', BS_PER_USD, true),
    currencyRate('VES', 'Bolivares', 1),
    currencyRate('EUR', 'Euros', BS_PER_EUR),
  ],
  baseCurrency: {
    code: 'USD',
    label: 'Dolares',
    symbol: '$',
    decimals: 2,
    bsPerUnit: BS_PER_USD,
    bsPerUsd: BS_PER_USD,
  },
  reference: null,
};

function session(partial: Partial<CashSession> = {}): CashSession {
  return {
    id: 's1',
    code: 'CJ-20261013-0001',
    status: 'CLOSED',
    openedAt: '2026-10-13T08:00:00.000Z',
    openingAmount: 0,
    ...partial,
  };
}


/** Pruebas del fondo inicial contado en una o varias monedas. */
describe('CashPage (fondo inicial multimoneda)', () => {
  let http: HttpTestingController;
  let rates: RatesService;
  let confirm: ConfirmService;
  /** Componente montado por `mount()`: permite revisar el DOM renderizado. */
  let fixture: ComponentFixture<CashPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CashPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    rates = TestBed.inject(RatesService);
    confirm = TestBed.inject(ConfirmService);
  });

  afterEach(() => {
    // Las preferencias del navegador viven en el almacenamiento y la moneda de
    // visualización en un signal global: ninguna debe filtrarse a otra prueba.
    localStorage.clear();
    setDisplayCurrency(null);
    http.verify();
  });

  /** Monta la pagina con la caja cerrada y las tasas configuradas. */
  function mount(withRates = true): CashPage {
    rates.load();
    if (withRates) http.expectOne(`${API}/rates`).flush(SNAPSHOT);

    fixture = TestBed.createComponent(CashPage);
    fixture.detectChanges();

    http
      .expectOne((request) => request.url === `${API}/cash/current`)
      .flush({ session: null, summary: null, reconciliation: null });
    http
      .match((request) => request.url === `${API}/cash/movements`)
      .forEach((request) => request.flush({ items: [], meta: META }));
    http
      .match((request) => request.url === `${API}/cash/sessions`)
      .forEach((request) => request.flush({ items: [], meta: META }));
    fixture.detectChanges();

    return fixture.componentInstance;
  }

  it('abre el formulario con una linea en la moneda base', () => {
    const page = mount();

    expect(page.openForm.lines).toEqual([{ currency: 'USD', amount: 0 }]);
    expect(page.openingTotal).toBe(0);
  });

  it('agrega una linea por cada moneda habilitada y permite quitarlas', () => {
    const page = mount();

    page.addOpeningLine();
    page.addOpeningLine();

    expect(page.openForm.lines.map((line) => line.currency)).toEqual([
      'USD',
      'VES',
      'EUR',
    ]);

    page.removeOpeningLine(1);
    expect(page.openForm.lines.map((line) => line.currency)).toEqual(['USD', 'EUR']);

    // La ultima linea no se puede quitar: el fondo necesita al menos una.
    page.removeOpeningLine(0);
    expect(page.openForm.lines.length).toBe(1);
  });

  it('suma el fondo en la moneda base (100 USD + 5.000 Bs + 50 EUR)', () => {
    const page = mount();

    page.openForm.lines = [
      { currency: 'USD', amount: 100 },
      { currency: 'VES', amount: 5000 },
      { currency: 'EUR', amount: 50 },
    ];

    // 100 + 5000/905 (5,524861...) + 50*982.00454402/905 (54,254395...) =
    // 159,779256..., sin redondear a centavos.
    expect(page.openingTotal).toBeCloseTo(159.7792565757, 8);
    expect(page.openingMissingRates).toEqual([]);
    expect(page.openingLines.length).toBe(3);
  });

  it('avisa de las monedas del fondo sin tasa y las excluye del total', () => {
    const page = mount();

    rates.load(true);
    http.expectOne(`${API}/rates?refresh=true`).flush({
      ...SNAPSHOT,
      currencies: [
        currencyRate('USD', 'Dolares', BS_PER_USD, true),
        currencyRate('VES', 'Bolivares', 1),
        currencyRate('EUR', 'Euros', null),
      ],
    });

    page.openForm.lines = [
      { currency: 'USD', amount: 100 },
      { currency: 'EUR', amount: 50 },
    ];

    expect(page.openingMissingRates).toEqual(['EUR']);
    expect(page.openingTotal).toBe(100);
  });

  it('envia el fondo multimoneda al abrir la caja', async () => {
    const page = mount();
    page.openForm.lines = [
      { currency: 'USD', amount: 100 },
      { currency: 'VES', amount: 5000 },
    ];
    page.openForm.openingNotes = 'fondo del turno';

    const opening = page.openCash();
    const request = http.expectOne(
      (candidate) =>
        candidate.method === 'POST' && candidate.url === `${API}/cash/open`,
    );
    // 100 + 5000/905 = 105,524861...: el fondo viaja con la precisión completa.
    expect(request.request.body.openingAmount).toBeCloseTo(100 + 5000 / 905, 8);
    expect(request.request.body.openingLines).toEqual([
      { currency: 'USD', amount: 100 },
      { currency: 'VES', amount: 5000 },
    ]);
    expect(request.request.body.openingNotes).toBe('fondo del turno');
    request.flush(session({ status: 'OPEN', openingAmount: 105.52 }));
    await opening;

    // Tras abrir, la pagina recarga el arqueo y limpia el formulario.
    http
      .expectOne((candidate) => candidate.url === `${API}/cash/current`)
      .flush({ session: null, summary: null, reconciliation: null });
    expect(page.openForm.lines).toEqual([{ currency: 'USD', amount: 0 }]);
  });

  it('pide confirmacion para abrir la caja sin fondo', async () => {
    const page = mount();

    const opening = page.openCash();
    expect(confirm.state().open).toBe(true);
    confirm.resolve(false);
    await opening;

    // Cancelado: no se envia ninguna apertura.
    expect(
      http.match(
        (candidate) =>
          candidate.method === 'POST' && candidate.url === `${API}/cash/open`,
      ).length,
    ).toBe(0);
  });

  it('resume el fondo de las sesiones del historial', () => {
    const page = mount();

    const mixed = session({
      openingCurrency: 'MIX',
      openingAmount: 159.77,
      openingLines: [
        { currency: 'USD', amount: 100, rate: 905, baseAmount: 100 },
        { currency: 'VES', amount: 5000, rate: 1, baseAmount: 5.52 },
        { currency: 'EUR', amount: 50, rate: BS_PER_EUR, baseAmount: 54.25 },
      ],
    });
    expect(page.openingFundHint(mixed)).toBe(
      'fondo en 3 monedas · USD + VES + EUR',
    );

    // Sesion de una sola moneda contada en bolivares (la tasa se formatea a 4).
    expect(
      page.openingFundHint(
        session({ openingCurrency: 'VES', openingRate: 1, openingAmount: 2 }),
      ),
    ).toBe('contado en VES · × 1.0000');

    // Sesion en la moneda base: sin texto extra bajo el monto.
    expect(
      page.openingFundHint(session({ openingCurrency: 'USD', openingRate: 905 })),
    ).toBeNull();
  });

  it('muestra el fondo por moneda del arqueo en vivo', () => {
    const page = mount();
    const summary: CashSummary = {
      cashIn: 0,
      cashOut: 0,
      expectedCash: 105.52,
      totalIn: 0,
      totalOut: 0,
      net: 0,
      salesTotal: 0,
      tipsTotal: 0,
      movementCount: 0,
      byMethod: [],
      byCategory: [],
      byCurrency: [],
      openingByCurrency: [
        { currency: 'USD', amount: 100, rate: 905, baseAmount: 100 },
        { currency: 'VES', amount: 5000, rate: 1, baseAmount: 5.52 },
      ],
      openingMixed: true,
    };
    page.summary.set(summary);
    page.session.set(
      session({
        status: 'OPEN',
        openingAmount: 105.52,
        openingCurrency: 'MIX',
        openingLines: summary.openingByCurrency,
      }),
    );

    expect(page.openingFund.length).toBe(2);
    expect(page.openingFund[1]).toEqual({
      currency: 'VES',
      amount: 5000,
      rate: 1,
      baseAmount: 5.52,
    });
    expect(page.openingStatHint).toBe('contado en 2 monedas');
  });

  it('muestra la tarjeta de propinas y separa las ventas en el cierre', () => {
    const page = mount();
    const summary: CashSummary = {
      cashIn: 110,
      cashOut: 0,
      expectedCash: 110,
      totalIn: 110,
      totalOut: 0,
      net: 110,
      // Un cobro de 110: 100 de consumo + 10 de propina.
      salesTotal: 100,
      tipsTotal: 10,
      movementCount: 1,
      byMethod: [],
      byCategory: [],
      byCurrency: [],
    };
    page.session.set(session({ status: 'OPEN', openingAmount: 0 }));
    page.summary.set(summary);
    fixture.detectChanges();

    // Tarjeta del arqueo (vista de caja) con la propina del turno.
    const cards = fixture.nativeElement.textContent as string;
    expect(cards).toContain('Propinas');
    expect(page.salesTotal).toBe(100);
    expect(page.tipsTotal).toBe(10);
    // Lo cobrado por ventas = consumo + propina.
    expect(page.salesGrossTotal).toBe(110);

    // El cierre separa propinas de ventas antes de contar el cajón.
    page.openClose();
    fixture.detectChanges();
    const closing = fixture.nativeElement.textContent as string;
    expect(closing).toContain('Ventas (sin propinas)');
    expect(closing).toContain('Total cobrado por ventas');
    expect(page.closeDifference).toBe(0);
  });

  it('deja las propinas en cero cuando el turno no cobró ninguna', () => {
    const page = mount();
    const summary: CashSummary = {
      cashIn: 25,
      cashOut: 0,
      expectedCash: 25,
      totalIn: 25,
      totalOut: 0,
      net: 25,
      salesTotal: 25,
      tipsTotal: 0,
      movementCount: 1,
      byMethod: [],
      byCategory: [],
      byCurrency: [],
    };
    page.summary.set(summary);

    expect(page.tipsTotal).toBe(0);
    // Sin propinas, lo cobrado por ventas es la venta tal cual.
    expect(page.salesGrossTotal).toBe(25);
  });

  /**
   * El efectivo de la caja se sigue viendo en la moneda en la que entró: si el
   * cajero mira los precios en bolívares, un cobro en dólares se muestra en
   * dólares y solo la columna del equivalente (contable) usa la moneda con la que
   * se ven los montos. Sin esto, el arqueo mostraría un "entrada de efectivo" que
   * no corresponde a los billetes que hay en el cajón.
   */
  it('muestra el efectivo en la moneda en la que entró, no en la de los precios', () => {
    const page = mount();
    // El cajero ve los precios en bolívares (Configuración → Cajero).
    setDisplayCurrency({
      code: 'VES',
      label: 'Bolívares',
      symbol: 'Bs',
      decimals: 2,
      bsPerUnit: 1,
      bsPerUsd: BS_PER_USD,
    });

    page.movItems.set([
      {
        id: 'mv1',
        sessionId: 's1',
        type: 'IN',
        category: 'SALE',
        paymentMethod: 'CASH',
        amount: 20,
        currency: 'USD',
        baseAmount: 20,
        createdAt: '2026-10-13T10:00:00.000Z',
      } satisfies CashMovement,
    ]);
    fixture.detectChanges();

    const table = fixture.nativeElement.querySelector('table.table') as HTMLElement;

    // La moneda del movimiento y su monto, tal como entraron al cajón.
    expect(table.textContent).toContain('USD');
    expect(table.textContent).toContain('$ 20.00');
    // Y el equivalente contable en la moneda de visualización (20 USD * 905).
    expect(table.textContent).toContain('Bs 18,100.00');
  });
});
