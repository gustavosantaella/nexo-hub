import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { StatCardComponent } from './stat-card.component';

/** Tarjeta de indicador: valores abreviados para que no se salgan de la card. */
describe('StatCardComponent (tarjeta de indicador)', () => {
  let fixture: ComponentFixture<StatCardComponent>;

  beforeEach(async () => {
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
