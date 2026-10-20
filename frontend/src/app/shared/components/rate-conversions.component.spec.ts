import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import { clearSession, saveSession } from '../../core/auth/session';
import type { SessionResponse } from '../../core/models/api.model';
import type { RatesSnapshot, RateKey } from '../../core/models/rates.model';
import { PreferencesService } from '../../core/services/preferences.service';
import { RatesService } from '../../core/services/rates.service';
import { RateConversionsComponent } from './rate-conversions.component';

const API = environment.apiUrl;

/** Tasas de prueba: BCV dolar, BCV euro y la personalizada del local. */
const SNAPSHOT: RatesSnapshot = {
  bcv: {
    current: { date: '2026-10-13', usd: 900, eur: 1000 },
    previous: { date: '2026-10-09', usd: 890, eur: 990 },
    changePercentage: { usd: 1.12, eur: 1.01 },
    fetchedAt: '2026-10-13T12:00:00.000Z',
    expiresAt: '2026-10-13T12:15:00.000Z',
    stale: false,
    sourceUrl: 'https://rates.dolarvzla.com/bcv/current.json',
  },
  custom: { usd: 950, updatedAt: '2026-10-13T12:00:00.000Z', updatedBy: null },
  rates: [
    {
      key: 'BCV_USD',
      currency: 'USD',
      source: 'BCV',
      rate: 900,
      date: '2026-10-13',
      previousRate: 890,
      changePercentage: 1.12,
    },
    {
      key: 'BCV_EUR',
      currency: 'EUR',
      source: 'BCV',
      rate: 1000,
      date: '2026-10-13',
      previousRate: 990,
      changePercentage: 1.01,
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
  activeKey: 'CUSTOM_USD',
  currencies: [
    {
      code: 'USD',
      label: 'Dólares',
      symbol: '$',
      enabled: true,
      bsPerUnit: 950,
      source: 'CUSTOM',
      isBase: true,
      isDisplayBase: true,
      bsPerUsd: 950,
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
      bsPerUsd: 950,
    },
  ],
  baseCurrency: {
    code: 'USD',
    label: 'Dólares',
    symbol: '$',
    decimals: 2,
    bsPerUnit: 950,
    bsPerUsd: 950,
  },
  reference: null,
};

@Component({
  standalone: true,
  imports: [RateConversionsComponent],
  template: `
    <app-rate-conversions
      [amount]="amount()"
      [currency]="currency()"
      [rateKey]="rateKey()"
    />
  `,
})
class HostComponent {
  readonly amount = signal<number>(0);
  readonly currency = signal('USD');
  /** Tasa elegida en el campo (se resalta su linea). */
  readonly rateKey = signal<RateKey | null>(null);
}

describe('RateConversionsComponent', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    TestBed.inject(RatesService).load();
    http.expectOne(`${API}/rates`).flush(SNAPSHOT);

    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  function text(): string {
    return (fixture.nativeElement.textContent ?? '').replace(/\s+/g, ' ');
  }

  /** Texto de la linea resaltada (la de la tasa elegida); vacio si no hay. */
  function highlighted(): string {
    const chip = fixture.nativeElement.querySelector(
      'span.bg-slate-700',
    ) as HTMLElement | null;
    return (chip?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  it('no muestra nada mientras no hay monto', () => {
    expect(text().trim()).toBe('');
  });

  it('convierte un monto en dolares solo con las tasas oficiales', () => {
    fixture.componentInstance.amount.set(10);
    fixture.detectChanges();

    expect(text()).toContain('BCV $: Bs 9,000.00');
    expect(text()).toContain('BCV €: Bs 10,000.00');
    expect(text()).not.toContain('Personalizada');
  });

  it('convierte un monto en bolivares a la divisa de cada tasa', () => {
    fixture.componentInstance.currency.set('VES');
    fixture.componentInstance.amount.set(9000);
    fixture.detectChanges();

    expect(text()).toContain('BCV $: $ 10.00');
    // El euro del BCV se muestra en euros: su tasa (1.000 Bs) es la oficial de esa
    // divisa, así que el equivalente no puede salir rotulado con el dólar.
    expect(text()).toContain('BCV €: € 9.00');
    expect(text()).not.toContain('Personalizada');
  });

  it('muestra el equivalente de otra moneda configurada', () => {
    fixture.componentInstance.currency.set('COP');
    fixture.componentInstance.amount.set(1000);
    fixture.detectChanges();

    // Sin tasa configurada para COP no hay conversion que mostrar.
    expect(text().trim()).toBe('');
  });

  /**
   * La ida a dolares de una moneda que no es la base ni el bolivar usa la **tasa
   * elegida** en el campo (`rateKey`): es la misma con la que el API guarda el
   * monto, asi que el chip no puede decir un equivalente distinto al registrado.
   */
  it('convierte otra moneda con la tasa elegida', () => {
    // Este local acepta soles: 0,25 Bs por sol.
    TestBed.inject(RatesService).load(true);
    http.expectOne(`${API}/rates?refresh=true`).flush({
      ...SNAPSHOT,
      currencies: [
        ...SNAPSHOT.currencies,
        {
          code: 'PEN',
          label: 'Soles',
          symbol: 'S/',
          enabled: true,
          bsPerUnit: 0.25,
          source: 'MANUAL',
          isBase: false,
          isDisplayBase: false,
          bsPerUsd: 950,
        },
      ],
    });

    fixture.componentInstance.currency.set('PEN');
    fixture.componentInstance.amount.set(1000);
    fixture.componentInstance.rateKey.set('BCV_USD');
    fixture.detectChanges();

    // 1.000 soles son 250 Bs y, al cambio del BCV (900), $ 0.28 (con la
    // personalizada del local serian $ 0.26: la tasa elegida es la que manda).
    expect(text()).toContain('=: $ 0.28');
  });

  /**
   * Con `rateKey` (el campo permite elegir tasa) se resalta la linea de la tasa
   * elegida: es con la que se calculara el monto al guardar.
   */
  it('resalta la linea de la tasa elegida', () => {
    fixture.componentInstance.amount.set(10);
    fixture.componentInstance.rateKey.set('BCV_USD');
    fixture.detectChanges();

    expect(highlighted()).toBe('BCV $: Bs 9,000.00');

    fixture.componentInstance.rateKey.set('BCV_EUR');
    fixture.detectChanges();

    expect(highlighted()).toBe('BCV €: Bs 10,000.00');
  });

  it('no resalta ninguna linea cuando el campo no pide tasa', () => {
    fixture.componentInstance.amount.set(10);
    fixture.detectChanges();

    expect(highlighted()).toBe('');
  });
});

/**
 * Lineas que ve el **personal de caja**: solo las monedas que el admin activo en
 * Configuracion -> Cajero (por defecto **ninguna**, el monto en su moneda y nada
 * debajo). Quien administra el local, y las pantallas sin sesion, las ven todas.
 */
describe('RateConversionsComponent (conversiones que ve el cajero)', () => {
  let http: HttpTestingController;
  let rates: RatesService;
  let preferences: PreferencesService;
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    localStorage.clear();
    // El cajero ya entro: el rol y la preferencia de la empresa se leen de aqui.
    saveSession({ accessToken: 'token', role: 'CASHIER' } as SessionResponse);

    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    rates = TestBed.inject(RatesService);
    preferences = TestBed.inject(PreferencesService);
    rates.load();
    http.expectOne(`${API}/rates`).flush(SNAPSHOT);

    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.clear();
    clearSession();
    http.verify();
  });

  function text(): string {
    return (fixture.nativeElement.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  /** Activa las monedas que vera el cajero (como el admin en Configuracion). */
  function allowConversions(codes: string[]): void {
    preferences.setConversionCurrencies(codes);
    http
      .expectOne({ method: 'PATCH', url: `${API}/preferences` })
      .flush({ tipPercent: 10, dialogView: 'modal', conversionCurrencies: codes });
  }

  it('por defecto no pinta ninguna linea', () => {
    fixture.componentInstance.amount.set(10);
    fixture.detectChanges();

    expect(rates.allowedConversionCodes()).toEqual([]);
    expect(text()).toBe('');
  });

  it('con los montos en dolares pinta la moneda local solo si esta activada', () => {
    allowConversions(['VES']);
    fixture.componentInstance.amount.set(10);
    fixture.detectChanges();

    // Las tasas siguen ahi, rotuladas como siempre, pero solo la moneda activada.
    expect(text()).toContain('BCV $: Bs 9,000.00');
    expect(text()).toContain('BCV €: Bs 10,000.00');

    allowConversions([]);
    fixture.detectChanges();

    expect(text()).toBe('');
  });

  it('con los montos en bolivares deja pasar la moneda activada', () => {
    allowConversions(['EUR']);
    fixture.componentInstance.currency.set('VES');
    fixture.componentInstance.amount.set(9000);
    fixture.detectChanges();

    expect(text()).toContain('BCV €: € 9.00');
    expect(text()).not.toContain('BCV $');
    expect(text()).not.toContain('Personalizada');
  });

  it('a quien administra el local no le cambia la vista', () => {
    saveSession({ accessToken: 'token', role: 'ADMIN' } as SessionResponse);
    allowConversions([]);
    fixture.componentInstance.amount.set(10);
    fixture.detectChanges();

    expect(rates.allowedConversionCodes()).toBeNull();
    expect(text()).toContain('BCV $: Bs 9,000.00');
    expect(text()).toContain('BCV €: Bs 10,000.00');
    expect(text()).not.toContain('Personalizada');
  });
});
