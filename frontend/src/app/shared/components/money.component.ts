import {
  ChangeDetectionStrategy,
  Component,
  Input,
  booleanAttribute,
  inject,
} from '@angular/core';
import { RatesService } from '../../core/services/rates.service';
import type { RateConversion } from '../../core/models/rates.model';
import { LOCAL_CURRENCY_CODE } from '../../core/constants/currency';
import {
  bs,
  bsCompact,
  money,
  moneyCompact,
  moneyInCompact,
  moneyLoaded,
  moneyLoadedCompact,
} from '../../core/utils/format';

/**
 * Monto del sistema (moneda base, USD) con su equivalente "al cambio".
 *
 * El monto se muestra en la moneda base elegida en Configuración → Tasas (USD
 * por defecto) y debajo van las conversiones.
 * Muestra el monto y, debajo, una línea con cada tasa activa:
 *   - 2 tasas cuando el local no definió una personalizada (BCV $ y BCV €).
 *   - 3 tasas cuando existe la personalizada.
 *
 * Con la moneda base en otra moneda (por ejemplo el bolívar) la línea de abajo
 * lista las demás monedas aceptadas y **de dónde sale su tasa**, para que el
 * dólar del BCV no se confunda con el personalizado del local ni con una moneda
 * de tasa manual: `USD · BCV $ 10.00`, `COP · manual COL$ 39,854.44`.
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
  /**
   * Monto tal como lo escribió el operador cuando el registro lo guarda
   * (`priceEntered`, `unitPriceEntered`, …). Con la moneda de visualización en la
   * MISMA moneda en la que se cargó, se muestra tal cual: Bs 350,00 y no el
   * redondeo a centavos de dólar del equivalente guardado (349,20).
   */
  @Input() entered: number | null | undefined = null;
  /** Moneda en la que se cargó `entered` (`priceCurrency`, `unitPriceCurrency`, …). */
  @Input() currency: string | null | undefined = null;
  /** Tasa elegida al cargar `entered`, para mostrar esa misma conversión "al cambio". */
  @Input() rateKey: string | null | undefined = null;

  readonly showConversions = this.rates.showConversions;

  get base(): string {
    const loaded = this.compact
      ? moneyLoadedCompact(this.entered, this.currency)
      : moneyLoaded(this.entered, this.currency);
    if (loaded) return loaded;
    return this.compact ? moneyCompact(this.amount) : money(this.amount);
  }

  /** Monto exacto (tooltip) cuando el visible va abreviado. */
  get baseTitle(): string | null {
    if (!this.compact) return null;
    // Con el monto cargado visible, el exacto es el que escribió el operador.
    return moneyLoaded(this.entered, this.currency) ?? money(this.amount);
  }

  /**
   * Conversiones del monto: con la moneda base en dólares, el equivalente en
   * bolívares de cada tasa activa; con otra moneda base, cada moneda aceptada con
   * el origen de su tasa (`USD · BCV`, `USD · personalizada`, `COP · manual`).
   * En modo compacto también se abrevian.
   */
  get conversions(): RateConversion[] {
    const byRate = !this.rates.convertsBase();
    const items = byRate
      ? this.rates.conversions(this.amount)
      : this.rates.currencyConversions(this.amount);
    const exact = this.loadedRate;
    const resolved = exact
      ? items.map((item) =>
          item.key === exact.key
            ? { ...item, amount: exact.amount, text: bs(exact.amount) }
            : item,
        )
      : items;
    if (!this.compact) return resolved;
    return resolved.map((item) => ({
      ...item,
      text: byRate
        ? bsCompact(item.amount)
        : moneyInCompact(item.amount, item.code),
    }));
  }

  /**
   * Conversión "al cambio" tal como se cargó: el monto escrito en bolívares con
   * una tasa del sistema vale exactamente eso en esa tasa, no el resultado de
   * volver a convertir el valor guardado en USD. `null` cuando no aplica.
   */
  private get loadedRate(): { amount: number; key: string } | null {
    const amount = Number(this.entered ?? 0);
    const key = String(this.rateKey ?? '').trim();
    if (!key || !Number.isFinite(amount) || amount <= 0) return null;
    const code = String(this.currency ?? '').trim().toUpperCase();
    return code === LOCAL_CURRENCY_CODE ? { amount, key } : null;
  }
}
