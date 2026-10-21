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
  CurrencyBreakdown,
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

  it('muestra en las tarjetas del arqueo el monto exacto, sin abreviar', () => {
    const page = mount();
    // El cajero ve los precios en dólares: los montos no se abrevian.
    setDisplayCurrency(null);
    page.session.set(session({ status: 'OPEN', openingAmount: 0 }));
    page.summary.set({
      cashIn: 1_250,
      cashOut: 0,
      expectedCash: 1_250,
      totalIn: 1_250,
      totalOut: 0,
      net: 1_250,
      salesTotal: 1_250,
      tipsTotal: 0,
      movementCount: 1_250,
      byMethod: [],
      byCategory: [],
      byCurrency: [],
    });
    fixture.detectChanges();

    const cards = fixture.nativeElement.querySelectorAll('app-stat-card');
    expect(cards.length).toBe(7);

    const text = fixture.nativeElement.textContent as string;
    // Monto exacto (no "$ 1.3k" ni "1.3k") y cantidad tal cual.
    expect(text).toContain('$ 1,250.00');
    expect(text).not.toContain('$ 1.3k');
    expect(text).toContain('1,250');
    expect(text).not.toContain('1.3k');
  });

  it('achica el monto exacto de las tarjetas cuando el cajero ve bolívares', () => {
    const page = mount();
    setDisplayCurrency({
      code: 'VES',
      label: 'Bolívares',
      symbol: 'Bs',
      decimals: 2,
      bsPerUnit: 1,
      bsPerUsd: BS_PER_USD,
    });
    page.session.set(session({ status: 'OPEN', openingAmount: 0 }));
    page.summary.set({
      cashIn: 1_250,
      cashOut: 0,
      expectedCash: 1_250,
      totalIn: 1_250,
      totalOut: 0,
      net: 1_250,
      salesTotal: 1_250,
      tipsTotal: 0,
      movementCount: 1,
      byMethod: [],
      byCategory: [],
      byCurrency: [],
    });
    fixture.detectChanges();

    // 1 250 USD al BCV (905) = Bs 1.131.250,00: el monto completo y en letra
    // menor, porque en una tarjeta de siete por fila no cabe a 2xl.
    const amounts = Array.from<HTMLElement>(
      fixture.nativeElement.querySelectorAll('app-stat-card app-money'),
    );
    const income = amounts.find((node) => node.textContent?.includes('1,131,250.00'));
    expect(income).toBeTruthy();
    expect(income?.classList).toContain('text-base');
    expect(income?.classList).not.toContain('text-2xl');
  });

  it('pinta el equivalente del desglose por moneda a la tasa del BCV', () => {
    const page = mount();
    // La vitrina está en 970 Bs por dólar y el BCV en 905: el equivalente del
    // arqueo debe salir a la tasa oficial, como las tarjetas y las tablas.
    setDisplayCurrency({
      code: 'VES',
      label: 'Bolívares',
      symbol: 'Bs',
      decimals: 2,
      bsPerUnit: 1,
      bsPerUsd: 970,
    });
    page.session.set(session({ status: 'OPEN', openingAmount: 0 }));
    page.summary.set({
      cashIn: 20,
      cashOut: 0,
      expectedCash: 20,
      totalIn: 20,
      totalOut: 0,
      net: 20,
      salesTotal: 20,
      tipsTotal: 0,
      movementCount: 1,
      byMethod: [],
      byCategory: [],
      byCurrency: [
        {
          currency: 'USD',
          in: 20,
          out: 0,
          net: 20,
          baseIn: 20,
          baseOut: 0,
          baseNet: 20,
          cashIn: 20,
          cashOut: 0,
          baseCashIn: 20,
          baseCashOut: 0,
          sales: 20,
          tips: 0,
          change: 0,
          baseSales: 20,
          baseTips: 0,
          baseChange: 0,
          methods: [
            {
              method: 'CASH',
              in: 20,
              out: 0,
              net: 20,
              baseIn: 20,
              baseOut: 0,
              baseNet: 20,
            },
          ],
        },
      ],
    });
    page.openClose();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    // 20 USD * 905 (BCV), no 20 USD * 970 (vitrina).
    expect(text).toContain('Bs 18,100.00 equivalente');
    expect(text).not.toContain('Bs 19,400.00 equivalente');
  });

  /**
   * El efectivo esperado es el número con el que se cierra la caja: el backend
   * acumula cada movimiento con su equivalente exacto y recorta una sola vez, así
   * que la pantalla lo pinta tal cual (convertido a la moneda que se ve) en vez de
   * rehacer la suma por moneda. Rehacerla dejaba la tarjeta un centavo por encima
   * del cierre (41,72 contra 41,71) y el cajero veía una diferencia que no existe.
   *
   * La fila del desglose sí conserva los bolívares que entraron al cajón: esos son
   * los billetes que se cuentan, no su equivalente contable.
   */
  it('pinta los totales del arqueo tal como los cierra el backend', () => {
    const page = mount();
    setDisplayCurrency({
      code: 'VES',
      label: 'Bolívares',
      symbol: 'Bs',
      decimals: 2,
      bsPerUnit: 1,
      bsPerUsd: 970,
    });

    const ves: CurrencyBreakdown = {
      currency: 'VES',
      in: 15_520,
      out: 0,
      net: 15_520,
      baseIn: 17.57,
      baseOut: 0,
      baseNet: 17.57,
      cashIn: 15_520,
      cashOut: 0,
      baseCashIn: 17.57,
      baseCashOut: 0,
      sales: 15_520,
      tips: 0,
      change: 0,
      baseSales: 17.57,
      baseTips: 0,
      baseChange: 0,
      methods: [
        {
          method: 'CASH',
          in: 15_520,
          out: 0,
          net: 15_520,
          baseIn: 17.57,
          baseOut: 0,
          baseNet: 17.57,
        },
      ],
    };

    page.session.set(session({ status: 'OPEN', openingAmount: 0 }));
    page.summary.set({
      cashIn: 17.57,
      cashOut: 0,
      expectedCash: 17.57,
      totalIn: 17.57,
      totalOut: 0,
      net: 17.57,
      salesTotal: 17.57,
      tipsTotal: 0,
      movementCount: 1,
      byMethod: [{ method: 'CASH', in: 17.57, out: 0, net: 17.57 }],
      byCategory: [],
      byCurrency: [ves],
    });
    page.movItems.set([
      {
        id: 'mv1',
        sessionId: 's1',
        type: 'IN',
        category: 'SALE',
        paymentMethod: 'CASH',
        amount: 15_520,
        currency: 'VES',
        baseAmount: 17.57,
        createdAt: '2026-10-13T10:00:00.000Z',
      } satisfies CashMovement,
    ]);
    fixture.detectChanges();

    // Las tarjetas y los totales salen del arqueo del backend, al BCV (905).
    const expectedInBs = 17.57 * BS_PER_USD;
    expect(page.cashInDisplay).toBeCloseTo(expectedInBs, 6);
    expect(page.expectedCashDisplay).toBeCloseTo(expectedInBs, 6);
    expect(page.salesTotalDisplay).toBeCloseTo(expectedInBs, 6);
    expect(page.byMethodRows[0].inDisplay).toBeCloseTo(expectedInBs, 6);
    // El desglose por moneda sigue en los bolívares cobrados.
    expect(page.currencyNetDisplay(ves)).toBe(15_520);

    // Con los montos en dólares (el admin) la tarjeta es el centavo exacto con el
    // que se cierra la caja: la diferencia del cierre queda en 0.
    setDisplayCurrency(null);
    fixture.detectChanges();

    expect(page.cashInDisplay).toBe(17.57);
    expect(page.expectedCashDisplay).toBe(17.57);
    expect(page.salesTotalDisplay).toBe(17.57);
    expect(page.byMethodRows[0].inDisplay).toBe(17.57);
    expect(page.expectedCashDisplay).toBe(page.expectedCash);

    page.closeForm.countedAmount = page.expectedCash;
    expect(page.closeDifference).toBe(0);

    const inUsd = fixture.nativeElement.textContent as string;
    expect(inUsd).toContain('$ 17.57');
    // La línea del desglose mantiene los bolívares que entraron al cajón.
    expect(inUsd).toContain('Bs 15,520.00');
  });

  it('cierra la tarjeta con el total del backend aunque el desglose sume un centavo mas', () => {
    const page = mount();
    setDisplayCurrency(null);

    // Tres cobros en bolivares: cada equivalente guardado se redondeo al
    // registrar el cobro (6,59 + 17,57 + 17,56 = 41,72), pero el turno vale
    // 41,71 USD. La pantalla pinta el total que cierra el backend, no la suma
    // del desglose; asi el cierre queda en cero.
    const ves = (amount: number, base: number): CurrencyBreakdown => ({
      currency: 'VES',
      in: amount,
      out: 0,
      net: amount,
      baseIn: base,
      baseOut: 0,
      baseNet: base,
      cashIn: amount,
      cashOut: 0,
      baseCashIn: base,
      baseCashOut: 0,
      sales: amount,
      tips: 0,
      change: 0,
      baseSales: base,
      baseTips: 0,
      baseChange: 0,
      methods: [
        { method: 'CASH', in: amount, out: 0, net: amount, baseIn: base, baseOut: 0, baseNet: base },
      ],
    });

    page.session.set(session({ status: 'OPEN', openingAmount: 0 }));
    page.summary.set({
      cashIn: 41.71,
      cashOut: 0,
      expectedCash: 41.71,
      totalIn: 41.71,
      totalOut: 0,
      net: 41.71,
      salesTotal: 41.71,
      tipsTotal: 0,
      movementCount: 3,
      byMethod: [{ method: 'CASH', in: 41.71, out: 0, net: 41.71 }],
      byCategory: [],
      byCurrency: [ves(5_820, 6.59), ves(15_520, 17.57), ves(15_510, 17.56)],
    });
    fixture.detectChanges();

    expect(page.byMethodRows[0].inDisplay).toBe(41.71);
    expect(page.cashInDisplay).toBe(41.71);
    expect(page.expectedCashDisplay).toBe(41.71);
    expect(page.salesTotalDisplay).toBe(41.71);

    page.closeForm.countedAmount = page.expectedCash;
    expect(page.closeDifference).toBe(0);
  });

  /**
   * El desglose por moneda y la tarjeta del efectivo tienen que dar el mismo
   * número: el neto de cada moneda es el que ya recortó el backend una sola vez.
   */
  it('valora el neto por moneda con el equivalente exacto del backend', () => {
    const page = mount();
    setDisplayCurrency(null);

    const row = (
      currency: string,
      amount: number,
      base: number,
    ): CurrencyBreakdown => ({
      currency,
      in: amount,
      out: 0,
      net: amount,
      baseIn: base,
      baseOut: 0,
      baseNet: base,
      cashIn: amount,
      cashOut: 0,
      baseCashIn: base,
      baseCashOut: 0,
      sales: amount,
      tips: 0,
      change: 0,
      baseSales: base,
      baseTips: 0,
      baseChange: 0,
      methods: [
        { method: 'CASH', in: amount, out: 0, net: amount, baseIn: base, baseOut: 0, baseNet: base },
      ],
    });

    // Dos ventas de Bs 15.520,00 y un cobro de $ 6,59 al BCV 883,3963: el turno
    // vale 41,72 USD (35,13 en bolívares + 6,59 en dólares).
    page.session.set(session({ status: 'OPEN', openingAmount: 0 }));
    page.summary.set({
      cashIn: 41.72,
      cashOut: 0,
      expectedCash: 41.72,
      totalIn: 41.72,
      totalOut: 0,
      net: 41.72,
      salesTotal: 41.72,
      tipsTotal: 0,
      movementCount: 3,
      byMethod: [{ method: 'CASH', in: 41.72, out: 0, net: 41.72 }],
      byCategory: [],
      byCurrency: [row('VES', 31_040, 35.13), row('USD', 6.59, 6.59)],
    });

    const [ves, usd] = page.byCurrency;
    expect(page.currencyNetDisplay(ves)).toBe(35.13);
    expect(page.currencyNetDisplay(usd)).toBe(6.59);
    expect(page.currencyNetDisplay(ves)! + page.currencyNetDisplay(usd)!).toBe(41.72);
    expect(page.byMethodRows[0].inDisplay).toBe(41.72);
    expect(page.cashInDisplay).toBe(41.72);
  });

  it('valora cada movimiento con la tasa con la que se registró', () => {
    const page = mount();
    setDisplayCurrency(null);

    // Bs 15.520,00 al BCV de la venta (883,3963) son 17,5686 USD. La fila tiene
    // que usar esa tasa, no la del día, y no el precio recortado del pedido.
    expect(
      page.movementDisplay({
        id: 'mv1',
        sessionId: 's1',
        type: 'IN',
        category: 'SALE',
        paymentMethod: 'CASH',
        amount: 15_520,
        currency: 'VES',
        baseAmount: 17.56,
        baseRate: 883.3963,
        createdAt: '2026-10-21T15:26:00.000Z',
      }),
    ).toBeCloseTo(17.5686, 4);
  });

  /**
   * El conteo del cierre se compara contra el esperado en USD: si el cajero
   * cuenta en bolívares hay que llevarlo a dólares con la tasa y recortarlo,
   * igual que el backend; antes se restaban centavos a dólares.
   */
  it('lleva el conteo en bolívares a USD antes de calcular la diferencia', () => {
    const page = mount();
    setDisplayCurrency(null);

    page.summary.set({
      cashIn: 41.72,
      cashOut: 0,
      expectedCash: 41.72,
      totalIn: 41.72,
      totalOut: 0,
      net: 41.72,
      salesTotal: 41.72,
      tipsTotal: 0,
      movementCount: 3,
      byMethod: [{ method: 'CASH', in: 41.72, out: 0, net: 41.72 }],
      byCategory: [],
      byCurrency: [],
    });

    // 37.757 Bs al BCV 905 son 41,7204 USD: el conteo se recorta a 41,72 y
    // cierra sin diferencia.
    page.closeForm.countedAmount = 37_757;
    page.closeForm.countedCurrency = 'VES';
    expect(page.countedBase).toBe(41.72);
    expect(page.closeDifference).toBe(0);

    // Contar solo los bolívares deja faltante (el efectivo en dólares tambien
    // forma parte del esperado), en dólares y no en bolívares.
    page.closeForm.countedAmount = 31_040;
    expect(page.countedBase).toBe(34.29);
    expect(page.closeDifference).toBe(-7.43);
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
