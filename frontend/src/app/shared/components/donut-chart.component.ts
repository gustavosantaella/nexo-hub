import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import type { ChartColor } from '../../core/constants/chart';
import { money, number } from '../../core/utils/format';

/** Porcion del anillo: etiqueta, valor y tono de la paleta. */
export interface DonutSlice {
  label: string;
  value: number;
  color: ChartColor;
}

/** Porcion ya proyectada sobre el anillo (`pathLength = 100`). */
interface DonutArc {
  label: string;
  stroke: string;
  dash: string;
  offset: number;
  title: string;
}

/**
 * Radio del anillo: con `pathLength="100"` la circunferencia se normaliza, asi
 * que los porcentajes de las porciones se leen directamente en el guion.
 */
const RADIUS = 15.9155;

/** Separacion entre porciones (en % del anillo; se omite en la mas fina). */
const GAP = 0.8;

/**
 * Grafico de anillo (SVG, sin dependencias externas) para composiciones:
 * metodos de pago, monedas, categorias, etc.
 *
 * El anillo es decorativo: la leyenda con los numeros exactos la pinta la
 * pantalla que lo usa (por ejemplo con `app-bar-list`), que tambien es la que
 * alimenta la lectura accesible de los datos.
 */
@Component({
  selector: 'app-donut-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <figure class="flex flex-col items-center gap-3">
      <div class="relative shrink-0" [class]="size">
        <svg viewBox="0 0 42 42" class="h-full w-full -rotate-90" aria-hidden="true" focusable="false">
          <circle
            cx="21"
            cy="21"
            [attr.r]="radius"
            fill="none"
            stroke="currentColor"
            stroke-width="5.5"
            class="text-slate-200"
          />
          @for (arc of arcs; track arc.label) {
            <circle
              cx="21"
              cy="21"
              [attr.r]="radius"
              fill="none"
              stroke="currentColor"
              stroke-width="5.5"
              pathLength="100"
              [class]="arc.stroke"
              [attr.stroke-dasharray]="arc.dash"
              [attr.stroke-dashoffset]="arc.offset"
            >
              <title>{{ arc.title }}</title>
            </circle>
          }
        </svg>
        <div
          class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-2 text-center"
        >
          <span class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            {{ centerLabel }}
          </span>
          @if (centerValue) {
            <span class="text-sm font-semibold leading-tight text-slate-900">{{ centerValue }}</span>
          }
          @if (centerHint) {
            <span class="max-w-full truncate text-[10px] text-slate-400">{{ centerHint }}</span>
          }
        </div>
      </div>
      @if (caption) {
        <figcaption class="text-xs text-slate-500">{{ caption }}</figcaption>
      }
    </figure>
  `,
})
export class DonutChartComponent {
  /** Porciones del anillo (se dibujan en el orden recibido). */
  @Input() slices: DonutSlice[] = [];
  /** Texto pequeno sobre el dato central (ej. "Mayor"). */
  @Input() centerLabel = 'Total';
  /** Dato central ya formateado (ej. "42,5 %", "$ 3,200.00"). */
  @Input() centerValue = '';
  /** Aclaracion bajo el dato central (ej. "Efectivo"). */
  @Input() centerHint?: string;
  /** Texto bajo el anillo. */
  @Input() caption?: string;
  /** Tamanio del anillo (clases de ancho y alto). */
  @Input() size = 'h-40 w-40';
  /** Los valores son montos: se formatean como moneda base. */
  @Input() isCurrency = true;

  readonly radius = RADIUS;

  /** Suma de las porciones (siempre positiva). */
  get total(): number {
    return this.slices.reduce((acc, slice) => acc + this.valueOf(slice), 0);
  }

  /** Porciones listas para el SVG: guion, desplazamiento y tooltip. */
  get arcs(): DonutArc[] {
    const total = this.total;
    if (total <= 0) return [];

    const gap = this.slices.length > 1 ? GAP : 0;
    let offset = 0;

    return this.slices.map((slice) => {
      const percent = (this.valueOf(slice) / total) * 100;
      // Solo se abre el hueco cuando la porcion es ancha: en las muy finas
      // (menos del doble del hueco) se pintaria invisible.
      const dash = percent > gap * 2 ? percent - gap : percent;
      const arc: DonutArc = {
        label: slice.label,
        stroke: slice.color.stroke,
        dash: `${this.round(dash)} ${this.round(100 - dash)}`,
        offset: -this.round(offset),
        title: `${slice.label}: ${this.format(slice.value)} (${percent.toFixed(1)}%)`,
      };
      offset += percent;
      return arc;
    });
  }

  private valueOf(slice: DonutSlice): number {
    return Math.max(0, Number(slice.value) || 0);
  }

  private format(value: number): string {
    return this.isCurrency ? money(value) : number(value);
  }

  private round(value: number): number {
    return Math.round(value * 1000) / 1000;
  }
}
