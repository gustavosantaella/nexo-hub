import {
  ChangeDetectionStrategy,
  Component,
  Input,
  booleanAttribute,
  inject,
} from '@angular/core';
import { RatesService } from '../../core/services/rates.service';
import type { RateConversion } from '../../core/models/rates.model';
import { bsCompact, money, moneyCompact, moneyInCompact } from '../../core/utils/format';

/**
 * Monto del sistema (moneda base, USD) con su equivalente "al cambio".
 *
 * El monto se muestra en la moneda base elegida en Configuración → Tasas (USD
 * por defecto) y debajo van las conversiones.
 * Muestra el monto y, debajo, una línea con cada tasa activa:
 *   - 2 tasas cuando el local no definió una personalizada (BCV $ y BCV €).
 *   - 3 tasas cuando existe la personalizada.
 *
 * El interruptor global (`RatesService.showConversions`, visible en
 * Configuración) permite ocultar las conversiones sin perder las tasas.
 */
@Component({
  selector: 'app-money',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.items-end]': 'alignEnd' },
  styles: [
    ':host { display: inline-flex; flex-direction: column; align-items: flex-start; max-width: 100%; }',
    ':host(.items-end) { align-items: flex-end; }',
  ],
  template: `
    @if (!hideBase) {
      <span class="whitespace-nowrap" [class.font-semibold]="strong" [attr.title]="baseTitle">
        {{ base }}
      </span>
    }
    @if (showConversions() && conversions.length > 0) {
      <span
        class="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] font-normal leading-tight text-slate-400"
        [class.justify-end]="alignEnd"
      >
        @for (item of conversions; track item.key) {
          <span class="whitespace-nowrap" [title]="item.label + ' · ' + item.rate">
            {{ item.label }} {{ item.text }}
          </span>
        }
      </span>
    }
  `,
})
export class MoneyComponent {
  private readonly rates = inject(RatesService);

  /** Monto guardado en la moneda base contable (USD). */
  @Input({ required: true }) amount: number | null | undefined = 0;
  /** Resalta el monto base (cabeceras de tabla, totales). */
  @Input({ transform: booleanAttribute }) strong = false;
  /** Alinea la conversión a la derecha (columnas numéricas). */
  @Input({ transform: booleanAttribute }) alignEnd = false;
  /** Oculta el monto base y deja solo la conversión. */
  @Input({ transform: booleanAttribute }) hideBase = false;
  /** Abrevia el monto cuando no cabe (1 250 000 → `$ 1.3m`); el exacto queda en el tooltip. */
  @Input({ transform: booleanAttribute }) compact = false;

  readonly showConversions = this.rates.showConversions;

  get base(): string {
    return this.compact ? moneyCompact(this.amount) : money(this.amount);
  }

  /** Monto exacto (tooltip) cuando el visible va abreviado. */
  get baseTitle(): string | null {
    return this.compact ? money(this.amount) : null;
  }

  /**
   * Conversiones del monto: con la moneda base en dólares, el equivalente en
   * bolívares de cada tasa activa; con otra moneda base, cada moneda aceptada.
   * En modo compacto también se abrevian.
   */
  get conversions(): RateConversion[] {
    const byRate = !this.rates.convertsBase();
    const items = byRate
      ? this.rates.conversions(this.amount)
      : this.rates.currencyConversions(this.amount);
    if (!this.compact) return items;
    return items.map((item) => ({
      ...item,
      text: byRate
        ? bsCompact(item.amount)
        : moneyInCompact(item.amount, item.code),
    }));
  }
}
