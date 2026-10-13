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

/** Monedas configuradas para las pruebas (USD base + VES local). */
function currenciesFor(bsPerUsd: number): RatesSnapshot['currencies'] {
  return [
    {
      code: 'USD',
      label: 'Dólares',
      symbol: '$',
      enabled: true,
      bsPerUnit: bsPerUsd,
      source: 'BASE',
      isBase: true,
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
  currencies: currenciesFor(876.7976),
  // Tasa USDT de referencia: informativa, no entra en las conversiones.
  reference: null,
};

const WITH_CUSTOM: RatesSnapshot = {
  ...BCV_ONLY,
  currencies: currenciesFor(905.42),
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
  template: `<app-money [amount]="amount()" [compact]="compact()" />`,
})
class HostComponent {
  readonly amount = signal<number>(10);
  readonly compact = signal<boolean>(false);
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
});
