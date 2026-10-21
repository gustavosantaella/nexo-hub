import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import type { RateKey, RatesSnapshot } from '../../core/models/rates.model';
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
      bsPerUnit: null,
      source: 'NONE',
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
  reference: null,
};

/**
 * Snapshot con la tasa personalizada del local activa: el dolar ya no se
 * convierte con el BCV sino con la tasa que definio el local.
 */
const CUSTOM_SNAPSHOT: RatesSnapshot = {
  ...SNAPSHOT,
  custom: { usd: 905.5, updatedAt: '2026-10-13T12:30:00.000Z', updatedBy: 'Ana' },
  currencies: [
    {
      ...SNAPSHOT.currencies[0],
      bsPerUnit: 905.5,
      bsPerUsd: 905.5,
      source: 'CUSTOM',
    },
    ...SNAPSHOT.currencies.slice(1),
  ],
  baseCurrency: { ...SNAPSHOT.baseCurrency, bsPerUnit: 905.5, bsPerUsd: 905.5 },
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
      [showHint]="showHint()"
      [rateKey]="rateKey()"
      (valueChange)="currency.set($event)"
    />
  `,
})
class HostComponent {
  readonly currency = signal('USD');
  readonly amount = signal<number>(0);
  readonly showHint = signal(true);
  readonly rateKey = signal<RateKey | null>(null);
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

    // El campo se crea con la lista de monedas aun en camino (llega con las tasas)
    // y recien despues se resuelve la peticion.
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    http.expectOne(`${API}/rates`).flush(SNAPSHOT);
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

  /**
   * La lista de monedas llega junto con las tasas: el campo puede existir cuando se
   * puebla y aun asi debe mostrar la moneda del pago. Con `[value]` en el `select`
   * se quedaba en la primera opcion, asi que el operador veia "USD" mientras el
   * pago se registraba en otra moneda.
   */
  it('muestra la moneda del pago cuando las monedas llegan despues', () => {
    fixture.componentInstance.currency.set('VES');
    fixture.detectChanges();

    expect(select().value).toBe('VES');
    expect(options().length).toBe(3);
  });

  /**
   * Cada moneda de la lista dice con que tasa se convierte: la del BCV, la
   * personalizada del local o una manual. Sin eso, "USD" y "EUR" parecen la misma
   * cosa aunque una use la tasa del local.
   */
  it('dice con qué tasa se convierte cada moneda', () => {
    expect(options()[0].textContent).toContain('Dólares (USD)');
    expect(options()[2].textContent).toContain(
      'Pesos colombianos (COP) · tasa manual',
    );
    // El bolívar vale 1 Bs: no hay tasa que aclarar.
    expect(options()[1].textContent?.trim()).toBe('Bolívares (VES)');
  });

  it('avisa cuando el dólar se convierte con la tasa personalizada', () => {
    rates.load(true);
    http.expectOne(`${API}/rates?refresh=true`).flush(CUSTOM_SNAPSHOT);
    fixture.detectChanges();

    expect(options()[0].textContent).toContain(
      'Dólares (USD) · tasa personalizada',
    );
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

  /**
   * Con una **tasa de cobro** fijada (Configuración → Cajero) el monto en bolívares
   * y la etiqueta del dólar hablan de ESA tasa: el operador no puede leer que se
   * cobra con la personalizada mientras el cajero cobra al BCV.
   */
  it('convierte y etiqueta el dólar con la tasa de cobro', () => {
    rates.load(true);
    http.expectOne(`${API}/rates?refresh=true`).flush(CUSTOM_SNAPSHOT);

    fixture.componentInstance.amount.set(10);
    fixture.componentInstance.rateKey.set('BCV_USD');
    fixture.detectChanges();

    expect(options()[0].textContent).toContain('Dólares (USD) · tasa BCV');
    // $ 10 al cambio del BCV son Bs 8.767,976 (con la personalizada, 9.055,00).
    expect(fixture.nativeElement.textContent).toContain('Bs 8,767.97');
    expect(fixture.nativeElement.textContent).toContain('tasa BCV');
  });

  /**
   * La ayuda del monto tambien usa la **tasa de cobro**: cobrando en bolivares el
   * equivalente dice los dolares que el API va a registrar por ese cobro (el precio
   * de la pantalla pasado a la tasa del cajero), no los dolares del catalogo.
   */
  it('convierte el monto en bolívares con la tasa de cobro', () => {
    rates.load(true);
    http.expectOne(`${API}/rates?refresh=true`).flush(CUSTOM_SNAPSHOT);

    fixture.componentInstance.currency.set('VES');
    // Los bolívares que se leen en pantalla: $ 10 al cambio del local (905,50).
    fixture.componentInstance.amount.set(9055);
    fixture.componentInstance.rateKey.set('BCV_USD');
    fixture.detectChanges();

    // 9.055 Bs al cambio del BCV (876,7976) son $ 10,3276...: se leen $ 10.32,
    // con la tasa nombrada para que el número se explique.
    expect(fixture.nativeElement.textContent).toContain(
      '= $ 10.32 · Bs 9,055.00 · tasa BCV',
    );
  });

  it('sin tasa de cobro el bolívar se convierte con la tasa de la pantalla', () => {
    rates.load(true);
    http.expectOne(`${API}/rates?refresh=true`).flush(CUSTOM_SNAPSHOT);

    fixture.componentInstance.currency.set('VES');
    fixture.componentInstance.amount.set(9055);
    fixture.detectChanges();

    // Los mismos bolívares, con la tasa personalizada (905,50) que es con la que
    // se ven los precios, son los $ 10.00 del catálogo.
    expect(fixture.nativeElement.textContent).toContain(
      '= $ 10.00 · Bs 9,055.00',
    );
  });

  it('no muestra conversión cuando el monto es cero', () => {
    fixture.componentInstance.amount.set(0);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('=');
  });

  /**
   * En la tarjeta de cobro el operador elige la moneda, pero el equivalente
   * (`≈ Bs … al cambio`) es ruido: el monto del cobro ya se muestra en el campo
   * y en el resumen. `showHint` permite ocultarlo solo en ese formulario.
   */
  it('omite el equivalente del monto cuando showHint es false', () => {
    fixture.componentInstance.amount.set(10);
    fixture.componentInstance.rateKey.set('BCV_USD');
    fixture.componentInstance.showHint.set(false);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('al cambio');
    expect(fixture.nativeElement.textContent).toContain('Dólares (USD) · tasa BCV');
  });
});
