import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { IconComponent } from './icon.component';
import { MoneyComponent } from './money.component';

/** Tarjeta de indicador para el panel y los reportes. */
@Component({
  selector: 'app-stat-card',
  standalone: true,
  imports: [IconComponent, MoneyComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card p-5">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {{ label }}
          </p>
          @if (isCurrency) {
            <app-money
              class="mt-2 text-2xl font-semibold text-slate-900"
              [amount]="amount"
            />
          } @else {
            <p class="mt-2 text-2xl font-semibold text-slate-900">{{ value }}</p>
          }
          @if (hint) {
            <p class="mt-1 text-xs text-slate-500">{{ hint }}</p>
          }
        </div>
        <span
          class="flex h-10 w-10 items-center justify-center rounded-xl"
          [class]="toneClasses"
        >
          <app-icon [name]="icon" size="h-5 w-5" />
        </span>
      </div>
    </div>
  `,
})
export class StatCardComponent {
  @Input({ required: true }) label = '';
  @Input({ required: true }) value: string | number = '';
  @Input() hint?: string;
  @Input() icon = 'chart';
  @Input() tone: 'brand' | 'emerald' | 'amber' | 'rose' | 'sky' | 'slate' = 'brand';
  @Input() isCurrency = false;

  /** Monto (moneda base) que se pinta con su equivalente "al cambio". */
  get amount(): number {
    return Number(this.value) || 0;
  }

  get toneClasses(): string {
    const tones: Record<string, string> = {
      brand: 'bg-brand-50 text-brand-700',
      emerald: 'bg-emerald-50 text-emerald-700',
      amber: 'bg-amber-50 text-amber-700',
      rose: 'bg-rose-50 text-rose-700',
      sky: 'bg-sky-50 text-sky-700',
      slate: 'bg-slate-100 text-slate-600',
    };
    return tones[this.tone] ?? tones['brand'];
  }
}
