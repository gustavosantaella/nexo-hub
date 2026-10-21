import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import { clearSession, saveSession } from '../../core/auth/session';
import type { Role, SessionResponse } from '../../core/models/api.model';
import type { RatesSnapshot } from '../../core/models/rates.model';
import { PreferencesService } from '../../core/services/preferences.service';
import { RatesService } from '../../core/services/rates.service';
import { setDisplayCurrency } from '../../core/utils/format';
import { MoneyComponent } from './money.component';

const API = environment.apiUrl;
const STORAGE_KEY = 'nexo-hub.rate-conversions';

/** Copia local de las conversiones que ve el cajero (igual que en el servicio). */
const CONVERSION_KEY = 'nexo-hub.conversion-currencies';

/**
 * Copia local de la moneda en la que el cajero ve los precios y del interruptor del
 * precio en dólares del BCV (`format.ts` y el servicio los leen de aquí, así que hay
 * que dejarlos limpios: son estado global para toda la corrida de pruebas).
 */
const PRICE_CURRENCY_KEY = 'nexo-hub.price-currency';
const SHOW_BCV_PRICE_KEY = 'nexo-hub.show-bcv-price';

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

/**
 * Caja con los precios en bolívares a la tasa del local (970 Bs por dólar) y el
 * BCV en 883,30: el caso del reporte —Bs 15.520,00 son USD 16,00 de vitrina y, al
 * BCV, USD 17,57—.
 */
function withLocalPrice(): RatesSnapshot {
  const custom = 970;
  return {
    ...withBase('VES'),
    bcv: { ...BCV, current: { ...BCV.current, usd: 883.3 } },
    custom: {
      usd: custom,
      updatedAt: '2026-10-13T12:05:00.000Z',
      updatedBy: 'Administrador',
    },
    rates: [
      { ...BCV_ONLY.rates[0], rate: 883.3 },
      BCV_ONLY.rates[1],
      {
        key: 'CUSTOM_USD',
        currency: 'USD',
        source: 'CUSTOM',
        rate: custom,
        date: null,
        previousRate: null,
        changePercentage: null,
      },
    ],
    baseCurrency: {
      code: 'VES',
      label: 'Bolívares',
      symbol: 'Bs',
      decimals: 2,
      bsPerUnit: 1,
      bsPerUsd: custom,
    },
    currencies: currenciesFor(custom).map((item) => ({
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
    expect(text).toContain('Bs 8,767.97');
    expect(text).toContain('BCV €');
    expect(text).toContain('Bs 9,820.04');
    expect(text).not.toContain('Personalizada');
  });

  it('no lista la tasa personalizada debajo de los montos', () => {
    const text = load(WITH_CUSTOM);

    expect(text).not.toContain('Personalizada');
    expect(text).toContain('Bs 8,767.97');
    expect(text).toContain('Bs 9,820.04');
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
    expect(fixture.nativeElement.textContent).toContain('Bs 1,753.59');
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
    expect(text).toContain('Bs 8,767.97');
    // Debajo no se pierde ninguna tasa: cada linea va rotulada con su moneda y el
    // origen de su tasa, con el equivalente EN DIVISA del monto (el monto base ya
    // esta en bolivares, asi que repetir bolivares no diria nada nuevo).
    expect(text).toContain('USD · BCV $ 10.00');
    expect(text).toContain('EUR · BCV € 8.92');
    expect(text).not.toContain('Personalizada');
  });

  it('lista el dolar del BCV junto al personalizado del local', () => {
    const text = load(withCustomDollar());

    // Listado con la moneda base en bolivares: la tasa personalizada del local no
    // tapa al dolar del BCV. El monto en Bs (9.054,20 a la tasa del local) vuelto
    // a divisa: al BCV son 10,33 dolares y al euro del BCV 9,22.
    expect(text).toContain('USD · BCV $ 10.32');
    expect(text).toContain('EUR · BCV € 9.22');
    expect(text).not.toContain('personalizada');
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
 * Conversiones que ve el cajero: por defecto **ninguna** (los precios, en la
 * moneda que le configuraron) y debajo solo las monedas que el admin active en
 * Configuración → Cajero. Quien administra el local sigue viendo todas.
 */
describe('MoneyComponent (conversiones que ve el cajero)', () => {
  let http: HttpTestingController;
  let rates: RatesService;
  let preferences: PreferencesService;
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    localStorage.clear();
    // El cajero ya entró: el rol y la preferencia de la empresa se leen de aquí.
    saveSession({ accessToken: 'token', role: 'CASHIER' } as SessionResponse);

    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    rates = TestBed.inject(RatesService);
    preferences = TestBed.inject(PreferencesService);
    rates.setConversions(true);
    fixture = TestBed.createComponent(HostComponent);
  });

  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(CONVERSION_KEY);
    localStorage.removeItem(PRICE_CURRENCY_KEY);
    clearSession();
    setDisplayCurrency(null);
    http.verify();
  });

  /** Deja ese rol en la sesión guardada (el formateo lo lee de `localStorage`). */
  function roleAs(role: Role): void {
    saveSession({ accessToken: 'token', role } as SessionResponse);
  }

  /** Pinta el monto en la moneda que la empresa le configuró al cajero. */
  function preferCode(code: string | null): void {
    preferences.setPriceCurrency(code);
    http
      .expectOne({ method: 'PATCH', url: `${API}/preferences` })
      .flush({ tipPercent: 10, dialogView: 'modal', priceCurrency: code });
  }

  /** Activa las conversiones que verá el cajero (como el admin en Configuración). */
  function allowConversions(codes: string[]): void {
    preferences.setConversionCurrencies(codes);
    http
      .expectOne({ method: 'PATCH', url: `${API}/preferences` })
      .flush({ tipPercent: 10, dialogView: 'modal', priceCurrency: null, conversionCurrencies: codes });
  }

  function load(snapshot: RatesSnapshot): string {
    rates.load();
    http.expectOne(`${API}/rates`).flush(snapshot);
    fixture.detectChanges();
    return fixture.nativeElement.textContent as string;
  }

  it('por defecto no muestra ninguna conversión: solo el precio en su moneda', () => {
    preferCode('VES');
    const text = load(BCV_ONLY);

    expect(rates.allowedConversionCodes()).toEqual([]);
    // El precio se ve en la moneda que le configuraron…
    expect(text).toContain('Bs 8,767.97');
    // …y debajo no aparece ninguna conversión "al cambio".
    expect(text).not.toContain('BCV $');
    expect(text).not.toContain('BCV €');
  });

  it('muestra los montos al cambio solo si el admin activa los bolívares', () => {
    preferCode('VES');
    // Con la moneda base de la empresa en dólares, la conversión es el equivalente
    // en bolívares de cada tasa: la gobierna la moneda local.
    allowConversions(['VES']);
    const text = load(BCV_ONLY);

    expect(text).toContain('BCV $');
    expect(text).toContain('Bs 8,767.97');
  });

  it('con la moneda base de la empresa en otra moneda, deja pasar las activadas', () => {
    // La empresa muestra los montos en bolívares: debajo van las divisas.
    allowConversions(['USD']);
    const text = load(withBase('VES'));

    expect(text).toContain('USD · BCV $ 10.00');
    expect(text).not.toContain('EUR · BCV');
  });

  it('a quien administra el local no le cambia la vista', () => {
    roleAs('ADMIN');
    allowConversions([]);
    const text = load(BCV_ONLY);

    // ADMIN y MANAGER ven todas las conversiones, igual que siempre.
    expect(rates.allowedConversionCodes()).toBeNull();
    expect(text).toContain('BCV $');
    expect(text).toContain('BCV €');
  });

  it('sin sesión (pantallas sin rol) no se filtra nada', () => {
    clearSession();
    allowConversions([]);
    const text = load(BCV_ONLY);

    expect(rates.allowedConversionCodes()).toBeNull();
    expect(text).toContain('BCV $');
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

  it('muestra los bolívares congelados del pedido aunque el USD redondeado dé otro monto', () => {
    load(withBase('VES'));
    // El pedido guardó Bs 15.520,00 = 16,34 USD: reconvertir el USD a la tasa
    // del BCV daría otro monto y el ticket no coincidiría con lo cobrado.
    fixture.componentInstance.amount.set(16.34);
    fixture.componentInstance.entered.set(15_520);
    fixture.componentInstance.currency.set('VES');
    fixture.detectChanges();

    const base = (fixture.nativeElement as HTMLElement).querySelector('app-money span');

    expect(base?.textContent?.trim()).toBe('Bs 15,520.00');
  });

  it('muestra en negativo un descuento congelado en la moneda del pedido', () => {
    load(withBase('VES'));
    fixture.componentInstance.amount.set(-1.52);
    fixture.componentInstance.entered.set(-1_520);
    fixture.componentInstance.currency.set('VES');
    fixture.detectChanges();

    const base = (fixture.nativeElement as HTMLElement).querySelector('app-money span');

    expect(base?.textContent?.trim()).toBe('Bs -1,520.00');
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
    expect(base?.textContent?.trim()).toBe('Bs 8,767.97');
    expect(text).toContain('USD · BCV $ 10.00');
  });
});

/**
 * Precio en dólares del BCV: la línea que el admin activa para que el cajero vea,
 * debajo de cada monto, la equivalencia con la **tasa oficial** del BCV. Con los
 * precios en bolívares son los dólares oficiales de lo cobrado (`USD · BCV $ 10,00`)
 * y con los precios en una divisa, los bolívares a esa tasa (`VES · BCV Bs 8.767,98`).
 * Es una línea aparte de las conversiones "al cambio": se ve aunque esa lista esté
 * vacía, y no repite la línea del dólar del BCV cuando el admin también la activó.
 */
describe('MoneyComponent (precio en dólares del BCV)', () => {
  let http: HttpTestingController;
  let rates: RatesService;
  let preferences: PreferencesService;
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    localStorage.clear();
    // El cajero ya entró: el rol y la preferencia de la empresa se leen de aquí.
    saveSession({ accessToken: 'token', role: 'CASHIER' } as SessionResponse);

    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    rates = TestBed.inject(RatesService);
    preferences = TestBed.inject(PreferencesService);
    rates.setConversions(true);
    fixture = TestBed.createComponent(HostComponent);
  });

  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(CONVERSION_KEY);
    localStorage.removeItem(PRICE_CURRENCY_KEY);
    localStorage.removeItem(SHOW_BCV_PRICE_KEY);
    clearSession();
    setDisplayCurrency(null);
    http.verify();
  });

  /** Deja la sesión con ese rol (es lo que lee la vista del cajero). */
  function roleAs(role: Role): void {
    saveSession({ accessToken: 'token', role } as SessionResponse);
  }

  /**
   * Preferencias de la empresa tal como las guarda Configuración → Cajero: la
   * moneda de los precios (bolívares por defecto en estas pruebas), las monedas
   * cuyas conversiones ve el cajero y si además ve el precio en dólares del BCV. Se
   * manda la foto completa, como la pantalla.
   */
  function companyPrefs(options: {
    priceCurrency?: string | null;
    conversions?: string[] | null;
    showBcvPrice?: boolean;
  } = {}): void {
    const priceCurrency = options.priceCurrency === undefined ? 'VES' : options.priceCurrency;
    const conversions = options.conversions ?? null;
    const showBcvPrice = options.showBcvPrice === true;
    preferences.setPosPreferences(10, priceCurrency, conversions, showBcvPrice);
    http.expectOne({ method: 'PATCH', url: `${API}/preferences` }).flush({
      tipPercent: 10,
      dialogView: 'modal',
      priceCurrency,
      conversionCurrencies: conversions?.length ? conversions : null,
      showBcvPrice: showBcvPrice ? true : null,
    });
  }

  function load(snapshot: RatesSnapshot): string {
    rates.load();
    http.expectOne(`${API}/rates`).flush(snapshot);
    fixture.detectChanges();
    return fixture.nativeElement.textContent as string;
  }

  /** Veces que el texto trae la línea del dólar oficial (`USD · BCV $ …`). */
  function bcvLines(text: string): number {
    return (text.match(/USD · BCV \$/g) ?? []).length;
  }

  /** Veces que el texto trae la línea de los bolívares oficiales (`VES · BCV Bs …`). */
  function bcvBsLines(text: string): number {
    return (text.match(/VES · BCV Bs/g) ?? []).length;
  }

  it('sin activarlo no agrega ninguna línea', () => {
    companyPrefs({});
    const text = load(withBase('VES'));

    // El precio en bolívares y sus conversiones, pero nada del dólar oficial.
    expect(text).toContain('Bs 8,767.97');
    expect(rates.showBcvPrice()).toBeFalse();
    expect(bcvLines(text)).toBe(0);
    expect(bcvBsLines(text)).toBe(0);
  });

  it('lo muestra aunque el cajero no tenga conversiones "al cambio"', () => {
    companyPrefs({ showBcvPrice: true });
    const text = load(withBase('VES'));

    // Los precios en bolívares y, debajo, su equivalente en dólares oficiales:
    // los 8 767,98 Bs del monto, a 876,7976 Bs por dólar, son $ 10,00 del BCV.
    expect(rates.allowedConversionCodes()).toEqual([]);
    expect(rates.showBcvPrice()).toBeTrue();
    expect(text).toContain('USD · BCV $ 10.00');
  });

  it('con tasa personalizada la línea del BCV convierte los bolívares de la vitrina', () => {
    companyPrefs({ showBcvPrice: true });
    const text = load(withCustomDollar());

    // El monto se lee en los bolívares de la vitrina ($ 10,00 × 905,42 = Bs 9.054,20)
    // y la línea oficial son ESOS bolívares al BCV: 9.054,20 / 876,7976 = $ 10,33.
    // Con el monto guardado en dólares salía $ 10,00: los de la vitrina, no el BCV.
    expect(text).toContain('Bs 9,054.20');
    expect(text).toContain('USD · BCV $ 10.32');
    expect(text).not.toContain('USD · BCV $ 10.00');
    expect(bcvLines(text)).toBe(1);
  });

  it('el monto congelado del pedido manda sobre los dólares guardados', () => {
    companyPrefs({ showBcvPrice: true });
    load(withCustomDollar());
    // Monto cargado a mano en bolívares (Bs 9.054,20): los dólares guardados son el
    // equivalente de vitrina y no deben mandar en la línea oficial.
    fixture.componentInstance.amount.set(9.92);
    fixture.componentInstance.entered.set(9054.2);
    fixture.componentInstance.currency.set('VES');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('Bs 9,054.20');
    expect(text).toContain('USD · BCV $ 10.32');
    expect(text).not.toContain('USD · BCV $ 9.92');
  });

  it('la línea del BCV sale de los bolívares del precio, no del monto en dólares', () => {
    // Reporte de caja: Bs 15.520,00 (USD 16,00 a la tasa del local de 970) mostraba
    // `USD · BCV $ 16,00`; esos bolívares al BCV (883,30) son $ 17,57.
    companyPrefs({ showBcvPrice: true });
    load(withLocalPrice());
    fixture.componentInstance.amount.set(16);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('Bs 15,520.00');
    expect(text).toContain('USD · BCV $ 17.57');
    expect(text).not.toContain('USD · BCV $ 16.00');
    expect(bcvLines(text)).toBe(1);
  });

  it('no repite la línea cuando el admin ya activó esa conversión', () => {
    companyPrefs({ conversions: ['USD'], showBcvPrice: true });
    const text = load(withBase('VES'));

    // La conversión "al cambio" del dólar del BCV ya estaba en la lista: la línea
    // extra no se duplica.
    expect(bcvLines(text)).toBe(1);
  });

  it('a quien administra el local no se le agrega', () => {
    companyPrefs({ showBcvPrice: true });
    roleAs('ADMIN');
    const text = load(withBase('VES'));

    // La preferencia es de la caja: ADMIN y MANAGER conservan su vista.
    expect(rates.showBcvPrice()).toBeFalse();
    expect(text).toContain('Bs 8,767.97');
    expect(bcvLines(text)).toBe(1);
  });

  it('respeta los bolívares que escribió el operador', () => {
    companyPrefs({ showBcvPrice: true });
    load(withBase('VES'));
    // Monto cargado a mano: Bs 350,00 guardados como $ 0,36 (el redondeo a centavos).
    fixture.componentInstance.amount.set(0.36);
    fixture.componentInstance.entered.set(350);
    fixture.componentInstance.currency.set('VES');
    fixture.componentInstance.rateKey.set('BCV_USD');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;

    // El dólar oficial sale de los bolívares cobrados (350 / 876,7976 = $ 0,40) y no
    // de reconvertir el equivalente guardado (0,36 * 876,7976 / 876,7976 = $ 0,36).
    expect(text).toContain('Bs 350.00');
    expect(text).toContain('USD · BCV $ 0.39');
    expect(bcvLines(text)).toBe(1);
  });

  it('con los precios en dólares la línea trae los bolívares de la tasa oficial', () => {
    // Empresa con los precios en dólares: el monto ya está en divisa, así que la
    // línea responde la otra pregunta del mostrador —cuántos bolívares son esos
    // dólares a la tasa oficial del BCV— y va rotulada `VES · BCV`.
    companyPrefs({ priceCurrency: null, showBcvPrice: true });
    const text = load(BCV_ONLY);

    expect(rates.showBcvPrice()).toBeTrue();
    // $ 10,00 a 876,7976 Bs por dólar son los 8 767,98 Bs del monto.
    expect(text).toContain('$ 10.00');
    expect(text).toContain('VES · BCV Bs 8,767.97');
    expect(bcvBsLines(text)).toBe(1);
    expect(bcvLines(text)).toBe(0);
  });

  it('la línea sale de la tasa oficial aunque el local tenga la suya', () => {
    // Tasa personalizada del local (905,42 Bs por dólar): los bolívares de la
    // línea son los del BCV (876,7976) y no los del local, que es la comparación
    // que necesita quien cobra.
    companyPrefs({ priceCurrency: null, showBcvPrice: true });
    const text = load(WITH_CUSTOM);

    expect(text).toContain('VES · BCV Bs 8,767.97');
    expect(text).not.toContain('VES · BCV Bs 9,054.20');
  });
});

