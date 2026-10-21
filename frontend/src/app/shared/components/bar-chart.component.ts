import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { compact, isCompact, money, moneyCompact, number } from '../../core/utils/format';

/** En las columnas estrechas del grafico conviene abreviar antes que en el resto. */
const BAR_COMPACT_FROM = 1_000;

export interface BarPoint {
  label: string;
  value: number;
  secondary?: number;
}

/** Grafico de barras SVG (sin dependencias externas). */
@Component({
  selector: 'app-bar-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './bar-chart.component.html',
})
export class BarChartComponent {
  @Input() points: BarPoint[] = [];
  @Input() isCurrency = true;

  get max(): number {
    const values = this.points.flatMap((p) =>
      p.secondary === undefined ? [p.value] : [p.value, p.secondary],
    );
    return Math.max(1, ...values);
  }

  heightOf(value: number): number {
    const ratio = Math.max(0, value) / this.max;
    return Math.max(ratio > 0 ? 4 : 0, Math.round(ratio * 100));
  }

  /** Texto del valor sobre la barra (abreviado: el exacto va en el tooltip). */
  valueText(value: number): string {
    const amount = Number(value) || 0;
    const abbreviated = isCompact(amount, BAR_COMPACT_FROM);
    if (this.isCurrency) return abbreviated ? moneyCompact(amount) : money(amount);
    return abbreviated ? compact(amount) : number(amount);
  }

  get money(): (value: number) => string {
    return money;
  }
}
