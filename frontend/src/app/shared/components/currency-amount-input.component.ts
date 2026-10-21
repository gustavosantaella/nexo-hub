import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  inject,
} from '@angular/core';
import {
  BASE_CURRENCY_CODE,
  CurrencyMeta,
  RATE_META,
  currencyMeta,
  rateSourceLabel,
} from '../../core/constants/currency';
import type { RateKey, RateOption } from '../../core/models/rates.model';
import { RatesService } from '../../core/services/rates.service';
import { bs, moneyIn, rate } from '../../core/utils/format';
import { IconComponent } from './icon.component';
import { RateConversionsComponent } from './rate-conversions.component';

/**
 * Campo de monto CON MONEDA (y tasa): pide el precio en la moneda que el usuario
 * elija y muestra debajo las conversiones a las tasas del sistema (BCV dolar, BCV
 * euro y la personalizada del local).
 *
 * Cuando el campo recibe `rateKey` aparece ademas un selector de TASA: el
 * operador decide con cual de las tasas se calcula ese monto (es la que se usa
 * para convertir a la moneda base y la que el API guarda). Sin `rateKey` el
 * campo se comporta como antes: convierte con la tasa activa del sistema.
 *
 * El valor que viaja al API es el monto tal como se escribio, junto con el
 * codigo de la moneda y la tasa elegida; el backend lo convierte a la moneda base
 * contable (USD) y guarda tambien la tasa aplicada. Se usa con doble binding:
 *
 *   `<app-currency-amount-input label="Precio" [(amount)]="form.price"
 *      [(currency)]="form.priceCurrency" [(rateKey)]="form.priceRateKey" />`
 *
 * Los selectores de moneda y de tasa marcan la opcion elegida con `[selected]`
 * (no con `[value]` en el `select`): las monedas del local llegan junto con las
 * tasas, asi que al crear el campo la lista puede estar vacia todavia; el
 * navegador se quedaria con la primera opcion y mostraria una moneda o una tasa
 * distinta a la que el monto realmente usa. Cada moneda se lista con el origen de
 * su tasa (`USD · BCV`, `EUR · personalizada`) para no confundir el dolar del BCV
 * con el del local.
 */
@Component({
  selector: 'app-currency-amount-input',
  standalone: true,
  imports: [IconComponent, RateConversionsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './currency-amount-input.component.html',
})
export class CurrencyAmountInputComponent {
  private readonly rates = inject(RatesService);

  /** `id` del `<input>` (para el `for` de la etiqueta). */
  @Input() id = 'amount';
  @Input() label = 'Monto';
  /** Monto tal como se escribe, en `currency`. */
  @Input() amount: number | null = null;
  /** Moneda del monto (USD por defecto). */
  @Input() currency: string | null = BASE_CURRENCY_CODE;
  /**
   * Tasa elegida para este monto (`BCV_USD`, `BCV_EUR` o `CUSTOM_USD`).
   * `null` desactiva el selector de tasa: el campo convierte con la activa.
   */
  @Input() rateKey: RateKey | null = null;
  @Input() placeholder: string | null = null;
  @Input() step = '0.01';
  @Input() showLabel = true;
  @Input() required = false;
  @Input() disabled = false;
  /** Texto de apoyo bajo las conversiones (opcional). */
  @Input() hint: string | null = null;

  @Output() amountChange = new EventEmitter<number>();
  @Output() currencyChange = new EventEmitter<string>();
  @Output() rateKeyChange = new EventEmitter<RateKey>();

  /** Monedas habilitadas en el local (USD siempre presente). */
  currencyOptions(): CurrencyMeta[] {
    const enabled = this.rates.enabledCurrencies();
    const list = enabled.length ? enabled : [currencyMeta(BASE_CURRENCY_CODE)];
    return list.map((item) => currencyMeta(item.code));
  }

  /**
   * Etiqueta de una moneda en la lista: `USD · BCV`, `EUR · personalizada`. El
   * origen de la tasa va junto al codigo para que el operador sepa con cual se
   * calcula el monto al cambio (la del BCV, la personalizada del local o una
   * manual) antes de escribirlo.
   */
  currencyOptionLabel(option: CurrencyMeta): string {
    const tag = rateSourceLabel(this.rates.currencyOf(option.code)?.source);
    return tag ? `${option.code} · ${tag}` : option.code;
  }

  /**
   * Tasas que el operador puede elegir en este monto: las del sistema (BCV
   * dolar, BCV euro y la personalizada cuando existe).
   *
   * Vacio cuando el campo no pide tasa (`rateKey` sin asignar, como en Caja o
   * Inventario) o cuando el monto ya esta en la moneda base: no hay nada que
   * convertir.
   */
  rateOptions(): RateOption[] {
    if (this.rateKey === null) return [];
    if (this.code() === BASE_CURRENCY_CODE) return [];
    // Sin tasa no hay conversion posible: no se ofrece en el selector.
    return this.rates.rates().filter((option) => option.rate > 0);
  }

  /**
   * Tasa seleccionada: la elegida o, cuando ya no esta disponible (por ejemplo se
   * elimino la personalizada), la activa del sistema. `null` sin selector.
   */
  selectedRateKey(): RateKey | null {
    const options = this.rateOptions();
    if (options.length === 0) return null;
    if (options.some((option) => option.key === this.rateKey)) {
      return this.rateKey;
    }
    const active = this.rates.activeKey();
    if (active && options.some((option) => option.key === active)) return active;
    return options[0].key;
  }

  /** Etiqueta de una tasa en el selector (ej. `BCV € · 982.00 Bs`). */
  rateLabel(option: RateOption): string {
    const label = RATE_META[option.key]?.shortLabel ?? option.key;
    return `${label} · ${rate(option.rate, 2)} Bs`;
  }

  /** `true` cuando la moneda elegida no tiene tasa para convertir. */
  get missingRate(): boolean {
    const code = this.code();
    if (code === BASE_CURRENCY_CODE) return false;
    return this.rates.bsPerUnit(code) === null;
  }

  code(): string {
    return (
      String(this.currency ?? '')
        .trim()
        .toUpperCase() || BASE_CURRENCY_CODE
    );
  }

  onAmount(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const value = raw === '' ? 0 : Number(raw);
    this.amount = Number.isFinite(value) ? value : 0;
    this.amountChange.emit(this.amount);
  }

  onCurrency(event: Event): void {
    const code = (event.target as HTMLSelectElement).value;
    this.currency = code;
    this.currencyChange.emit(code);
  }

  onRateKey(event: Event): void {
    const key = (event.target as HTMLSelectElement).value as RateKey;
    this.rateKey = key;
    this.rateKeyChange.emit(key);
  }

  /**
   * Equivalente del monto en la moneda base, con la tasa elegida (para la ayuda
   * de largo). `null` cuando el monto ya esta en la moneda base o falta la tasa.
   */
  get baseHint(): string | null {
    if (this.code() === BASE_CURRENCY_CODE) return null;
    const converted = this.rates.toBase(
      this.amount,
      this.code(),
      this.selectedRateKey(),
    );
    if (converted === null) return null;
    return `= ${moneyIn(converted, BASE_CURRENCY_CODE)}`;
  }
}
