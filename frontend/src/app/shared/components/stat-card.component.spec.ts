import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { setDisplayCurrency } from '../../core/utils/format';
import { StatCardComponent } from './stat-card.component';

/** Tarjeta de indicador: valores abreviados para que no se salgan de la card. */
describe('StatCardComponent (tarjeta de indicador)', () => {
  let fixture: ComponentFixture<StatCardComponent>;

  beforeEach(async () => {
    setDisplayCurrency(null);
    await TestBed.configureTestingModule({
      imports: [StatCardComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(StatCardComponent);
    fixture.componentRef.setInput('label', 'Ventas');
  });

  /** Monta la tarjeta con el valor indicado. */
  function render(value: number | string, isCurrency = true): HTMLElement {
    fixture.componentRef.setInput('value', value);
    fixture.componentRef.setInput('isCurrency', isCurrency);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  /** Valor pintado en la tarjeta (el segundo parrafo, tras el titulo). */
  function valueNode(root: HTMLElement): HTMLElement | null {
    return root.querySelector<HTMLElement>('p.mt-2');
  }

  it('abrevia los montos grandes y deja el exacto en el tooltip', () => {
    const root = render(1_250_000);

    expect(root.textContent).toContain('$ 1.3m');
    expect(root.textContent).not.toContain('$ 1,250,000.00');
    expect(root.querySelector('app-money span')?.getAttribute('title')).toBe(
      '$ 1,250,000.00',
    );
  });

  it('deja intactos los montos que caben en la tarjeta', () => {
    const root = render(999.5);

    expect(root.textContent).toContain('$ 999.50');
    expect(root.querySelector<HTMLElement>('app-money')?.classList).toContain('text-2xl');
  });

  it('pinta el monto exacto cuando la tarjeta no abrevia', () => {
    fixture.componentRef.setInput('compact', false);
    const root = render(1_250_000);

    expect(root.textContent).toContain('$ 1,250,000.00');
    expect(root.textContent).not.toContain('$ 1.3m');
    // Sin abreviatura no hace falta el tooltip y sigue reservando una linea.
    expect(root.querySelector('app-money span')?.hasAttribute('title')).toBe(false);
    expect(root.querySelector<HTMLElement>('app-money')?.classList).toContain(
      'overflow-hidden',
    );
  });

  it('pinta lo cobrado en la moneda mostrada, no su equivalente en dólares', () => {
    // Caja: Bs 15.520,00 cobrados = $ 17,57 guardados; a la tasa del BCV ese
    // dólar redondeado vuelve como Bs 15,900.85 y la tarjeta mentiría.
    setDisplayCurrency({
      code: 'VES',
      label: 'Bolívares',
      symbol: 'Bs',
      decimals: 2,
      bsPerUnit: 1,
      bsPerUsd: 905,
    });
    fixture.componentRef.setInput('compact', false);
    fixture.componentRef.setInput('entered', 15_520);
    fixture.componentRef.setInput('currency', 'VES');
    fixture.componentRef.setInput('displayRateKey', 'BCV_USD');
    const root = render(17.57);

    expect(root.textContent).toContain('Bs 15,520.00');
    expect(root.textContent).not.toContain('Bs 15,900.85');
  });

  it('achica el monto exacto para que quepa en una tarjeta angosta', () => {
    fixture.componentRef.setInput('compact', false);
    const root = render(1_250_000_000);
    const host = root.querySelector<HTMLElement>('app-money');

    expect(root.textContent).toContain('$ 1,250,000,000.00');
    expect(host?.classList).toContain('text-sm');
    expect(host?.classList).not.toContain('text-2xl');
  });

  it('no abrevia las cantidades cuando la tarjeta no abrevia', () => {
    fixture.componentRef.setInput('compact', false);
    const root = render(12_500, false);

    expect(valueNode(root)?.textContent?.trim()).toBe('12,500');
    expect(valueNode(root)?.hasAttribute('title')).toBe(false);
  });

  it('abrevia las cantidades y las separa por miles', () => {
    const root = render(12_500, false);
    const value = valueNode(root);

    expect(value?.textContent?.trim()).toBe('12.5k');
    expect(value?.getAttribute('title')).toBe('12,500');
    expect(value?.classList).toContain('text-xl');
  });

  it('deja intactas las cantidades que ya caben', () => {
    const root = render(999, false);
    const value = valueNode(root);

    expect(value?.textContent?.trim()).toBe('999');
    expect(value?.hasAttribute('title')).toBe(false);
    expect(value?.classList).toContain('text-2xl');
  });

  it('pinta los textos tal cual cuando no son numeros', () => {
    const root = render('Sin datos', false);

    expect(valueNode(root)?.textContent?.trim()).toBe('Sin datos');
    expect(valueNode(root)?.hasAttribute('title')).toBe(false);
  });

  it('reserva una sola linea para el valor (nunca se sale de la tarjeta)', () => {
    const root = render(1_250_000);
    const classes = root.querySelector<HTMLElement>('app-money')?.className ?? '';

    expect(classes).toContain('overflow-hidden');
  });
});
