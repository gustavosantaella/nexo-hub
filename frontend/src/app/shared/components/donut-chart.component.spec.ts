import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { CHART_COLORS } from '../../core/constants/chart';
import { DonutChartComponent } from './donut-chart.component';
import type { DonutSlice } from './donut-chart.component';

/** Anillo de composicion: reparto, huecos, colores y datos del centro. */
describe('DonutChartComponent (anillo de composicion)', () => {
  let fixture: ComponentFixture<DonutChartComponent>;
  let component: DonutChartComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [DonutChartComponent] }).compileComponents();
    fixture = TestBed.createComponent(DonutChartComponent);
    component = fixture.componentInstance;
  });

  /** Monta el anillo con las porciones indicadas. */
  function render(slices: DonutSlice[], isCurrency = true): HTMLElement {
    component.slices = slices;
    component.isCurrency = isCurrency;
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  /** Porciones del anillo (la primera circunferencia es el riel de fondo). */
  function arcs(root: HTMLElement): SVGCircleElement[] {
    return Array.from(root.querySelectorAll<SVGCircleElement>('svg circle')).slice(1);
  }

  it('reparte el anillo por porcentajes y separa las porciones', () => {
    const root = render([
      { label: 'Efectivo', value: 100, color: CHART_COLORS.emerald },
      { label: 'Tarjeta', value: 50, color: CHART_COLORS.brand },
      { label: 'Pago móvil', value: 50, color: CHART_COLORS.sky },
    ]);

    const [first, second, third] = arcs(root);

    expect(arcs(root).length).toBe(3);
    expect(first.getAttribute('stroke-dasharray')).toBe('49.2 50.8');
    expect(first.getAttribute('stroke-dashoffset')).toBe('0');
    expect(second.getAttribute('stroke-dasharray')).toBe('24.2 75.8');
    expect(second.getAttribute('stroke-dashoffset')).toBe('-50');
    expect(third.getAttribute('stroke-dashoffset')).toBe('-75');
    expect(first.getAttribute('pathLength')).toBe('100');
  });

  it('no parte las porciones muy finas (se verian invisibles)', () => {
    render([
      { label: 'Caja', value: 99, color: CHART_COLORS.brand },
      { label: 'Otros', value: 1, color: CHART_COLORS.slate },
    ]);

    const [, thin] = arcs(fixture.nativeElement);

    expect(thin.getAttribute('stroke-dasharray')).toBe('1 99');
  });

  it('pinta cada porcion con el trazo de su tono y su tooltip de valor', () => {
    render(
      [
        { label: 'Caja', value: 60, color: CHART_COLORS.emerald },
        { label: 'Tarjeta', value: 40, color: CHART_COLORS.brand },
      ],
      false,
    );

    const [first, second] = arcs(fixture.nativeElement);

    expect(first.classList).toContain('text-emerald-500');
    expect(second.classList).toContain('text-brand-500');
    expect(first.querySelector('title')?.textContent).toBe('Caja: 60 (60.0%)');
  });

  it('muestra el dato central y el pie de foto cuando se indican', () => {
    component.centerLabel = 'Mayor';
    component.centerValue = '60.0 %';
    component.centerHint = 'Caja';
    component.caption = '2 métodos';
    const root = render([{ label: 'Caja', value: 60, color: CHART_COLORS.emerald }]);

    expect(root.textContent).toContain('Mayor');
    expect(root.textContent).toContain('60.0 %');
    expect(root.textContent).toContain('Caja');
    expect(root.textContent).toContain('2 métodos');
  });

  it('deja solo el riel cuando no hay datos', () => {
    const root = render([]);

    expect(arcs(root).length).toBe(0);
    expect(root.querySelectorAll('svg circle').length).toBe(1);
  });
});
