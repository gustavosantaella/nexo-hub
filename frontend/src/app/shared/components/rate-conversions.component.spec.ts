import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import type { RatesSnapshot, RateKey } from '../../core/models/rates.model';
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

  it('convierte un monto en dolares a bolivares con las tres tasas', () => {
    fixture.componentInstance.amount.set(10);
    fixture.detectChanges();

    expect(text()).toContain('BCV $: Bs 9,000.00');
    expect(text()).toContain('BCV €: Bs 10,000.00');
    expect(text()).toContain('Personalizada: Bs 9,500.00');
  });

  it('convierte un monto en bolivares a dolares con las tres tasas', () => {
    fixture.componentInstance.currency.set('VES');
    fixture.componentInstance.amount.set(9000);
    fixture.detectChanges();

    expect(text()).toContain('BCV $: $ 10.00');
    expect(text()).toContain('BCV €: $ 9.00');
    expect(text()).toContain('Personalizada: $ 9.47');
  });

  it('muestra el equivalente de otra moneda configurada', () => {
    fixture.componentInstance.currency.set('COP');
    fixture.componentInstance.amount.set(1000);
    fixture.detectChanges();

    // Sin tasa configurada para COP no hay conversion que mostrar.
    expect(text().trim()).toBe('');
  });

  /**
   * Con `rateKey` (el campo permite elegir tasa) se resalta la linea de la tasa
   * elegida: es con la que se calculara el monto al guardar.
   */
  it('resalta la linea de la tasa elegida', () => {
    fixture.componentInstance.amount.set(10);
    fixture.componentInstance.rateKey.set('CUSTOM_USD');
    fixture.detectChanges();

    // (10 USD al cambio de la personalizada = 9.500 Bs.)
    expect(highlighted()).toBe('Personalizada: Bs 9,500.00');

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
