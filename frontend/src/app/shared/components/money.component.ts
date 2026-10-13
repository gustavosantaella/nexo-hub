import {
  ChangeDetectionStrategy,
  Component,
  Input,
  booleanAttribute,
  inject,
} from '@angular/core';
import { RatesService } from '../../core/services/rates.service';
import { money } from '../../core/utils/format';

/**
 * Monto del sistema (moneda base, USD) con su equivalente "al cambio".
 *
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
      <span class="whitespace-nowrap" [class.font-semibold]="strong">{{ base }}</span>
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

  /** Monto en moneda base (USD). */
  @Input({ required: true }) amount: number | null | undefined = 0;
  /** Resalta el monto base (cabeceras de tabla, totales). */
  @Input({ transform: booleanAttribute }) strong = false;
  /** Alinea la conversión a la derecha (columnas numéricas). */
  @Input({ transform: booleanAttribute }) alignEnd = false;
  /** Oculta el monto base y deja solo la conversión. */
  @Input({ transform: booleanAttribute }) hideBase = false;

  readonly showConversions = this.rates.showConversions;

  get base(): string {
    return money(this.amount);
  }

  get conversions() {
    return this.rates.conversions(this.amount);
  }
}
