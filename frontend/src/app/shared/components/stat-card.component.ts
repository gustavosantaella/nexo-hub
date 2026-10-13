import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { compact, isCompact, money, number } from '../../core/utils/format';
import { IconComponent } from './icon.component';
import { MoneyComponent } from './money.component';

/**
 * En las tarjetas el ancho es muy corto (seis por fila en reportes y caja): los
 * valores se abrevian antes que en el resto de la app para no salirse.
 */
const CARD_COMPACT_FROM = 1_000;

/** Tarjeta de indicador para el panel y los reportes. */
@Component({
  selector: 'app-stat-card',
  standalone: true,
  imports: [IconComponent, MoneyComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card p-5">
      <div class="flex items-center justify-between gap-3">
        <p class="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-slate-500">
          {{ label }}
        </p>
        <span
          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          [class]="toneClasses"
        >
          <app-icon [name]="icon" size="h-5 w-5" />
        </span>
      </div>
      @if (isCurrency) {
        <app-money
          [class]="valueClasses('block')"
          [amount]="amount"
          [compact]="abbreviated"
        />
      } @else {
        <p [class]="valueClasses('')" [attr.title]="title">{{ text }}</p>
      }
      @if (hint) {
        <p class="mt-1 text-xs text-slate-500">{{ hint }}</p>
      }
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

  /** `true` si el valor se abrevia (12.5k) para no salirse de la tarjeta. */
  get abbreviated(): boolean {
    return isCompact(this.amount, CARD_COMPACT_FROM);
  }

  /** Valor cuando no es un monto (los numeros se agrupan y abrevian solos). */
  get text(): string {
    if (typeof this.value !== 'number') return String(this.value);
    return this.abbreviated ? compact(this.value) : this.exact;
  }

  /** Valor sin abreviar: se pinta como tooltip cuando el visible va abreviado. */
  get title(): string | null {
    return this.abbreviated ? this.exact : null;
  }

  /** Clases del valor: se reduce el tamano cuando el numero va abreviado. */
  valueClasses(display: string): string {
    return [
      display,
      'mt-2 overflow-hidden font-semibold text-slate-900',
      this.abbreviated ? 'text-xl' : 'text-2xl',
    ]
      .filter((part) => !!part)
      .join(' ');
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

  /** Valor formateado del numero exacto (base de la tarjeta). */
  private get exact(): string {
    if (this.isCurrency) return money(this.amount);
    return number(this.amount, Number.isInteger(this.amount) ? 0 : 2);
  }
}
