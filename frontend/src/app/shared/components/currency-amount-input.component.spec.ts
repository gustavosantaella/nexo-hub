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
import { CurrencyAmountInputComponent } from './currency-amount-input.component';

const API = environment.apiUrl;

/** Tasas de prueba: USD/VES habilitadas y EUR sin tasa. */
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
  custom: null,
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
  ],
  activeKey: 'BCV_USD',
  currencies: [
    {
      code: 'USD',
      label: 'Dólares',
      symbol: '$',
      enabled: true,
      bsPerUnit: 900,
      source: 'BCV',
      isBase: true,
      isDisplayBase: true,
      bsPerUsd: 900,
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
      bsPerUsd: 900,
    },
    {
      code: 'EUR',
      label: 'Euros',
      symbol: '€',
      enabled: true,
      bsPerUnit: null,
      source: 'NONE',
      isBase: false,
      isDisplayBase: false,
      bsPerUsd: 900,
    },
  ],
  baseCurrency: {
    code: 'USD',
    label: 'Dólares',
    symbol: '$',
    decimals: 2,
    bsPerUnit: 900,
    bsPerUsd: 900,
  },
  reference: null,
};

@Component({
  standalone: true,
  imports: [CurrencyAmountInputComponent],
  template: `
    <app-currency-amount-input
      id="test-amount"
      label="Precio"
      [required]="true"
      [amount]="amount()"
      [currency]="currency()"
      [rateKey]="rateKey()"
      (amountChange)="amount.set($event)"
      (currencyChange)="currency.set($event)"
      (rateKeyChange)="rateKey.set($event)"
    />
  `,
})
class HostComponent {
  readonly amount = signal<number | null>(0);
  readonly currency = signal('USD');
  /** `null` = el campo no pide tasa (comportamiento anterior). */
  readonly rateKey = signal<RateKey | null>(null);
}

describe('CurrencyAmountInputComponent', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    TestBed.inject(RatesService).load();

    // El campo se crea con las monedas aun en camino (las tasas llegan despues del
    // primer render, como en la aplicacion) y recien despues se resuelven.
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    http.expectOne(`${API}/rates`).flush(SNAPSHOT);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  function text(): string {
    return (fixture.nativeElement.textContent ?? '').replace(/\s+/g, ' ');
  }

  function input(): HTMLInputElement {
    return fixture.nativeElement.querySelector('input') as HTMLInputElement;
  }

  function select(): HTMLSelectElement {
    return fixture.nativeElement.querySelector('select') as HTMLSelectElement;
  }

  /** Selector de tasa (solo aparece cuando el campo recibe `rateKey`). */
  function rateSelect(): HTMLSelectElement | null {
    return fixture.nativeElement.querySelector(
      '#test-amount-rate',
    ) as HTMLSelectElement | null;
  }

  /** Texto de la conversion resaltada (la de la tasa elegida). */
  function selectedConversion(): string {
    const chip = fixture.nativeElement.querySelector(
      'app-rate-conversions span.bg-slate-700',
    ) as HTMLElement | null;
    return (chip?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  it('muestra la etiqueta, el monto y el selector de moneda', () => {
    expect(text()).toContain('Precio *');
    expect(select().value).toBe('USD');
    expect(Array.from(select().options).map((option) => option.value)).toEqual([
      'USD',
      'VES',
      'EUR',
    ]);
  });

  /**
   * La lista de monedas dice con que tasa se calcula cada una (`USD · BCV`,
   * `EUR · personalizada`): el operador ya no confunde el dolar del BCV con el del
   * local al cargar un precio.
   */
  it('dice con qué tasa se calcula cada moneda', () => {
    expect(
      Array.from(select().options).map((option) => option.textContent?.trim()),
    ).toEqual(['USD · BCV', 'VES', 'EUR']);
  });

  /**
   * Las monedas del local llegan junto con las tasas: el campo puede existir
   * cuando la lista se puebla y aun asi debe mostrar la moneda del monto. Con
   * `[value]` en el `select` se quedaba en la primera opcion, asi que el operador
   * veia "USD" con el monto en bolivares y la conversion parecia invertida
   * (dividia por la tasa en lugar de multiplicarla).
   */
  it('muestra la moneda real del monto cuando las monedas llegan despues', () => {
    fixture.componentInstance.currency.set('VES');
    fixture.componentInstance.amount.set(9000);
    fixture.detectChanges();

    expect(select().value).toBe('VES');
    // 9.000 Bs al cambio del BCV $ son 10 USD (bolivares a dolares: se divide).
    expect(text()).toContain('BCV $: $ 10.00');
  });

  it('emite el monto escrito y la moneda elegida', () => {
    input().value = '12.5';
    input().dispatchEvent(new Event('input'));
    expect(fixture.componentInstance.amount()).toBe(12.5);

    select().value = 'VES';
    select().dispatchEvent(new Event('change'));
    expect(fixture.componentInstance.currency()).toBe('VES');
  });

  it('convierte el monto a las tasas del sistema mientras se escribe', () => {
    fixture.componentInstance.amount.set(10);
    fixture.detectChanges();

    expect(text()).toContain('BCV $: Bs 9,000.00');
    expect(text()).toContain('BCV €: Bs 10,000.00');
  });

  it('avisa cuando la moneda elegida no tiene tasa', () => {
    fixture.componentInstance.currency.set('EUR');
    fixture.componentInstance.amount.set(10);
    fixture.detectChanges();

    expect(text()).toContain('EUR');
    expect(text()).toContain('no tiene tasa configurada');
  });

  /**
   * Con `rateKey` el campo agrega el selector de TASA: el operador decide con cual
   * de las tasas del sistema se calcula ese monto (la que el API guarda). Sin
   * `rateKey` el campo se comporta como antes (tasa activa, sin selector).
   */
  it('no pide tasa mientras el campo no la declare', () => {
    fixture.componentInstance.currency.set('VES');
    fixture.componentInstance.amount.set(9000);
    fixture.detectChanges();

    expect(rateSelect()).toBeNull();
  });

  it('no pide tasa cuando el monto ya esta en la moneda base', () => {
    fixture.componentInstance.rateKey.set('BCV_USD');
    fixture.detectChanges();

    expect(rateSelect()).toBeNull();
  });

  it('permite elegir la tasa con la que se calcula el monto', () => {
    fixture.componentInstance.rateKey.set('BCV_USD');
    fixture.componentInstance.currency.set('VES');
    fixture.componentInstance.amount.set(9000);
    fixture.detectChanges();

    const select = rateSelect() as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.value)).toEqual([
      'BCV_USD',
      'BCV_EUR',
    ]);
    expect(select.options[0].textContent).toContain('BCV $ · 900.00 Bs');
    expect(select.options[1].textContent).toContain('BCV € · 1,000.00 Bs');
    expect(select.value).toBe('BCV_USD');

    select.value = 'BCV_EUR';
    select.dispatchEvent(new Event('change'));

    expect(fixture.componentInstance.rateKey()).toBe('BCV_EUR');
    // La moneda no se toca: son selectores independientes.
    expect(fixture.componentInstance.currency()).toBe('VES');
  });

  it('resalta la conversion de la tasa elegida y la calcula con ella', () => {
    fixture.componentInstance.rateKey.set('BCV_USD');
    fixture.componentInstance.currency.set('VES');
    fixture.componentInstance.amount.set(9000);
    fixture.detectChanges();

    // 9.000 Bs son 10 USD al cambio del BCV $ y 9 EUR al del euro: la linea del
    // euro va en euros (la moneda de su propia tasa), no en dolares.
    expect(text()).toContain('BCV $: $ 10.00');
    expect(text()).toContain('BCV €: € 9.00');
    expect(text()).not.toContain('BCV €: $ 9.00');
    expect(selectedConversion()).toContain('BCV $: $ 10.00');

    fixture.componentInstance.rateKey.set('BCV_EUR');
    fixture.detectChanges();

    expect(selectedConversion()).toContain('BCV €: € 9.00');
  });

  it('cae en la tasa activa cuando la elegida ya no esta disponible', () => {
    fixture.componentInstance.rateKey.set('CUSTOM_USD');
    fixture.componentInstance.currency.set('VES');
    fixture.componentInstance.amount.set(9000);
    fixture.detectChanges();

    // El snapshot no trae la personalizada: se usa la activa (BCV $).
    expect((rateSelect() as HTMLSelectElement).value).toBe('BCV_USD');
  });
});
