import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';
import {
  BASE_CURRENCY_CODE,
  LOCAL_CURRENCY_CODE,
  RATE_META,
} from '../../core/constants/currency';
import type { RateKey } from '../../core/models/rates.model';
import { RatesService } from '../../core/services/rates.service';
import { bs, moneyIn } from '../../core/utils/format';

/** Una tasa con el monto ya convertido. */
interface ConversionLine {
  /** Etiqueta corta de la tasa ("BCV $", "BCV €", "Personalizada"). */
  label: string;
  /** Monto convertido y formateado (Bs o USD). */
  text: string;
  /** `true` para la tasa elegida en el campo (la que se guardara). */
  selected: boolean;
}

/**
 * Conversiones de un monto a las tasas del sistema (BCV dolar, BCV euro y la
 * personalizada del local cuando existe).
 *
 * Se usa debajo de los campos de precio para ver "como queda" el monto que se
 * esta escribiendo sin cambiar de moneda:
 *
 *   - Monto en USD  -> su equivalente en bolivares con cada tasa.
 *   - Monto en VES  -> su equivalente en USD con cada tasa.
 *   - Otra moneda   -> su equivalente en USD y en bolivares con la tasa activa.
 *
 * Con `rateKey` (el campo permite elegir tasa) la linea de la tasa elegida se
 * resalta: es con la que se calculara el monto al guardar.
 */
@Component({
  selector: 'app-rate-conversions',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (lines().length) {
      <div class="mt-1 flex flex-wrap gap-1.5 text-[11px] text-slate-500">
        @for (line of lines(); track line.label) {
          <span
            class="rounded px-1.5 py-0.5"
            [class.bg-slate-100]="!line.selected"
            [class.bg-slate-700]="line.selected"
            [class.font-medium]="line.selected"
            [class.text-white]="line.selected"
            [title]="line.text"
          >
            {{ line.label }}: {{ line.text }}
          </span>
        }
      </div>
    }
  `,
})
export class RateConversionsComponent {
  private readonly rates = inject(RatesService);

  /** Monto en la moneda indicada. */
  @Input() amount: number | null = null;
  /** Moneda del monto (USD por defecto). */
  @Input() currency: string | null = BASE_CURRENCY_CODE;
  /** Tasa elegida en el campo (se resalta su linea); `null` = solo informativo. */
  @Input() rateKey: RateKey | null = null;

  /** Lineas de conversion (vacio mientras faltan datos o tasas). */
  lines(): ConversionLine[] {
    const amount = Number(this.amount ?? 0);
    if (!amount) return [];

    const code = String(this.currency ?? '')
      .trim()
      .toUpperCase() || BASE_CURRENCY_CODE;

    // En USD: cuanto son esos dolares en bolivares con cada tasa.
    if (code === BASE_CURRENCY_CODE) {
      return this.rateOptions().map((option) => ({
        label: RATE_META[option.key].shortLabel,
        text: bs(amount * option.rate),
        selected: option.key === this.rateKey,
      }));
    }

    // En bolivares: cuanto son esos bolivares en dolares con cada tasa.
    if (code === LOCAL_CURRENCY_CODE) {
      return this.rateOptions().map((option) => ({
        label: RATE_META[option.key].shortLabel,
        text: moneyIn(amount / option.rate, BASE_CURRENCY_CODE),
        selected: option.key === this.rateKey,
      }));
    }

    // Otra moneda: equivalente en USD (tasa activa) y en bolivares.
    const converted = this.rates.toBase(amount, code);
    if (converted === null) return [];
    const base = this.rates.bsPerUnit(code);
    return [
      { label: '=', text: moneyIn(converted, BASE_CURRENCY_CODE), selected: false },
      ...(base
        ? [{ label: 'Bs', text: bs(amount * base), selected: false }]
        : []),
    ];
  }

  private rateOptions() {
    return this.rates.rates().filter((option) => option.rate > 0);
  }
}
