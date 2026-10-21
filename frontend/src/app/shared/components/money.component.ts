import {
  ChangeDetectionStrategy,
  Component,
  Input,
  booleanAttribute,
  inject,
} from '@angular/core';
import { RatesService, BCV_USD_RATE_KEY } from '../../core/services/rates.service';
import type { RateConversion, RateKey } from '../../core/models/rates.model';
import { LOCAL_CURRENCY_CODE } from '../../core/constants/currency';
import {
  bsCompact,
  displayBaseCode,
  money,
  moneyCompact,
  moneyIn,
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
  templateUrl: './money.component.html',
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
  /**
   * Fuerza la tasa con la que se pinta el monto base. Las ventas y la caja usan
   * `BCV_USD`: el monto guardado ya es el valor de venta en USD y debe mostrarse
   * a la tasa oficial, no con el precio de vitrina.
   */
  @Input() displayRateKey: string | null | undefined = null;

  readonly showConversions = this.rates.showConversions;

  get base(): string {
    const forced = this.displayWithRate();
    if (forced) return forced;
    const loaded = this.compact
      ? moneyLoadedCompact(this.entered, this.currency)
      : moneyLoaded(this.entered, this.currency);
    if (loaded) return loaded;
    return this.compact ? moneyCompact(this.amount) : money(this.amount);
  }

  /** Monto exacto (tooltip) cuando el visible va abreviado. */
  get baseTitle(): string | null {
    if (!this.compact) return null;
    const forced = this.displayWithRate();
    if (forced) return forced;
    // Con el monto cargado visible, el exacto es el que escribió el operador.
    return moneyLoaded(this.entered, this.currency) ?? money(this.amount);
  }

  /** Monto base convertido con la tasa forzada (`displayRateKey`), si aplica. */
  private displayWithRate(): string | null {
    const key = String(this.displayRateKey ?? '').trim();
    if (!key) return null;
    const code = displayBaseCode();
    const value =
      code === 'USD'
        ? Number(this.amount ?? 0)
        : this.rates.fromBase(this.amount, code, key as RateKey);
    if (value === null) return null;
    return this.compact ? moneyInCompact(value, code) : moneyIn(value, code);
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
    const forced = String(this.displayRateKey ?? '').trim() as RateKey | '';
    const items = this.rates.convertsBase()
      ? this.rates.conversionLines(this.amount, forced || null)
      : this.rates.conversions(this.amount);
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
   * Los bolívares de la línea son los que el cajero está leyendo en el monto base
   * (los que escribió el operador o, si no hay monto cargado, el precio en
   * bolívares de la vitrina): así el dólar que se ve es el de los bolívares
   * cobrados y no el del equivalente guardado en dólares.
   */
  private withBcvPrice(items: readonly RateConversion[]): RateConversion[] {
    const all = [...items];
    if (!this.rates.showBcvPrice()) return all;
    if (all.some((item) => item.key === BCV_USD_RATE_KEY)) return all;
    const line = this.rates.bcvUsdConversion(this.amount, this.shownBsAmount);
    return line ? [...all, line] : all;
  }

  /**
   * Bolívares que se están leyendo en el monto base (`base`), para la línea del
   * dólar oficial.
   *
   * La línea los divide entre la tasa del BCV. Si en su lugar se usa el monto
   * guardado en dólares, un precio de Bs 15.520,00 (USD 16,00 a la tasa del local
   * de 970) mostraba `USD · BCV $ 16,00` —los dólares de la vitrina— cuando esos
   * bolívares al BCV (883,30) son `$ 17,57`.
   */
  private get shownBsAmount(): number | null {
    if (displayBaseCode() !== LOCAL_CURRENCY_CODE) return null;

    // La base forzada a una tasa del sistema (`displayRateKey`) ya son esos
    // bolívares: las ventas y la caja los pintan a la tasa oficial.
    const forced = String(this.displayRateKey ?? '').trim();
    if (forced) {
      return this.rates.fromBase(this.amount, LOCAL_CURRENCY_CODE, forced as RateKey);
    }

    // El registro guarda lo que escribió el operador: esos son los bolívares
    // cobrados, no el equivalente en dólares redondeado a centavos.
    const entered = Number(this.entered ?? 0);
    const loaded =
      this.entered != null &&
      Number.isFinite(entered) &&
      entered !== 0 &&
      String(this.currency ?? '').trim().toUpperCase() === LOCAL_CURRENCY_CODE;
    if (loaded) return entered;

    // Sin monto cargado la base la pinta `money()`: dólares × tasa de vitrina (la
    // personalizada del local si existe), el precio que el cajero está leyendo.
    // Se conserva la precisión completa del monto: redondearlo a centavos hacía
    // que los bolívares del día siguiente no coincidieran con el ticket.
    const amount = Number(this.amount ?? 0);
    const bsPerUsd = this.rates.bsPerUsd();
    if (!amount || !bsPerUsd) return null;
    return amount * bsPerUsd;
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
