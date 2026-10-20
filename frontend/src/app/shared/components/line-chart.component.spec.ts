import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { CHART_COLORS } from '../../core/constants/chart';
import { setDisplayCurrency } from '../../core/utils/format';
import { LineChartComponent } from './line-chart.component';
import type { LineSeries } from './line-chart.component';

/** Grafica de lineas: escala, marcas del eje, areas y tooltips por periodo. */
describe('LineChartComponent (tendencia)', () => {
  let fixture: ComponentFixture<LineChartComponent>;
  let component: LineChartComponent;

  beforeEach(async () => {
    // La moneda visible es estado global de `format.ts`: otra prueba pudo dejarla
    // en bolívares y estas marcas se esperan en dólares.
    setDisplayCurrency(null);
    await TestBed.configureTestingModule({ imports: [LineChartComponent] }).compileComponents();
    fixture = TestBed.createComponent(LineChartComponent);
    component = fixture.componentInstance;
  });

  /** Monta la grafica con las etiquetas y series indicadas. */
  function render(labels: string[], series: LineSeries[], isCurrency = true): HTMLElement {
    component.labels = labels;
    component.series = series;
    component.isCurrency = isCurrency;
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const ventas = (values: number[]): LineSeries => ({
    label: 'Ventas',
    color: CHART_COLORS.brand,
    values,
  });

  it('proyecta la linea y el area sobre el lienzo de la grafica', () => {
    const root = render(['1 oct', '2 oct', '3 oct'], [ventas([0, 55, 110])]);

    // El techo de la escala es 120 (110 + 6% de aire redondeado), de ahi que el
    // punto mas alto quede en y=8.333 y no pegado al borde superior.
    expect(root.querySelector('polyline')?.getAttribute('points')).toBe(
      '0,100 50,54.167 100,8.333',
    );
    expect(root.querySelector('polygon')?.getAttribute('points')).toBe(
      '0,100 0,100 50,54.167 100,8.333 100,100',
    );
  });

  it('escala el eje vertical con el techo redondeado y sus marcas', () => {
    const root = render(['1 oct', '2 oct'], [ventas([0, 100])]);

    expect(component.ticks).toEqual([
      { position: 100, text: '$ 0.00' },
      { position: 50, text: '$ 55.00' },
      { position: 0, text: '$ 110.00' },
    ]);
    expect(root.textContent).toContain('$ 110.00');
    expect(root.textContent).toContain('$ 55.00');
  });

  it('deja sitio para las series con valores negativos', () => {
    const serie: LineSeries = {
      label: 'Utilidad',
      color: CHART_COLORS.emerald,
      values: [-110, 0],
    };

    render(['1 oct', '2 oct'], [serie]);

    expect(component.ticks[0]).toEqual({ position: 100, text: '$ -120.00' });
    expect(component.ticks[2]).toEqual({ position: 0, text: '$ 7.00' });
  });

  it('espacia las etiquetas del eje horizontal cuando hay muchos periodos', () => {
    const labels = Array.from({ length: 12 }, (_item, index) => `d${index + 1}`);
    render(labels, [ventas(labels.map((_label, index) => index))]);

    expect(component.axisLabels).toEqual([
      'd1',
      '',
      'd3',
      '',
      'd5',
      '',
      'd7',
      '',
      'd9',
      '',
      'd11',
      '',
    ]);
  });

  it('formatea los valores del tooltip y deja un guion fuera de rango', () => {
    const root = render(['1 oct', '2 oct'], [ventas([10, 20])]);

    expect(component.valueAt(component.series[0], 1)).toBe('$ 20.00');
    expect(component.valueAt(component.series[0], 9)).toBe('—');
    expect(root.textContent).toContain('Ventas');
  });

  it('usa cantidades cuando los valores no son montos', () => {
    render(['1 oct', '2 oct'], [ventas([12, 24])], false);

    expect(component.valueAt(component.series[0], 0)).toBe('12.00');
  });

  it('abrevia las marcas del eje cuando el monto no cabe en la columna', () => {
    render(['1 oct', '2 oct'], [ventas([0, 1_250_000])]);

    expect(component.ticks).toEqual([
      { position: 100, text: '$ 0.00' },
      { position: 50, text: '$ 700k' },
      { position: 0, text: '$ 1.4m' },
    ]);
    // El tooltip del periodo conserva el valor exacto.
    expect(component.valueAt(component.series[0], 1)).toBe('$ 1,250,000.00');
  });

  it('no dibuja nada cuando no hay series', () => {
    const root = render([], []);

    expect(root.querySelectorAll('polyline').length).toBe(0);
    expect(root.querySelectorAll('polygon').length).toBe(0);
  });
});
