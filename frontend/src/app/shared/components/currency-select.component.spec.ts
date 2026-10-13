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
import { CurrencySelectComponent } from './currency-select.component';

const API = environment.apiUrl;

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
      bsPerUnit: null,
      source: 'NONE',
      isBase: false,
      bsPerUsd: 876.7976,
    },
  ],
  reference: null,
};

@Component({
  standalone: true,
  imports: [CurrencySelectComponent],
  template: `
    <app-currency-select
      id="test-currency"
      label="Moneda del pago"
      [value]="currency()"
      [amount]="amount()"
      (valueChange)="currency.set($event)"
    />
  `,
})
class HostComponent {
  readonly currency = signal('USD');
  readonly amount = signal<number>(0);
}

/** Selector de la moneda de un pago con vista previa de la conversión. */
describe('CurrencySelectComponent', () => {
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

    rates.load();
    http.expectOne(`${API}/rates`).flush(SNAPSHOT);

    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  function options(): HTMLOptionElement[] {
    return Array.from(
      fixture.nativeElement.querySelectorAll('option'),
    ) as HTMLOptionElement[];
  }

  function select(): HTMLSelectElement {
    return fixture.nativeElement.querySelector('select') as HTMLSelectElement;
  }

  it('lista solo las monedas habilitadas', () => {
    expect(options().map((option) => option.value)).toEqual([
      'USD',
      'VES',
      'COP',
    ]);
    expect(options()[1].textContent).toContain('Bolívares (VES)');
  });

  it('emite el cambio de moneda', () => {
    select().value = 'COP';
    select().dispatchEvent(new Event('change'));

    expect(fixture.componentInstance.currency()).toBe('COP');
  });

  it('muestra el equivalente en dólares del monto indicado', () => {
    fixture.componentInstance.currency.set('VES');
    fixture.componentInstance.amount.set(8767.976);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('= $ 10.00');
  });

  it('calcula el equivalente de otra moneda configurada', () => {
    fixture.componentInstance.currency.set('COP');
    fixture.componentInstance.amount.set(1000);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('= $ 0.25');
  });

  it('muestra el equivalente al cambio cuando se cobra en dólares', () => {
    fixture.componentInstance.amount.set(10);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('al cambio');
  });

  it('no muestra conversión cuando el monto es cero', () => {
    fixture.componentInstance.amount.set(0);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('=');
  });
});
