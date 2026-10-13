import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { money } from '../../core/utils/format';

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
  template: `
    <div class="w-full">
      <div class="flex h-48 items-end gap-2 overflow-hidden">
        @for (point of points; track point.label) {
          <div class="group flex h-full flex-1 flex-col items-center justify-end gap-1">
            <span class="text-[10px] font-medium text-slate-500 opacity-0 transition group-hover:opacity-100">
              {{ isCurrency ? money(point.value) : point.value }}
            </span>
            <div
              class="w-full rounded-t-md bg-brand-500/80 transition group-hover:bg-brand-600"
              [style.height.%]="heightOf(point.value)"
              [title]="point.label + ': ' + (isCurrency ? money(point.value) : point.value)"
            ></div>
            @if (point.secondary !== undefined) {
              <div
                class="w-full rounded-t-md bg-rose-400/80"
                [style.height.%]="heightOf(point.secondary)"
                [title]="'Secundario: ' + money(point.secondary)"
              ></div>
            }
          </div>
        }
      </div>
      <div class="mt-2 flex gap-2 text-center">
        @for (point of points; track point.label) {
          <span class="flex-1 truncate text-[11px] text-slate-500">{{ point.label }}</span>
        }
      </div>
    </div>
  `,
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

  get money(): (value: number) => string {
    return money;
  }
}
