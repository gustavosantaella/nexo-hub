import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import type { ChartColor } from '../../core/constants/chart';
import { money, number } from '../../core/utils/format';

/** Fila del ranking: barra proporcional con valor, detalle y marca opcional. */
export interface BarRow {
  label: string;
  value: number;
  /** Texto del valor cuando no se pinta un monto en moneda base (ej. "Bs 5,000.00"). */
  valueText?: string;
  /** Dato adicional tras el valor (ej. "12 cobros", "24 unidades"). */
  caption?: string;
  /**
   * Posicion sobre la barra para comparar un umbral (ej. el stock minimo del
   * producto). Se tiene en cuenta para calcular la escala.
   */
  marker?: number;
  /** Etiqueta de la marca cuando la fila no define una propia. */
  markerLabel?: string;
  /** Tono de la barra (por defecto el tono primario de la marca). */
  color?: ChartColor;
}

/**
 * Ranking de barras horizontales (SVG-free, sin dependencias externas).
 *
 * Sustituye a las filas "etiqueta + barra + monto" repetidas en reportes y
 * agrega la comparacion contra un umbral (`marker`) para casos como el stock
 * bajo (existencias vs. minimo).
 */
@Component({
  selector: 'app-bar-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-3">
      @for (row of rows; track row.label) {
        <div>
          <div class="flex items-baseline justify-between gap-3 text-xs">
            <span class="truncate font-medium text-slate-700" [title]="row.label">{{ row.label }}</span>
            <span class="shrink-0 whitespace-nowrap">
              <span class="font-medium text-slate-700">{{ valueOf(row) }}</span>
              @if (row.caption) {
                <span class="text-slate-400"> · {{ row.caption }}</span>
              }
            </span>
          </div>
          <div class="relative mt-1 h-2 w-full rounded-full bg-slate-100">
            <div
              class="h-full rounded-full transition-[width] duration-300"
              [class]="row.color?.fill ?? 'bg-brand-500'"
              [style.width.%]="widthOf(row.value)"
            ></div>
            @if (row.marker !== undefined) {
              <span
                class="absolute -top-0.5 h-3 w-0.5 rounded-full bg-slate-500"
                [style.left.%]="widthOf(row.marker)"
                [attr.title]="markerOf(row)"
              ></span>
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class BarListComponent {
  /** Filas del ranking (se pintan en el orden recibido). */
  @Input() rows: BarRow[] = [];
  /** Los valores son montos: se formatean como moneda base. */
  @Input() isCurrency = true;
  /** Etiqueta de la marca cuando la fila no define una propia. */
  @Input() markerLabel = 'Umbral';

  /** Escala comun de las barras (incluye las marcas de umbral). */
  get max(): number {
    const values = this.rows.flatMap((row) =>
      row.marker === undefined ? [this.numberOf(row.value)] : [this.numberOf(row.value), this.numberOf(row.marker)],
    );
    return Math.max(1, ...values);
  }

  /** Ancho de la barra (o posicion de la marca) en % de la escala. */
  widthOf(value: number | undefined): number {
    const ratio = this.numberOf(value) / this.max;
    return Math.round(Math.min(1, ratio) * 100);
  }

  /** Texto del valor de la fila. */
  valueOf(row: BarRow): string {
    if (row.valueText) return row.valueText;
    return this.isCurrency ? money(row.value) : number(row.value);
  }

  /** Tooltip de la marca de umbral. */
  markerOf(row: BarRow): string {
    const label = row.markerLabel ?? this.markerLabel;
    const value = this.numberOf(row.marker);
    return `${label}: ${this.isCurrency ? money(value) : number(value)}`;
  }

  private numberOf(value: number | undefined): number {
    const amount = Number(value);
    return Number.isFinite(amount) && amount > 0 ? amount : 0;
  }
}
