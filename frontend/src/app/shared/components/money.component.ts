import {
  ChangeDetectionStrategy,
  Component,
  Input,
  booleanAttribute,
  inject,
} from '@angular/core';
import { RatesService, BCV_USD_RATE_KEY } from '../../core/services/rates.service';
import type { RateConversion } from '../../core/models/rates.model';
import { LOCAL_CURRENCY_CODE } from '../../core/constants/currency';
import {
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
 * Con la moneda base en otra moneda (por ejemplo el bolívar) el monto base ya está
 * en bolívares, así que la línea de abajo lista **cada tasa del sistema** con el
 * equivalente **en su divisa** (`USD · BCV $ 10,33` al precio oficial del dólar,
 * `USD · personalizada $ 10,00` a la tasa del local, `EUR · BCV € 9,22`) y, además,
 * las demás monedas aceptadas cuya tasa no venga de una de esas tasas (`COP ·
 * manual COL$ 41,155.45`): sin el rótulo, el dólar del BCV se confunde con el
 * personalizado del local y con una moneda de tasa manual.
 *
 * El interruptor global (`RatesService.showConversions`, visible en
 * Configuración) permite ocultar las conversiones sin perder las tasas.
 *
 * Además, el personal de caja solo ve las monedas que el admin active en
 * Configuración → Cajero: **por defecto ninguna**, así que ve el precio en su
 * moneda y nada más. En esa misma pantalla el admin puede activar el **precio en
 * dólares del BCV** (`USD · BCV $ 10,33`), que se suma a esas líneas: con los
 * precios en bolívares son los dólares oficiales de lo cobrado y con los precios
 * en una divisa, los bolívares a esa tasa oficial. ADMIN y MANAGER siempre ven
 * todas las conversiones y su vista no cambia con esa preferencia.
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
   * bolívares de cada tasa activa; con otra moneda base, esas MISMAS tasas y las
   * demás monedas aceptadas, cada línea en la moneda de su tasa y rotulada con su
   * origen (`USD · BCV $ 10,33`, `USD · personalizada $ 10,00`, `COP · manual
   * COL$ 41,155.45`).
   * En modo compacto también se abrevian.
   */
  get conversions(): RateConversion[] {
    const byRate = !this.rates.convertsBase();
    const items = byRate
      ? this.rates.conversions(this.amount)
      : this.rates.conversionLines(this.amount);
    const exact = this.loadedRate;
    const resolved = exact
      ? items.map((item) =>
          item.key === exact.key
            ? this.rates.conversionWithBs(item, exact.amount)
            : item,
        )
      : items;
    // El personal de caja solo ve las conversiones que activó el admin
    // (Configuración → Cajero): por defecto ninguna, solo el precio en su moneda.
    // Y, si el admin lo activó, suma el precio en dólares del BCV.
    const visible = this.withBcvPrice(this.rates.visibleConversions(resolved));
    if (!this.compact) return visible;
    return visible.map((item) => ({
      ...item,
      text: item.inBs
        ? bsCompact(item.amount)
        : moneyInCompact(item.amount, item.code),
    }));
  }

  /**
   * Suma el **precio en dólares del BCV** cuando el admin lo activó en
   * Configuración → Cajero, salvo que esa línea ya venga entre las conversiones
   * (con la base en bolívares la lista de tasas ya trae el dólar del BCV).
   *
   * Los bolívares de la línea son los que escribió el operador cuando el registro
   * los guarda: así el dólar que se ve es el de los bolívares cobrados y no el del
   * equivalente redondeado a centavos.
   */
  private withBcvPrice(items: readonly RateConversion[]): RateConversion[] {
    const all = [...items];
    if (!this.rates.showBcvPrice()) return all;
    if (all.some((item) => item.key === BCV_USD_RATE_KEY)) return all;
    const line = this.rates.bcvUsdConversion(this.amount, this.loadedRate?.amount);
    return line ? [...all, line] : all;
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
