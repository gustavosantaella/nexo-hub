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
  /** Monto convertido y formateado, en la moneda de esa tasa (Bs, $ o €). */
  text: string;
  /** `true` para la tasa elegida en el campo (la que se guardara). */
  selected: boolean;
  /** Codigo de la moneda del monto convertido (lo que filtra el cajero). */
  currency: string;
}

/**
 * Conversiones de un monto a las tasas del sistema (BCV dolar, BCV euro y la
 * personalizada del local cuando existe).
 *
 * Se usa debajo de los campos de precio para ver "como queda" el monto que se
 * esta escribiendo sin cambiar de moneda:
 *
 *   - Monto en USD  -> su equivalente en bolivares con cada tasa.
 *   - Monto en VES  -> su equivalente en la divisa de cada tasa (la del euro
 *     devuelve euros, no dolares).
 *   - Otra moneda   -> su equivalente en USD y en bolivares con la tasa elegida
 *     en el campo (la activa del sistema cuando no elige ninguna).
 *
 * Con `rateKey` (el campo permite elegir tasa) la linea de la tasa elegida se
 * resalta: es con la que se calculara el monto al guardar.
 *
 * Solo se pintan las monedas que esta sesion puede ver: el personal de caja ve
 * las que el admin activo en Configuracion -> Cajero (por defecto **ninguna**: el
 * precio en su moneda y nada debajo) y ADMIN/MANAGER las ven todas.
 */
@Component({
  selector: 'app-rate-conversions',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './rate-conversions.component.html',
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

    const code =
      String(this.currency ?? '')
        .trim()
        .toUpperCase() || BASE_CURRENCY_CODE;

    // En USD: cuanto son esos dolares en bolivares con cada tasa.
    if (code === BASE_CURRENCY_CODE) {
      return this.visible(
        this.rateOptions().map((option) => ({
          label: RATE_META[option.key].shortLabel,
          text: bs(amount * option.rate),
          selected: option.key === this.rateKey,
          currency: LOCAL_CURRENCY_CODE,
        })),
      );
    }

    // En bolivares: cuanto son esos bolivares en la divisa de cada tasa. El
    // equivalente va en la moneda de esa tasa (la del euro devuelve euros).
    if (code === LOCAL_CURRENCY_CODE) {
      return this.visible(
        this.rateOptions().map((option) => ({
          label: RATE_META[option.key].shortLabel,
          text: moneyIn(amount / option.rate, option.currency),
          selected: option.key === this.rateKey,
          currency: option.currency,
        })),
      );
    }

    // Otra moneda: equivalente en USD (con la tasa elegida) y en bolivares.
    // El equivalente en USD usa esa tasa porque es la misma que el API aplica al
    // guardar el monto: sin ella el chip diria un numero distinto al registrado
    // (el cajero cobra el precio de la pantalla pasado a la tasa del cobro).

    const converted = this.rates.toBase(amount, code, this.rateKey);
    if (converted === null) return [];
    const base = this.rates.bsPerUnit(code);
    return this.visible([
      {
        label: '=',
        text: moneyIn(converted, BASE_CURRENCY_CODE),
        selected: false,
        currency: BASE_CURRENCY_CODE,
      },
      ...(base
        ? [
            {
              label: 'Bs',
              text: bs(amount * base),
              selected: false,
              currency: LOCAL_CURRENCY_CODE,
            },
          ]
        : []),
    ]);
  }

  /**
   * Deja las lineas de las monedas que esta sesion puede ver: el personal de caja
   * solo ve las que el admin activo en Configuracion -> Cajero (por defecto
   * ninguna) y ADMIN/MANAGER las ven todas.
   */
  private visible(items: readonly ConversionLine[]): ConversionLine[] {
    return items.filter((item) => this.rates.showsConversion(item.currency));
  }

  /**
   * Tasas que se muestran debajo de un monto. La personalizada no se incluye:
   * es la tasa de vitrina con la que se pintan los precios en bolívares, no una
   * tasa de cobro ni una conversión comparable.
   */
  private rateOptions() {
    return this.rates
      .rates()
      .filter((option) => option.key !== 'CUSTOM_USD')
      .filter((option) => option.rate > 0);
  }
}
