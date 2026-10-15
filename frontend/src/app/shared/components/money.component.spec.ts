import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import type { RatesSnapshot } from '../../core/models/rates.model';
import { RatesService } from '../../core/services/rates.service';
import { setDisplayCurrency } from '../../core/utils/format';
import { MoneyComponent } from './money.component';

const API = environment.apiUrl;
const STORAGE_KEY = 'nexo-hub.rate-conversions';

/**
 * Respuesta del backend usando los valores reales del BCV publicados por
 * dolarvzla (`https://rates.dolarvzla.com/bcv/current.json`).
 */
const BCV: RatesSnapshot['bcv'] = {
  current: { date: '2026-10-13', usd: 876.7976, eur: 982.00454402 },
  previous: { date: '2026-10-09', usd: 875.6505, eur: 980.61472543 },
  changePercentage: { usd: 0.13099975389724816, eur: 0.14172932079829498 },
  fetchedAt: '2026-10-13T12:00:00.000Z',
  expiresAt: '2026-10-13T12:15:00.000Z',
  stale: false,
  sourceUrl: 'https://rates.dolarvzla.com/bcv/current.json',
};

/** Monedas configuradas para las pruebas (USD con la tasa del sistema + VES local). */
function currenciesFor(bsPerUsd: number): RatesSnapshot['currencies'] {
  return [
    {
      code: 'USD',
      label: 'Dólares',
      symbol: '$',
      enabled: true,
      bsPerUnit: bsPerUsd,
      // El dólar queda conectado al BCV mientras el local no defina su propia tasa.
      source: 'BCV',
      isBase: true,
      isDisplayBase: true,
      bsPerUsd,
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
      bsPerUsd,
    },
  ];
}

const BCV_ONLY: RatesSnapshot = {
  bcv: BCV,
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
    {
      key: 'BCV_EUR',
      currency: 'EUR',
      source: 'BCV',
      rate: 982.00454402,
      date: '2026-10-13',
      previousRate: 980.61472543,
      changePercentage: 0.1417,
    },
  ],
  activeKey: 'BCV_USD',
  baseCurrency: {
    code: 'USD',
    label: 'Dólares',
    symbol: '$',
    decimals: 2,
    bsPerUnit: 876.7976,
    bsPerUsd: 876.7976,
  },
  currencies: currenciesFor(876.7976),
  // Tasa USDT de referencia: informativa, no entra en las conversiones.
  reference: null,
};

const WITH_CUSTOM: RatesSnapshot = {
  ...BCV_ONLY,
  currencies: currenciesFor(905.42),
  baseCurrency: {
    code: 'USD',
    label: 'Dólares',
    symbol: '$',
    decimals: 2,
    bsPerUnit: 905.42,
    bsPerUsd: 905.42,
  },
  custom: {
    usd: 905.42,
    updatedAt: '2026-10-13T12:05:00.000Z',
    updatedBy: 'Administrador',
  },
  rates: [
    ...BCV_ONLY.rates,
    {
      key: 'CUSTOM_USD',
      currency: 'USD',
      source: 'CUSTOM',
      rate: 905.42,
      date: null,
      previousRate: null,
      changePercentage: null,
    },
  ],
  activeKey: 'CUSTOM_USD',
};

@Component({
  standalone: true,
  imports: [MoneyComponent],
  template: `<app-money
    [amount]="amount()"
    [compact]="compact()"
    [entered]="entered()"
    [currency]="currency()"
    [rateKey]="rateKey()"
  />`,
})
class HostComponent {
  readonly amount = signal<number>(10);
  readonly compact = signal<boolean>(false);
  /** Monto tal como lo escribio el operador (contexto de moneda del monto). */
  readonly entered = signal<number | null>(null);
  readonly currency = signal<string | null>(null);
  readonly rateKey = signal<string | null>(null);
}

/** Snapshot con la moneda base en bolívares (los montos se muestran primero en Bs). */
function withBase(code: 'VES' | 'EUR'): RatesSnapshot {
  const base = {
    VES: {
      code: 'VES',
      label: 'Bolívares',
      symbol: 'Bs',
      decimals: 2,
      bsPerUnit: 1,
      bsPerUsd: 876.7976,
    },
    EUR: {
      code: 'EUR',
      label: 'Euros',
      symbol: '€',
      decimals: 2,
      bsPerUnit: 982.00454402,
      bsPerUsd: 876.7976,
    },
  }[code];

  return {
    ...BCV_ONLY,
    baseCurrency: base,
    currencies: BCV_ONLY.currencies.map((item) => ({
      ...item,
      isDisplayBase: item.code === code,
    })),
  };
}

/**
 * Snapshot con la moneda base en bolívares y la tasa personalizada del local
 * activa (905,42 Bs por dólar): conviven las tres tasas del sistema.
 */
function withCustomDollar(): RatesSnapshot {
  return {
    ...withBase('VES'),
    custom: WITH_CUSTOM.custom,
    rates: WITH_CUSTOM.rates,
    baseCurrency: {
      code: 'VES',
      label: 'Bolívares',
      symbol: 'Bs',
      decimals: 2,
      bsPerUnit: 1,
      bsPerUsd: 905.42,
    },
    currencies: currenciesFor(905.42).map((item) => ({
      ...item,
      isDisplayBase: item.code === 'VES',
      source: item.code === 'USD' ? ('CUSTOM' as const) : item.source,
    })),
  };
}

/** Montos "al cambio": equivalente en bolívares con cada tasa activa. */
describe('MoneyComponent (montos al cambio)', () => {
  let http: HttpTestingController;
  let rates: RatesService;
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    rates = TestBed.inject(RatesService);
    rates.setConversions(true);
    fixture = TestBed.createComponent(HostComponent);
  });

  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    // La moneda base es estado global de `format.ts`: se devuelve a dólares.
    setDisplayCurrency(null);
    http.verify();
  });

  function load(snapshot: RatesSnapshot): string {
    rates.load();
    http.expectOne(`${API}/rates`).flush(snapshot);
    fixture.detectChanges();
    return fixture.nativeElement.textContent as string;
  }

  it('muestra el monto base y las 2 tasas del BCV', () => {
    const text = load(BCV_ONLY);

    expect(text).toContain('$ 10.00');
    expect(text).toContain('BCV $');
    expect(text).toContain('Bs 8,767.98');
    expect(text).toContain('BCV €');
    expect(text).toContain('Bs 9,820.05');
    expect(text).not.toContain('Personalizada');
  });

  it('muestra la tercera tasa cuando el local define una personalizada', () => {
    const text = load(WITH_CUSTOM);

    expect(text).toContain('Personalizada');
    expect(text).toContain('Bs 9,054.20');
    expect(text).toContain('Bs 8,767.98');
    expect(text).toContain('Bs 9,820.05');
  });

  it('oculta las conversiones cuando el interruptor global está apagado', () => {
    load(BCV_ONLY);

    rates.setConversions(false);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('$ 10.00');
    expect(text).not.toContain('Bs ');
  });

  it('actualiza el equivalente al cambiar el monto', () => {
    load(BCV_ONLY);

    fixture.componentInstance.amount.set(2);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('$ 2.00');
    expect(fixture.nativeElement.textContent).toContain('Bs 1,753.60');
  });

  it('abrevia el monto y su conversion cuando no caben en el hueco', () => {
    load(BCV_ONLY);

    fixture.componentInstance.amount.set(1_250_000);
    fixture.componentInstance.compact.set(true);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const base = root.querySelector('app-money span');
    const text = root.textContent as string;

    expect(base?.textContent?.trim()).toBe('$ 1.3m');
    expect(base?.getAttribute('title')).toBe('$ 1,250,000.00');
    expect(text).toContain('Bs 1.1b');
    expect(text).not.toContain('Bs 1,095,997,000.00');
  });

  it('muestra primero la moneda base elegida y debajo cada tasa del sistema', () => {
    const text = load(withBase('VES'));

    // 10 USD * 876.7976 = 8 767,98 Bs (la moneda base ahora es el bolivar).
    expect(text).toContain('Bs 8,767.98');
    // Debajo no se pierde ninguna tasa: cada linea va rotulada con su moneda y el
    // origen de su tasa, con el equivalente EN DIVISA del monto (el monto base ya
    // esta en bolivares, asi que repetir bolivares no diria nada nuevo).
    expect(text).toContain('USD · BCV $ 10.00');
    expect(text).toContain('EUR · BCV € 8.93');
    expect(text).not.toContain('Personalizada');
  });

  it('lista el dolar del BCV junto al personalizado del local', () => {
    const text = load(withCustomDollar());

    // Listado con la moneda base en bolivares: la tasa personalizada del local no
    // tapa al dolar del BCV. El monto en Bs (9.054,20 a la tasa del local) vuelto
    // a divisa: al BCV son 10,33 dolares y al euro del BCV 9,22.
    expect(text).toContain('USD · BCV $ 10.33');
    expect(text).toContain('EUR · BCV € 9.22');
    expect(text).toContain('USD · personalizada $ 10.00');
    // La moneda base usa la tasa activa (la personalizada del local).
    expect(text).toContain('Bs 9,054.20');
  });

  it('abrevia la moneda base y sus conversiones cuando no caben', () => {
    load(withBase('VES'));

    fixture.componentInstance.amount.set(1_250_000);
    fixture.componentInstance.compact.set(true);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const base = root.querySelector('app-money span');
    const text = root.textContent as string;

    expect(base?.textContent?.trim()).toBe('Bs 1.1b');
    expect(base?.getAttribute('title')).toBe('Bs 1,095,997,000.00');
    expect(text).toContain('USD · BCV $ 1.3m');
  });
});

/**
 * Precio unitario cargado a mano: el sistema guarda los montos en dólares
 * redondeados a centavos, así que Bs 350,00 a 876,7976 Bs por dólar son $ 0,36 y
 * al volver a bolívares daría **349,20**. Con el contexto de moneda
 * (`entered` + `currency`) el monto se muestra tal como se escribió.
 */
describe('MoneyComponent (monto tal como se cargó)', () => {
  let http: HttpTestingController;
  let rates: RatesService;
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    rates = TestBed.inject(RatesService);
    rates.setConversions(true);
    fixture = TestBed.createComponent(HostComponent);
  });

  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    setDisplayCurrency(null);
    http.verify();
  });

  function load(snapshot: RatesSnapshot): void {
    rates.load();
    http.expectOne(`${API}/rates`).flush(snapshot);
    fixture.detectChanges();
  }

  /** Con el monto base en dólares y el operador cargando bolívares. */
  function loadBolivares(): void {
    load(BCV_ONLY);
    fixture.componentInstance.amount.set(0.36);
    fixture.componentInstance.entered.set(350);
    fixture.componentInstance.currency.set('VES');
    fixture.componentInstance.rateKey.set('BCV_USD');
    fixture.detectChanges();
  }

  it('respeta la tasa con la que se cargó el monto "al cambio"', () => {
    loadBolivares();

    const root = fixture.nativeElement as HTMLElement;
    const base = root.querySelector('app-money span');
    const text = root.textContent as string;

    // El monto base sigue siendo el guardado (Bs 350 = $ 0,36 al cambio actual).
    expect(base?.textContent?.trim()).toBe('$ 0.36');
    // La línea del BCV $ recupera los 350,00 que escribió el operador, no el
    // resultado de reconvertir los $ 0,36 (315,65 con la tasa de 876,7976).
    expect(text).toContain('Bs 350.00');
    expect(text).not.toContain('Bs 315.65');
    // Las demás tasas siguen mostrando la conversión contable del monto.
    expect(text).toContain('Bs 353.52');
  });

  it('muestra el monto cargado en bolívares sin el redondeo a centavos', () => {
    load(withBase('VES'));
    fixture.componentInstance.amount.set(0.36);
    fixture.componentInstance.entered.set(350);
    fixture.componentInstance.currency.set('VES');
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const base = root.querySelector('app-money span');
    const text = root.textContent as string;

    expect(base?.textContent?.trim()).toBe('Bs 350.00');
    expect(text).not.toContain('Bs 349.20');
    // Debajo quedan las tasas del sistema con el equivalente contable que se
    // guardo (0,36 USD), ya en divisa: al dolar del BCV son $ 0,36 y al euro € 0,32.
    expect(text).toContain('USD · BCV $ 0.36');
    expect(text).toContain('EUR · BCV € 0.32');
  });

  it('abrevia el monto cargado y deja el exacto en el tooltip', () => {
    load(withBase('VES'));
    fixture.componentInstance.entered.set(3500);
    fixture.componentInstance.currency.set('VES');
    fixture.componentInstance.compact.set(true);
    fixture.detectChanges();

    const base = (fixture.nativeElement as HTMLElement).querySelector('app-money span');

    expect(base?.textContent?.trim()).toBe('Bs 3.5k');
    expect(base?.getAttribute('title')).toBe('Bs 3,500.00');
  });

  it('vuelve al monto guardado cuando se cargó en otra moneda', () => {
    load(withBase('VES'));
    fixture.componentInstance.amount.set(10);
    fixture.componentInstance.entered.set(10);
    fixture.componentInstance.currency.set('USD');
    fixture.detectChanges();

    const base = (fixture.nativeElement as HTMLElement).querySelector('app-money span');
    const text = fixture.nativeElement.textContent as string;

    // Se cargó en dólares: no hay nada que recuperar, manda la conversión.
    expect(base?.textContent?.trim()).toBe('Bs 8,767.98');
    expect(text).toContain('USD · BCV $ 10.00');
  });
});
