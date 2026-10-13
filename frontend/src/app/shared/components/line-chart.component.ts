import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import type { ChartColor } from '../../core/constants/chart';
import { compact, isCompact, money, moneyCompact, number } from '../../core/utils/format';

/** Serie de la grafica de lineas: etiqueta, tono y un valor por periodo. */
export interface LineSeries {
  label: string;
  color: ChartColor;
  values: number[];
}

/** Marca del eje vertical. */
interface ChartTick {
  position: number;
  text: string;
}

/**
 * El SVG se dibuja en un lienzo de 100 x 100 que se estira sobre el contenedor
 * (`preserveAspectRatio="none"`). Los trazos usan `vector-effect:
 * non-scaling-stroke` para no engordar al estirarse.
 */
const SIZE = 100;

/** Aire de respiro arriba y abajo para que la linea no toque el borde. */
const HEADROOM = 0.06;

/** Maximo de etiquetas del eje horizontal (las demas se dejan en blanco). */
const MAX_AXIS_LABELS = 10;

/**
 * Grafico de lineas multi-serie (SVG, sin dependencias externas).
 *
 * Pensado para tendencias comparables (ventas, cobros, utilidad): cada serie
 * pinta su area translucida y su linea, el eje vertical muestra la escala y al
 * pasar el raton por un periodo se ven los valores exactos de todas las series.
 */
@Component({
  selector: 'app-line-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="w-full">
      <div class="flex gap-2">
        <div class="relative h-48 w-16 shrink-0 text-right text-[10px] leading-none text-slate-400">
          @for (tick of ticks; track tick.position) {
            <span class="absolute right-1 -translate-y-1/2" [style.top.%]="tick.position">
              {{ tick.text }}
            </span>
          }
        </div>
        <div class="w-full min-w-0">
          <div class="relative h-48 w-full">
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              class="absolute inset-0 h-full w-full"
              aria-hidden="true"
              focusable="false"
            >
              @for (tick of ticks; track tick.position) {
                <line
                  x1="0"
                  x2="100"
                  [attr.y1]="tick.position"
                  [attr.y2]="tick.position"
                  stroke="currentColor"
                  stroke-width="1"
                  stroke-opacity="0.7"
                  vector-effect="non-scaling-stroke"
                  class="text-slate-200"
                />
              }
              @for (serie of series; track serie.label) {
                @if (serie.values.length > 1) {
                  <polygon [attr.points]="areaOf(serie)" [class]="serie.color.area" stroke="none" />
                }
                <polyline
                  [attr.points]="lineOf(serie)"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linejoin="round"
                  stroke-linecap="round"
                  vector-effect="non-scaling-stroke"
                  [class]="serie.color.stroke"
                />
              }
            </svg>
            <!-- Columnas de hover: muestran los valores del periodo senalado. -->
            <div class="absolute inset-0 flex">
              @for (label of labels; track $index; let i = $index) {
                <div class="group relative flex-1 transition-colors hover:bg-slate-100">
                  <span
                    class="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <span
                      class="mt-1 block w-max rounded-lg border border-slate-200 bg-white/95 px-2 py-1 text-[10px] shadow-card backdrop-blur"
                    >
                      <span class="block font-semibold text-slate-700">{{ label }}</span>
                      @for (serie of series; track serie.label) {
                        <span class="mt-0.5 flex items-center gap-1.5 text-slate-600">
                          <span
                            class="h-1.5 w-1.5 shrink-0 rounded-full"
                            [class]="serie.color.fill"
                          ></span>
                          <span>{{ serie.label }}</span>
                          <span class="ml-1 font-medium text-slate-800">{{ valueAt(serie, i) }}</span>
                        </span>
                      }
                    </span>
                  </span>
                </div>
              }
            </div>
          </div>
          <div class="mt-2 flex gap-2 text-center">
            @for (label of axisLabels; track $index) {
              <span class="flex-1 truncate text-[11px] text-slate-500">{{ label }}</span>
            }
          </div>
        </div>
      </div>
    </div>
  `,
})
export class LineChartComponent {
  /** Etiquetas del eje horizontal (una por periodo). */
  @Input() labels: string[] = [];
  /** Series a dibujar (todas comparten los periodos). */
  @Input() series: LineSeries[] = [];
  /** Los valores son montos: se formatean como moneda base. */
  @Input() isCurrency = true;

  readonly width = SIZE;
  readonly height = SIZE;

  /** Marcas del eje vertical: inferior, media y superior. */
  get ticks(): ChartTick[] {
    const { min, max } = this.bounds;
    return [min, (min + max) / 2, max].map((value) => ({
      position: this.yOf(value),
      text: this.formatTick(value),
    }));
  }

  /** Etiquetas del eje horizontal espaciadas cuando hay muchos periodos. */
  get axisLabels(): string[] {
    const count = this.labels.length;
    if (count === 0) return [];
    const step = Math.ceil(count / MAX_AXIS_LABELS);
    return this.labels.map((label, index) => (index % step === 0 ? label : ''));
  }

  /** Puntos de una serie para el `<polyline>`. */
  lineOf(serie: LineSeries): string {
    return serie.values.map((value, index) => this.pointOf(index, value)).join(' ');
  }

  /** Puntos de una serie cerrados contra la linea base para el `<polygon>`. */
  areaOf(serie: LineSeries): string {
    if (serie.values.length < 2) return '';
    const points = serie.values.map((value, index) => this.pointOf(index, value));
    const baseline = this.yOf(0);
    return `${this.xOf(0)},${baseline} ${points.join(' ')} ${this.xOf(serie.values.length - 1)},${baseline}`;
  }

  /** Valor formateado de una serie en un periodo (se usa en los tooltips). */
  valueAt(serie: LineSeries, index: number): string {
    const value = serie.values[index];
    if (value === undefined || !Number.isFinite(value)) return '—';
    return this.format(value);
  }

  /** Periodos que abarca el eje horizontal. */
  private get steps(): number {
    const lengths = this.series.map((serie) => serie.values.length);
    return Math.max(1, this.labels.length, ...lengths);
  }

  /** Dominio vertical: incluye el cero y redondea el techo de la escala. */
  private get bounds(): { min: number; max: number } {
    const values = this.series.flatMap((serie) =>
      serie.values.filter((value) => Number.isFinite(value)),
    );
    const rawMin = Math.min(0, ...values);
    const rawMax = Math.max(0, ...values);
    if (!(rawMax > rawMin)) return { min: 0, max: 1 };

    const pad = (rawMax - rawMin) * HEADROOM;
    const min = rawMin < 0 ? -this.scaleCeiling(-rawMin + pad) : 0;
    const max = this.scaleCeiling(rawMax + pad);
    return { min, max: max > min ? max : min + 1 };
  }

  /** Techo de la escala con dos cifras significativas (876.8 → 880, 1234 → 1300). */
  private scaleCeiling(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return 0;
    const magnitude = Math.pow(10, Math.max(0, Math.floor(Math.log10(value)) - 1));
    return Math.ceil(value / magnitude) * magnitude;
  }

  private xOf(index: number): number {
    const count = this.steps;
    if (count <= 1) return this.round(SIZE / 2);
    return this.round((index / (count - 1)) * SIZE);
  }

  private yOf(value: number): number {
    const { min, max } = this.bounds;
    const span = max - min || 1;
    const ratio = ((Number(value) || 0) - min) / span;
    return this.round(SIZE - Math.min(1, Math.max(0, ratio)) * SIZE);
  }

  private pointOf(index: number, value: number): string {
    return `${this.xOf(index)},${this.yOf(value)}`;
  }

  private format(value: number): string {
    return this.isCurrency ? money(value) : number(value, 2);
  }

  /**
   * Texto de una marca del eje: la columna es estrecha (64 px), así que los
   * montos grandes se abrevian; los tooltips siguen mostrando el valor exacto.
   */
  private formatTick(value: number): string {
    if (!isCompact(value)) return this.format(value);
    return this.isCurrency ? moneyCompact(value) : compact(value);
  }

  private round(value: number): number {
    return Math.round(value * 1000) / 1000;
  }
}
