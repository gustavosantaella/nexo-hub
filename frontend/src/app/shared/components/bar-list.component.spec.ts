import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { BarListComponent } from './bar-list.component';
import type { BarRow } from './bar-list.component';

/** Ranking de barras: escala comun, marca de umbral y formatos de valor. */
describe('BarListComponent (ranking de barras)', () => {
  let fixture: ComponentFixture<BarListComponent>;
  let component: BarListComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [BarListComponent] }).compileComponents();
    fixture = TestBed.createComponent(BarListComponent);
    component = fixture.componentInstance;
  });

  /** Monta el ranking con las filas indicadas. */
  function render(rows: BarRow[], isCurrency = true): HTMLElement {
    component.rows = rows;
    component.isCurrency = isCurrency;
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  /** Anchos de las barras (`width` inline) en el orden en que se pintan. */
  function widths(root: HTMLElement): string[] {
    return Array.from(root.querySelectorAll<HTMLElement>('[style*="width"]')).map(
      (bar) => bar.style.width,
    );
  }

  /** Marcas de umbral pintadas sobre las barras. */
  function markers(root: HTMLElement): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>('span.absolute'));
  }

  it('escala las barras contra el valor mayor y formatea el monto', () => {
    const root = render([
      { label: 'Harina', value: 100 },
      { label: 'Azúcar', value: 50 },
      { label: 'Sal', value: 25 },
    ]);

    expect(widths(root)).toEqual(['100%', '50%', '25%']);
    expect(root.textContent).toContain('$ 100.00');
    expect(root.textContent).toContain('$ 50.00');
    expect(root.textContent).toContain('$ 25.00');
  });

  it('respeta el texto de valor y la fila de detalle cuando se indican', () => {
    const root = render([
      {
        label: 'VES',
        value: 3200,
        valueText: 'Bs 5,000.00',
        caption: '12 cobros',
      },
    ]);

    expect(root.textContent).toContain('Bs 5,000.00');
    expect(root.textContent).toContain('12 cobros');
    expect(root.textContent).not.toContain('$ 3,200.00');
  });

  it('toma el umbral en cuenta al calcular la escala y lo marca sobre la barra', () => {
    const root = render(
      [
        {
          label: 'Harina',
          value: 10,
          valueText: '10 KG',
          caption: 'mín. 40',
          marker: 40,
          markerLabel: 'Mínimo',
        },
      ],
      false,
    );

    expect(widths(root)).toEqual(['25%']);
    const [marker] = markers(root);
    expect(marker.style.left).toBe('100%');
    expect(marker.getAttribute('title')).toBe('Mínimo: 40');
    expect(root.textContent).toContain('10 KG');
    expect(root.textContent).toContain('mín. 40');
  });

  it('usa la etiqueta de umbral del componente cuando la fila no define una', () => {
    component.markerLabel = 'Stock mínimo';
    const root = render([{ label: 'Sal', value: 2, marker: 4 }], false);

    expect(markers(root)[0].getAttribute('title')).toBe('Stock mínimo: 4');
  });

  it('abrevia los montos enormes y deja el exacto en el tooltip', () => {
    const root = render([{ label: 'Harina', value: 1_250_000, caption: '120 cajas' }]);

    expect(root.textContent).toContain('$ 1.3m');
    expect(root.textContent).not.toContain('$ 1,250,000.00');
    const value = root.querySelector<HTMLElement>('span.shrink-0 > span');
    expect(value?.textContent?.trim()).toBe('$ 1.3m');
    expect(value?.getAttribute('title')).toBe('$ 1,250,000.00');
  });

  it('abrevia tambien las cantidades y respeta el texto de valor', () => {
    const root = render(
      [
        { label: 'Sal', value: 25_000 },
        { label: 'Azúcar', value: 25_000, valueText: 'Bs 25,000.00' },
      ],
      false,
    );

    const [row, custom] = Array.from(
      root.querySelectorAll<HTMLElement>('span.shrink-0 > span'),
    );

    expect(row.textContent?.trim()).toBe('25k');
    expect(row.getAttribute('title')).toBe('25,000');
    expect(custom.textContent?.trim()).toBe('Bs 25,000.00');
    expect(custom.hasAttribute('title')).toBe(false);
  });

  it('deja intactos los valores que ya caben', () => {
    const root = render([{ label: 'Azúcar', value: 9_999 }]);

    expect(root.querySelector<HTMLElement>('span.shrink-0 > span')?.textContent?.trim()).toBe(
      '$ 9,999.00',
    );
    expect(
      root.querySelector<HTMLElement>('span.shrink-0 > span')?.hasAttribute('title'),
    ).toBe(false);
  });

  it('deja las barras en cero cuando no hay valores', () => {
    const root = render([
      { label: 'Uno', value: 0 },
      { label: 'Dos', value: Number.NaN },
    ]);

    expect(widths(root)).toEqual(['0%', '0%']);
  });
});
