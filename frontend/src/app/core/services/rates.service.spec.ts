import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import { clearSession, saveSession } from '../auth/session';
import type { Role, SessionResponse } from '../models/api.model';
import type { RatesSnapshot } from '../models/rates.model';
import { displayBaseCode, money, setDisplayCurrency } from '../utils/format';
import { PreferencesService } from './preferences.service';
import { RatesService } from './rates.service';

const API = environment.apiUrl;

/** Snapshot de tasas con USD (base), VES, COP manual y EUR deshabilitado. */
const SNAPSHOT: RatesSnapshot = {
  bcv: {
    current: { date: '2026-10-13', usd: 876.7976, eur: 982.00454402 },
    previous: { date: '2026-10-09', usd: 875.6505, eur: 980.61472543 },
    changePercentage: { usd: 0.131, eur: 0.1417 },
    fetchedAt: '2026-10-13T12:00:00.000Z',
    expiresAt: '2026-10-13T12:15:00.000Z',
    stale: false,
    sourceUrl: 'https://rates.dolarvzla.com/bcv/current.json',
  },
  custom: null,
  rates: [
    {
      key: 'BCV_USD',
      currency: 'USD',
      source: 'BCV',
      rate: 876.7976,
      date: '2026-10-13',
      previousRate: 875.6505,
      changePercentage: 0.131,
    },
  ],
  activeKey: 'BCV_USD',
  currencies: [
    {
      code: 'USD',
      label: 'Dólares',
      symbol: '$',
      enabled: true,
      bsPerUnit: 876.7976,
      // Sin tasa personalizada el dólar queda conectado a la API del BCV.
      source: 'BCV',
      isBase: true,
      isDisplayBase: true,
      bsPerUsd: 876.7976,
    },
    {
      code: 'VES',
      label: 'Bolívares',
      symbol: 'Bs',
      enabled: true,
      bsPerUnit: 1,
      source: 'BASE',
      isBase: false,
      isDisplayBase: false,
      bsPerUsd: 876.7976,
    },
    {
      code: 'COP',
      label: 'Pesos colombianos',
      symbol: 'COL$',
      enabled: true,
      bsPerUnit: 0.22,
      source: 'MANUAL',
      isBase: false,
      isDisplayBase: false,
      bsPerUsd: 876.7976,
    },
    {
      code: 'EUR',
      label: 'Euros',
      symbol: '€',
      enabled: false,
      bsPerUnit: 982.00454402,
      source: 'BCV',
      isBase: false,
      isDisplayBase: false,
      bsPerUsd: 876.7976,
    },
  ],
  baseCurrency: {
    code: 'USD',
    label: 'Dólares',
    symbol: '$',
    decimals: 2,
    bsPerUnit: 876.7976,
    bsPerUsd: 876.7976,
  },
  reference: {
    pair: 'USDT/VES',
    label: 'Binance · P2P piso',
    source: 'binance',
    method: 'p2p_floor',
    side: 'FLOOR',
    paymentMethod: null,
    price: 1005.8,
    asOf: '2026-10-13T20:54:00.203Z',
    fetchedAt: '2026-10-13T20:54:00.203Z',
    stale: false,
    sourceUrl:
      'https://fx.vexwallet.co/api/v1/fx/latest?pair=USDT/VES&source=binance&method=p2p_floor',
  },
};

/**
 * Snapshot con las TRES tasas del sistema: BCV dolar, BCV euro y la personalizada
 * del local (con la personalizada el `activeKey` es `CUSTOM_USD`).
 */
const THREE_RATES: RatesSnapshot = {
  ...SNAPSHOT,
  custom: { usd: 950, updatedAt: '2026-10-13T12:00:00.000Z', updatedBy: null },
  rates: [
    ...SNAPSHOT.rates,
    {
      key: 'BCV_EUR',
      currency: 'EUR',
      source: 'BCV',
      rate: 982.00454402,
      date: '2026-10-13',
      previousRate: 980.61472543,
      changePercentage: 0.1417,
    },
    {
      key: 'CUSTOM_USD',
      currency: 'USD',
      source: 'CUSTOM',
      rate: 950,
      date: null,
      previousRate: null,
      changePercentage: null,
    },
  ],
};

/**
 * Snapshot del punto de venta: los precios se ven en BOLÍVARES y la tasa
 * personalizada del local (950) es la activa —por eso se leen Bs 9.500 por cada
 * $ 10—, mientras el BCV marca 876,7976 Bs por dólar: eso es lo que cobra el
 * cajero cuando la empresa fija el BCV como tasa de cobro.
 */
const POS_SNAPSHOT: RatesSnapshot = {
  ...THREE_RATES,
  activeKey: 'CUSTOM_USD',
  currencies: THREE_RATES.currencies.map((item) =>
    item.code === 'USD'
      ? { ...item, bsPerUnit: 950, bsPerUsd: 950, source: 'CUSTOM' as const }
      : { ...item, bsPerUsd: 950 },
  ),
  baseCurrency: {
    code: 'VES',
    label: 'Bolívares',
    symbol: 'Bs',
    decimals: 2,
    bsPerUnit: 1,
    bsPerUsd: 950,
  },
};

/** Conversiones entre la moneda base (USD) y las monedas configuradas. */
describe('RatesService (conversión de monedas)', () => {
  let http: HttpTestingController;
  let rates: RatesService;
  let preferences: PreferencesService;

  beforeEach(() => {
    // La moneda de los precios se lee de aquí: sin limpiarlo, una preferencia que
    // dejó otra prueba cambiaría el formateo de estos montos.
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    http = TestBed.inject(HttpTestingController);
    rates = TestBed.inject(RatesService);
    preferences = TestBed.inject(PreferencesService);

    rates.load();
    http.expectOne(`${API}/rates`).flush(SNAPSHOT);
  });

  afterEach(() => {
    // La moneda base es estado global de `format.ts`: se devuelve a dólares.
    setDisplayCurrency(null);
    http.verify();
  });

  it('solo ofrece las monedas habilitadas', () => {
    expect(rates.enabledCurrencies().map((item) => item.code)).toEqual([
      'USD',
      'VES',
      'COP',
    ]);
  });

  it('expone la tasa en bolívares de cada moneda', () => {
    expect(rates.bsPerUnit('USD')).toBe(876.7976);
    expect(rates.bsPerUnit('VES')).toBe(1);
    expect(rates.bsPerUnit('COP')).toBe(0.22);
    expect(rates.bsPerUnit('EUR')).toBe(982.00454402);
    expect(rates.bsPerUnit('XXX')).toBeNull();
  });

  it('convierte a la moneda base los montos pagados en otra moneda', () => {
    expect(rates.toBase(876.7976, 'VES')).toBe(1);
    expect(rates.toBase(1000, 'COP')).toBe(0.25);
    expect(rates.toBase(25.5, 'USD')).toBe(25.5);
    expect(rates.toBase(10, 'XXX')).toBeNull();
  });

  it('redondea el monto base antes de pasarlo a la moneda de visualización', () => {
    // Caso del cajero: el total guardado es USD 9,3494 (se lee $ 9,35) y la tasa
    // BCV es 881,87. La conversion tiene que dar Bs 8.245,48, no Bs 8.245,00.
    const bcvSnapshot: RatesSnapshot = {
      ...POS_SNAPSHOT,
      custom: null,
      activeKey: 'BCV_USD',
      rates: [
        {
          key: 'BCV_USD',
          currency: 'USD',
          source: 'BCV',
          rate: 881.87,
          date: '2026-10-20',
          previousRate: null,
          changePercentage: null,
        },
      ],
      currencies: POS_SNAPSHOT.currencies.map((item) => ({
        ...item,
        bsPerUsd: 881.87,
        bsPerUnit: item.code === 'USD' ? 881.87 : item.bsPerUnit,
        source: item.code === 'USD' ? ('BCV' as const) : item.source,
      })),
      baseCurrency: {
        ...POS_SNAPSHOT.baseCurrency,
        bsPerUsd: 881.87,
      },
    };
    rates.load(true);
    http.expectOne(`${API}/rates?refresh=true`).flush(bcvSnapshot);

    expect(rates.displayAmount(9.3494)).toBe(8245.48);
  });

  it('expresa un monto del sistema en la moneda de cobro', () => {
    expect(rates.fromBase(30, 'VES')).toBe(26303.93);
    expect(rates.fromBase(220, 'COP')).toBe(876797.6);
    expect(rates.fromBase(12.5, 'USD')).toBe(12.5);
    expect(rates.fromBase(10, 'XXX')).toBeNull();
  });

  it('describe el equivalente en dólares de un pago en bolívares', () => {
    expect(rates.baseHint(876.7976, 'VES')).toBe('= $ 1.00');
    expect(rates.baseHint(5000, 'VES')).toBe('= $ 5.70');
    expect(rates.baseHint(10, 'USD')).toBeNull();
    expect(rates.baseHint(10, 'XXX')).toBeNull();
  });

  it('etiqueta las monedas con su nombre del catálogo', () => {
    expect(rates.currencyLabel('VES')).toBe('Bolívares (VES)');
    expect(rates.currencyLabel('COP')).toBe('Pesos colombianos (COP)');
    expect(rates.currencyLabel(undefined)).toBe('Dólares (USD)');
  });

  it('expone la tasa USDT de referencia sin usarla en las conversiones', () => {
    const reference = rates.reference();
    expect(reference?.pair).toBe('USDT/VES');
    expect(reference?.label).toBe('Binance · P2P piso');
    expect(reference?.price).toBe(1005.8);
    expect(rates.referenceStale()).toBe(false);
    // Manda el BCV (876.7976 Bs por USD), no los 1005.8 Bs del USDT.
    expect(rates.bsPerUsd()).toBe(876.7976);
    expect(rates.toBs(1)).toBe(876.7976);
  });

  it('usa el dólar como moneda base mientras el local no elija otra', () => {
    expect(rates.baseCurrency().code).toBe('USD');
    expect(rates.baseCurrency().symbol).toBe('$');
    expect(rates.baseCurrency().bsPerUsd).toBe(876.7976);
    expect(rates.baseCode()).toBe('USD');
    expect(rates.convertsBase()).toBe(false);
    // Los montos se formatean en la moneda base guardada.
    expect(money(10)).toBe('$ 10.00');
  });

  /**
   * El local decide con CUAL de las tasas del sistema se convierte cada monto del
   * catalogo (precio, costo, costo unitario): la elegida reemplaza al puente por
   * defecto (la personalizada del dolar o, si no existe, el BCV dolar).
   */
  it('convierte con la tasa elegida para un monto del catalogo', () => {
    rates.load(true);
    http.expectOne(`${API}/rates?refresh=true`).flush(THREE_RATES);

    // 9.000 Bs son 10,26 USD al cambio del BCV $, 9,16 al del euro y 9,47 con la
    // tasa personalizada del local.
    expect(rates.toBase(9000, 'VES', 'BCV_USD')).toBe(10.26);
    expect(rates.toBase(9000, 'VES', 'BCV_EUR')).toBe(9.16);
    expect(rates.toBase(9000, 'VES', 'CUSTOM_USD')).toBe(9.47);
    expect(rates.bsPerUsdWith('BCV_EUR')).toBe(982.00454402);
  });

  it('expresa un monto del sistema en otra moneda con la tasa elegida', () => {
    rates.load(true);
    http.expectOne(`${API}/rates?refresh=true`).flush(THREE_RATES);

    // 10 USD al cambio del euro son 9.820,05 Bs (con la activa, 8.767,98).
    expect(rates.fromBase(10, 'VES', 'BCV_EUR')).toBe(9820.05);
    expect(rates.fromBase(10, 'VES')).toBe(8767.98);
  });

  it('cae en la tasa activa cuando la elegida ya no esta disponible', () => {
    // Sin tasa personalizada, `CUSTOM_USD` no aparece en el snapshot: se usa la
    // activa del sistema (igual que hace el backend).
    expect(rates.bsPerUsdWith('CUSTOM_USD')).toBe(876.7976);
    expect(rates.toBase(9000, 'VES', 'CUSTOM_USD')).toBe(10.26);
    expect(rates.fromBase(10, 'VES', 'CUSTOM_USD')).toBe(8767.98);
  });

  /**
   * El cajero cobra el precio que LEE en pantalla, y lo lee en la moneda de la
   * empresa (los bolívares, con la tasa personalizada activa): la **tasa de cobro**
   * (el BCV) lleva ese precio a la moneda con la que paga el cliente.
   */
  it('cobra el precio que se ve en pantalla con la tasa de cobro', () => {
    rates.load(true);
    http.expectOne(`${API}/rates?refresh=true`).flush(POS_SNAPSHOT);

    // 10 USD se ven como Bs 9.500,00 (personalizada 950)…
    expect(rates.displayAmount(10)).toBe(9500);
    // …y esos bolívares, al cambio del BCV (876,7976), son 10,83 USD: eso cobra el
    // cajero cuando el cliente paga en divisas, no los 10 USD guardados.
    expect(rates.chargeAmount(10, 'USD', 'BCV_USD')).toBe(10.83);
    // Pagando en bolívares el cliente entrega el precio de la pantalla, tal cual.
    expect(rates.chargeAmount(10, 'VES', 'BCV_USD')).toBe(9500);
  });

  /**
   * Regresion del saldo negativo: si el cajero ve los precios en bolivares y el
   * cliente paga en bolivares, el monto ya es el precio de pantalla. Mandar la
   * tasa de cobro (BCV) haria que el backend revalorizara esos bolivares con otra
   * tasa y el pedido terminara con saldo -$1,60.
   */
  it('no manda la tasa de cobro cuando el pago va en la moneda de pantalla', () => {
    rates.load(true);
    http.expectOne(`${API}/rates?refresh=true`).flush(POS_SNAPSHOT);
    preferences.setChargeRateKey('BCV_USD');
    http
      .expectOne({ method: 'PATCH', url: `${API}/preferences` })
      .flush({ chargeRateKey: 'BCV_USD' });

    expect(rates.chargeKeyFor('VES')).toBeNull();
    // En otra moneda la tasa si reexpresa el precio de pantalla.
    expect(rates.chargeKeyFor('USD')).toBe('BCV_USD');
    expect(rates.chargeKeyFor('COP')).toBe('BCV_USD');
  });

  it('cobra el monto guardado cuando la tasa de cobro es la activa', () => {
    rates.load(true);
    http.expectOne(`${API}/rates?refresh=true`).flush(POS_SNAPSHOT);

    // Con la tasa activa (la personalizada del local) el precio en pantalla y los
    // dólares guardados coinciden: no hay nada que reexpresar.
    expect(rates.chargeAmount(10, 'USD')).toBe(10);
    expect(rates.chargeAmount(10, 'USD', 'CUSTOM_USD')).toBe(10);
  });

  it('cobra en otra moneda el precio que se ve en pantalla', () => {
    rates.load(true);
    http.expectOne(`${API}/rates?refresh=true`).flush(POS_SNAPSHOT);

    // Bs 9.500 son 10,83 USD al BCV y, en pesos (0,22 Bs por COP), 43.162,35 COP.
    expect(rates.chargeAmount(10, 'COP', 'BCV_USD')).toBe(43162.35);
  });

  it('no cambia el cobro cuando los precios se ven en dólares', () => {
    rates.load(true);
    http.expectOne(`${API}/rates?refresh=true`).flush(THREE_RATES);

    // La pantalla muestra dólares: el precio que se lee ya es el monto guardado.
    expect(rates.displayAmount(10)).toBe(10);
    expect(rates.chargeAmount(10, 'USD', 'BCV_USD')).toBe(10);
  });

  it('muestra los montos en la moneda base elegida por el local', () => {
    rates.load(true);
    http.expectOne(`${API}/rates?refresh=true`).flush({
      ...SNAPSHOT,
      baseCurrency: {
        code: 'VES',
        label: 'Bolívares',
        symbol: 'Bs',
        decimals: 2,
        bsPerUnit: 1,
        bsPerUsd: 876.7976,
      },
    });

    expect(rates.baseCode()).toBe('VES');
    expect(rates.convertsBase()).toBe(true);
    // 10 USD -> 8 767,98 Bs.
    expect(money(10)).toBe('Bs 8,767.98');
  });

  it('convierte el monto a las demás monedas configuradas', () => {
    // Con la moneda base en bolívares, la conversión que se muestra es el dólar.
    rates.load(true);
    http.expectOne(`${API}/rates?refresh=true`).flush({
      ...SNAPSHOT,
      baseCurrency: {
        code: 'VES',
        label: 'Bolívares',
        symbol: 'Bs',
        decimals: 2,
        bsPerUnit: 1,
        bsPerUsd: 876.7976,
      },
    });

    const conversions = rates.currencyConversions(10);

    expect(conversions.map((item) => item.key)).toEqual(['USD', 'COP']);
    expect(conversions[0].code).toBe('USD');
    expect(conversions[0].amount).toBe(10);
    expect(conversions[0].text).toBe('$ 10.00');
    // 10 USD * 876.7976 = 8 767,98 Bs / 0,22 = 39 854,44 COP.
    expect(conversions[1].text).toBe('COL$ 39,854.44');
    // Cada línea dice de dónde sale la tasa de la moneda: sin eso el dólar del
    // BCV y el del local, o una moneda con tasa escrita a mano, se ven iguales.
    expect(conversions[0].label).toBe('USD · BCV');
    expect(conversions[1].label).toBe('COP · manual');
  });

  it('rotula el dólar con la tasa personalizada cuando el local la define', () => {
    // El local puso su propio precio del dólar: la moneda es la misma (`USD`),
    // pero la conversión ya no sale del BCV.
    rates.load(true);
    http.expectOne(`${API}/rates?refresh=true`).flush({
      ...THREE_RATES,
      baseCurrency: {
        code: 'VES',
        label: 'Bolívares',
        symbol: 'Bs',
        decimals: 2,
        bsPerUnit: 1,
        bsPerUsd: 876.7976,
      },
      currencies: THREE_RATES.currencies.map((item) =>
        item.code === 'USD' ? { ...item, source: 'CUSTOM' as const } : item,
      ),
    });

    const usd = rates.currencyConversions(10)[0];

    expect(usd.label).toBe('USD · personalizada');
    // La moneda local (Bs) no lleva origen: siempre vale 1 Bs por 1 Bs.
    expect(rates.currencyConversions(10).map((item) => item.label)).not.toContain(
      'VES',
    );
  });

  it('lista las tres tasas y las demas monedas cuando la base no es el dolar', () => {
    // Con la moneda base en bolivares la linea \"al cambio\" no puede perder las
    // tasas del sistema: el dolar del BCV, el euro del BCV y la personalizada.
    rates.load(true);
    http.expectOne(`${API}/rates?refresh=true`).flush({
      ...THREE_RATES,
      baseCurrency: {
        code: 'VES',
        label: 'Bolívares',
        symbol: 'Bs',
        decimals: 2,
        bsPerUnit: 1,
        bsPerUsd: 876.7976,
      },
    });

    const lines = rates.conversionLines(10);

    expect(lines.map((item) => item.label)).toEqual([
      'USD · BCV',
      'EUR · BCV',
      'USD · personalizada',
      // El peso no sale de ninguna de esas tasas: se lista en su propia moneda.
      'COP · manual',
    ]);
    // El monto base ya esta en bolivares (8.767,98): la linea de cada tasa es ese
    // monto vuelto a divisa. Al BCV son $ 10,00, al euro del BCV € 8,93 y a la
    // tasa personalizada del local $ 9,23; el peso va en su propia moneda.
    expect(lines.map((item) => item.text)).toEqual([
      '$ 10.00',
      '€ 8.93',
      '$ 9.23',
      'COL$ 39,854.44',
    ]);
    // Cada linea lleva la moneda de su tasa: ninguna repite los bolivares del
    // monto base (por eso `<app-money>` no las abrevia con `bsCompact`).
    expect(lines.map((item) => item.code)).toEqual(['USD', 'EUR', 'USD', 'COP']);
    expect(lines.some((item) => item.inBs)).toBe(false);
  });

  it('no repite una moneda cuando su tasa ya es una de las tasas listadas', () => {
    rates.load(true);
    http.expectOne(`${API}/rates?refresh=true`).flush({
      ...SNAPSHOT,
      baseCurrency: {
        code: 'VES',
        label: 'Bolívares',
        symbol: 'Bs',
        decimals: 2,
        bsPerUnit: 1,
        bsPerUsd: 876.7976,
      },
    });

    // Sin tasa personalizada el dolar se convierte con el BCV: una sola linea.
    const lines = rates.conversionLines(10);

    expect(lines.map((item) => item.key)).toEqual(['BCV_USD', 'COP']);
    expect(lines.map((item) => item.label)).toEqual(['USD · BCV', 'COP · manual']);
    // Los 8.767,98 Bs del monto son 10,00 USD con el dolar del BCV.
    expect(lines.map((item) => item.text)).toEqual(['$ 10.00', 'COL$ 39,854.44']);
  });
});

/**
 * La moneda con la que se ven los precios depende del rol: ADMIN y MANAGER ven
 * siempre el precio REGISTRADO (la moneda base de la empresa) con su conversión;
 * el cajero ve la moneda que eligió en Configuración → Cajero y, sin preferencia
 * o sin tasa, la moneda base del sistema.
 */
describe('RatesService (moneda de los precios por rol)', () => {
  let http: HttpTestingController;
  let rates: RatesService;
  let preferences: PreferencesService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    http = TestBed.inject(HttpTestingController);
    rates = TestBed.inject(RatesService);
    preferences = TestBed.inject(PreferencesService);
  });

  afterEach(() => {
    setDisplayCurrency(null);
    clearSession();
    localStorage.clear();
    http.verify();
  });

  /** Deja una sesión guardada con ese rol (es lo que lee el formateo de montos). */
  function sessionWith(role: Role): void {
    saveSession({ accessToken: 'token', role } as SessionResponse);
  }

  /** Carga las tasas del snapshot (moneda base de la empresa: el dólar). */
  function load(): void {
    rates.load();
    http.expectOne(`${API}/rates`).flush(SNAPSHOT);
  }

  /** Vuelve a pedir las tasas ignorando la caché (cambio de rol o de empresa). */
  function reload(): void {
    rates.load(true);
    http.expectOne(`${API}/rates?refresh=true`).flush(SNAPSHOT);
  }

  /**
   * Deja la moneda de los precios con ese codigo como preferencia de la empresa:
   * el guardado (`PATCH /preferences`) se responde al vuelo, que aqui solo
   * importa con que moneda se formatean los montos.
   */
  function preferCurrency(code: string | null): void {
    preferences.setPriceCurrency(code);
    http
      .expectOne({ method: 'PATCH', url: `${API}/preferences` })
      .flush({ tipPercent: 10, dialogView: 'modal', priceCurrency: code });
  }

  it('muestra la moneda base al cajero que no eligió ninguna', () => {
    sessionWith('CASHIER');
    load();

    expect(money(10)).toBe('$ 10.00');
    expect(displayBaseCode()).toBe('USD');
  });

  it('muestra los precios en la moneda que eligió el cajero', () => {
    sessionWith('CASHIER');
    preferCurrency('VES');
    load();

    // 10 USD * 876,7976 = 8 767,98 Bs.
    expect(money(10)).toBe('Bs 8,767.98');
    expect(displayBaseCode()).toBe('VES');
    // La moneda base CONTABLE no cambia: los montos se siguen guardando en USD.
    expect(rates.baseCode()).toBe('USD');
    expect(rates.convertsBase()).toBe(false);
  });

  it('convierte con la tasa de la moneda elegida (no solo cambia el símbolo)', () => {
    sessionWith('CASHIER');
    preferCurrency('COP');
    load();

    // 10 USD = 8 767,98 Bs / 0,22 = 39 854,44 COP.
    expect(money(10)).toBe('COL$ 39,854.44');
  });

  it('vuelve a la moneda base cuando falta la tasa de la moneda elegida', () => {
    sessionWith('CASHIER');
    preferCurrency('XXX');
    load();

    expect(money(10)).toBe('$ 10.00');
  });

  it('no aplica la preferencia del cajero a ADMIN ni a MANAGER', () => {
    preferCurrency('COP');

    sessionWith('ADMIN');
    load();
    expect(money(10)).toBe('$ 10.00');

    sessionWith('MANAGER');
    reload();
    expect(money(10)).toBe('$ 10.00');

    // …pero sí para un cajero, con la preferencia que la empresa tiene guardada.
    sessionWith('CASHIER');
    reload();
    expect(money(10)).toBe('COL$ 39,854.44');
  });

  it('reaplica la moneda de los precios cuando Configuración la cambia', () => {
    sessionWith('CASHIER');
    load();
    expect(money(10)).toBe('$ 10.00');

    // La preferencia se acaba de guardar en la empresa: Configuración avisa al
    // servicio para que vuelva a formatear sin esperar a la próxima carga de tasas.
    preferCurrency('VES');
    rates.applyDisplayPreference();

    expect(money(10)).toBe('Bs 8,767.98');
  });
});

/**
 * Conversiones que ve el cajero: por defecto **ninguna** (los precios, en la
 * moneda que le configuraron) y solo las monedas que el admin active en
 * Configuración → Cajero. Quien administra el local —o una pantalla sin sesión—
 * sigue viendo todas.
 */
describe('RatesService (conversiones que ve el cajero)', () => {
  let http: HttpTestingController;
  let rates: RatesService;
  let preferences: PreferencesService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    http = TestBed.inject(HttpTestingController);
    rates = TestBed.inject(RatesService);
    preferences = TestBed.inject(PreferencesService);
  });

  afterEach(() => {
    clearSession();
    localStorage.clear();
    http.verify();
  });

  /** Deja una sesión guardada con ese rol (es lo que lee la vista del cajero). */
  function sessionWith(role: Role): void {
    saveSession({ accessToken: 'token', role } as SessionResponse);
  }

  /** Carga las tasas del snapshot. */
  function load(): void {
    rates.load();
    http.expectOne(`${API}/rates`).flush(SNAPSHOT);
  }

  /** Activa las conversiones del cajero, como Configuración → Cajero. */
  function allowConversions(codes: string[]): void {
    preferences.setConversionCurrencies(codes);
    http
      .expectOne({ method: 'PATCH', url: `${API}/preferences` })
      .flush({
        tipPercent: 10,
        dialogView: 'modal',
        priceCurrency: null,
        conversionCurrencies: codes.length ? codes : null,
      });
  }

  it('sin configurar, el cajero no ve ninguna conversión', () => {
    sessionWith('CASHIER');
    load();

    expect(rates.allowedConversionCodes()).toEqual([]);

    const lines = rates.conversionLines(10);
    // Hay conversiones que mostrar (el peso y el dólar del BCV)…
    expect(lines.length).toBeGreaterThan(1);
    // …pero el cajero no ve ninguna hasta que el admin las active.
    expect(rates.visibleConversions(lines)).toEqual([]);
  });

  it('deja pasar solo las monedas activadas', () => {
    sessionWith('CASHIER');
    allowConversions(['USD']);
    load();

    const lines = rates.conversionLines(10);
    expect(lines.some((item) => item.code === 'COP')).toBeTrue();

    expect(rates.visibleConversions(lines).map((item) => item.code)).toEqual(['USD']);
  });

  it('las líneas "al cambio" en bolívares dependen de VES', () => {
    sessionWith('CASHIER');
    load();

    // Con la moneda base en dólares la conversión es el equivalente en bolívares:
    // esas líneas van sin código de moneda y las gobierna el bolívar.
    const inBs = rates.conversions(10);
    expect(inBs.every((item) => item.inBs)).toBeTrue();

    allowConversions(['VES']);
    expect(rates.visibleConversions(inBs)).toEqual(inBs);

    allowConversions(['COP']);
    expect(rates.visibleConversions(inBs)).toEqual([]);
  });

  it('a quien administra el local no se le filtra nada', () => {
    sessionWith('MANAGER');
    allowConversions([]);
    load();

    const lines = rates.conversionLines(10);

    expect(rates.allowedConversionCodes()).toBeNull();
    expect(rates.visibleConversions(lines)).toEqual(lines);
  });

  it('una pantalla sin sesión tampoco filtra (no hay preferencia que aplicar)', () => {
    allowConversions([]);
    load();

    const lines = rates.conversionLines(10);

    expect(rates.allowedConversionCodes()).toBeNull();
    expect(rates.visibleConversions(lines)).toEqual(lines);
  });

  it('sabe la moneda de cada línea de conversión', () => {
    expect(
      rates.conversionCurrency({
        key: 'cop',
        code: 'cop',
        label: 'COP · manual',
        rate: 0.22,
        amount: 1,
        text: 'COL$ 1.00',
      }),
    ).toBe('COP');

    // Las líneas en bolívares (una por tasa) no traen código: son del bolívar.
    expect(
      rates.conversionCurrency({
        key: 'BCV_USD',
        label: 'BCV $',
        rate: 876.7976,
        amount: 1,
        text: 'Bs 876.80',
        inBs: true,
      }),
    ).toBe('VES');

    // Sin moneda (no debería pasar) no se puede comparar con lo activado.
    expect(
      rates.conversionCurrency({
        key: 'X',
        label: 'X',
        rate: 1,
        amount: 1,
        text: '1',
      }),
    ).toBeNull();
  });

  it('sabe si esta sesión puede ver una moneda', () => {
    // Quien administra el local (y una pantalla sin sesión) ven todas.
    expect(rates.showsConversion('USD')).toBeTrue();
    expect(rates.showsConversion(' ')).toBeTrue();

    sessionWith('CASHIER');
    expect(rates.showsConversion('USD')).toBeFalse();
    // Las líneas en bolívares (sin código) tampoco pasan hasta activar VES.
    expect(rates.showsConversion(null)).toBeFalse();

    allowConversions(['USD']);
    // La comparación no distingue mayúsculas ni espacios: la preferencia y las
    // líneas vienen del servidor y de la vista.
    expect(rates.showsConversion(' usd ')).toBeTrue();
    expect(rates.showsConversion('VES')).toBeFalse();
  });

  it('recalcula el filtro al entrar o salir la sesión en este equipo', () => {
    // El servicio se construye al abrir la aplicación, cuando todavía no hay
    // sesión: el filtro no puede quedarse con lo que vio entonces.
    allowConversions(['USD']);
    expect(rates.showsConversion('VES')).toBeTrue();

    // Entra el cajero desde el login: pasa a ver solo lo que activó el admin.
    sessionWith('CASHIER');
    expect(rates.showsConversion('USD')).toBeTrue();
    expect(rates.showsConversion('VES')).toBeFalse();

    // Si la misma pantalla pasa a administrar el local, vuelve a verlo todo.
    sessionWith('MANAGER');
    expect(rates.allowedConversionCodes()).toBeNull();
    expect(rates.showsConversion('VES')).toBeTrue();

    // Y al cerrar sesión (login abierto en un equipo compartido) tampoco se filtra
    // nada: no hay preferencia de cajero que aplicar.
    sessionWith('CASHIER');
    expect(rates.showsConversion('VES')).toBeFalse();

    clearSession();
    expect(rates.showsConversion('VES')).toBeTrue();
  });
});

/**
 * Precio en dólares del BCV: la línea que el admin activa en Configuración → Cajero
 * para que el cajero vea, debajo de cada monto, la equivalencia con la **tasa
 * oficial** del BCV. La dirección depende de la moneda con la que se ven los
 * precios: en bolívares enseña los dólares oficiales de esos bolívares y en una
 * divisa enseña los bolívares que valen esas divisas. Es una preferencia de la
 * empresa y solo la ve el personal de caja.
 */
describe('RatesService (precio en dólares del BCV)', () => {
  let http: HttpTestingController;
  let rates: RatesService;
  let preferences: PreferencesService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    http = TestBed.inject(HttpTestingController);
    rates = TestBed.inject(RatesService);
    preferences = TestBed.inject(PreferencesService);
  });

  afterEach(() => {
    setDisplayCurrency(null);
    clearSession();
    localStorage.clear();
    http.verify();
  });

  /** Deja una sesión guardada con ese rol (es lo que lee la línea del BCV). */
  function sessionWith(role: Role): void {
    saveSession({ accessToken: 'token', role } as SessionResponse);
  }

  /** Carga las tasas del snapshot. */
  function load(): void {
    rates.load();
    http.expectOne(`${API}/rates`).flush(SNAPSHOT);
  }

  /** Activa (o apaga) el precio en dólares del BCV, como Configuración → Cajero. */
  function preferBcvPrice(show: boolean): void {
    preferences.setShowBcvPrice(show);
    http.expectOne({ method: 'PATCH', url: `${API}/preferences` }).flush({
      tipPercent: 10,
      dialogView: 'modal',
      priceCurrency: null,
      showBcvPrice: show ? true : null,
    });
  }

  it('con los precios en bolívares convierte los bolívares del monto a dólares oficiales', () => {
    load();

    // 10 USD * 876,7976 = 8 767,98 Bs y, a la tasa del BCV, son 10,00 dólares.
    const line = rates.bcvUsdConversion(10, null, 'VES');

    expect(line?.key).toBe('BCV_USD');
    expect(line?.code).toBe('USD');
    // Rotulada con su origen: el dólar del BCV no es el de la tasa del local.
    expect(line?.label).toBe('USD · BCV');
    expect(line?.rate).toBe(876.7976);
    expect(line?.text).toBe('$ 10.00');
    expect(line?.inBs).toBeUndefined();
  });

  it('con los precios en una divisa devuelve los bolívares de la tasa oficial', () => {
    load();

    // $ 10,00 a la tasa oficial del BCV son 8 767,98 Bs: la línea que necesita
    // quien cobra con los precios en dólares (o en euros).
    const line = rates.bcvUsdConversion(10, null, 'USD');

    expect(line?.key).toBe('BCV_USD');
    expect(line?.code).toBe('VES');
    expect(line?.label).toBe('VES · BCV');
    expect(line?.rate).toBe(876.7976);
    expect(line?.text).toBe('Bs 8,767.98');

    // Los bolívares que escribió el operador son de otra tasa (la del local), así
    // que aquí no aplican: la línea sale siempre de la tasa oficial del BCV.
    expect(rates.bcvUsdConversion(10, 8767.98, 'EUR')?.text).toBe('Bs 8,767.98');
  });

  it('sin indicar la moneda sigue la que se usa para mostrar los precios', () => {
    load();

    expect(displayBaseCode()).toBe('USD');
    expect(rates.bcvUsdConversion(10)?.text).toBe('Bs 8,767.98');

    // Con los precios en bolívares la línea es la vuelta al dólar oficial.
    setDisplayCurrency({
      code: 'VES',
      label: 'Bolívares',
      symbol: 'Bs',
      decimals: 2,
      bsPerUnit: 1,
      bsPerUsd: 876.7976,
    });

    expect(displayBaseCode()).toBe('VES');
    expect(rates.bcvUsdConversion(10)?.text).toBe('$ 10.00');
  });

  it('respeta los bolívares que escribió el operador', () => {
    load();

    // Bs 350,00 escritos por el operador son 0,40 dólares oficiales, no los 0,36 que
    // salen de volver a convertir el monto guardado (0,36 * 876,7976).
    expect(rates.bcvUsdConversion(0.36, 350, 'VES')?.text).toBe('$ 0.40');
    expect(rates.bcvUsdConversion(0.36, null, 'VES')?.text).toBe('$ 0.36');
  });

  it('no devuelve línea sin bolívares ni sin la tasa del BCV', () => {
    load();

    expect(rates.bcvUsdConversion(0, null, 'VES')).toBeNull();
    expect(rates.bcvUsdConversion(null, null, 'VES')).toBeNull();
    expect(rates.bcvUsdConversion(0, null, 'USD')).toBeNull();

    // El BCV no respondió con una tasa utilizable: no hay dólares oficiales que
    // mostrar (y las conversiones "al cambio" siguen con la última tasa conocida).
    rates.load(true);
    http.expectOne(`${API}/rates?refresh=true`).flush({
      ...SNAPSHOT,
      bcv: { ...SNAPSHOT.bcv, current: { ...SNAPSHOT.bcv.current, usd: 0 } },
    });

    expect(rates.bcvUsdConversion(10, null, 'VES')).toBeNull();
    expect(rates.bcvUsdConversion(10, null, 'USD')).toBeNull();
  });

  it('solo la ve el cajero con la preferencia de la empresa activada', () => {
    sessionWith('CASHIER');
    load();
    expect(rates.showBcvPrice()).toBeFalse();

    preferBcvPrice(true);
    expect(rates.showBcvPrice()).toBeTrue();

    // Apagarla vuelve al precio sin la línea del BCV.
    preferBcvPrice(false);
    expect(rates.showBcvPrice()).toBeFalse();

    // La preferencia es de la caja: ADMIN y MANAGER conservan su vista.
    preferBcvPrice(true);
    sessionWith('ADMIN');
    expect(rates.showBcvPrice()).toBeFalse();

    sessionWith('MANAGER');
    expect(rates.showBcvPrice()).toBeFalse();

    // Y una pantalla sin sesión (login, pantallas públicas) tampoco la pinta.
    clearSession();
    expect(rates.showBcvPrice()).toBeFalse();
  });
});

