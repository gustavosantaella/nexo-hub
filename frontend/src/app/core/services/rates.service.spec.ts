import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import type { RatesSnapshot } from '../models/rates.model';
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
      source: 'BASE',
      isBase: true,
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
      bsPerUsd: 876.7976,
    },
  ],
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

/** Conversiones entre la moneda base (USD) y las monedas configuradas. */
describe('RatesService (conversión de monedas)', () => {
  let http: HttpTestingController;
  let rates: RatesService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    http = TestBed.inject(HttpTestingController);
    rates = TestBed.inject(RatesService);

    rates.load();
    http.expectOne(`${API}/rates`).flush(SNAPSHOT);
  });

  afterEach(() => http.verify());

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
});
