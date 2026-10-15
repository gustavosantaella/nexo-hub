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
  LOCAL_CURRENCY_CODE,
  currencyMeta,
  rateKeySource,
  rateSourceLabel,
} from '../../core/constants/currency';
import type { CurrencyRateOption, RateKey } from '../../core/models/rates.model';
import { RatesService } from '../../core/services/rates.service';
import { bs, moneyIn } from '../../core/utils/format';
import { IconComponent } from './icon.component';

/**
 * Selector de la moneda de un pago.
 *
 * Lista únicamente las monedas habilitadas en Configuración → Monedas, cada una
 * con la tasa con la que se convierte (la del BCV, la personalizada del dólar o
 * una manual) y, cuando se conoce el monto, muestra debajo el equivalente en la
 * moneda base (USD) o, si se cobra en la moneda base, su equivalente al cambio en
 * bolívares, indicando si la tasa viene del BCV (API) o es la personalizada del
 * local.
 *
 * Con una **tasa de cobro** (`rateKey`) ese equivalente se calcula con ESA tasa:
 * es la misma conversión que el API aplica al registrar el cobro, así que el
 * operador no puede leer —por ejemplo cobrando en bolívares— un equivalente en
 * dólares distinto al que quedará guardado.
 *
 * Se usa con doble binding: `<app-currency-select [(value)]="form.currency" />`.
 *
 * La moneda elegida se marca en cada opcion con `[selected]` (no con `[value]` en
 * el `select`): la lista de monedas llega junto con las tasas, asi que al crear el
 * campo puede estar vacia todavia y el navegador se quedaria con la primera
 * opcion, mostrando una moneda distinta a la del pago.
 */
@Component({
  selector: 'app-currency-select',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (showLabel) {
      <label class="label" [attr.for]="id">{{ label }}</label>
    }
    <select
      class="input"
      [id]="id"
      [disabled]="disabled"
      (change)="onChange($event)"
    >
      @for (option of options(); track option.code) {
        <option [value]="option.code" [selected]="option.code === code()">
          {{ optionLabel(option) }}
        </option>
      }
    </select>

    @if (missingRate) {
      <p class="mt-1 flex items-center gap-1 text-xs text-rose-600">
        <app-icon name="alert" size="h-3.5 w-3.5" />
        {{ value }} no tiene tasa configurada. Definela en Configuración → Monedas.
      </p>
    } @else if (hint) {
      <p class="mt-1 text-xs text-slate-400">{{ hint }}</p>
    }
  `,
})
export class CurrencySelectComponent {
  private readonly rates = inject(RatesService);

  /** `id` del `<select>` (para el `for` de la etiqueta). */
  @Input() id = 'currency';
  @Input() label = 'Moneda';
  /** Código de la moneda seleccionada. */
  @Input() value: string = BASE_CURRENCY_CODE;
  /** Monto (en la moneda seleccionada) para mostrar el equivalente. */
  @Input() amount: number | null = null;
  @Input() showLabel = true;
  @Input() showHint = true;
  /**
   * Tasa de cobro con la que se convierte el monto (`null` = la activa del
   * sistema). Con ella, el equivalente en bolívares del monto que se está cobrando
   * se calcula con esa tasa y la lista del dólar lo dice (`Dólares (USD) · tasa
   * BCV`), en vez de mostrar la tasa con la que se ven los precios.
   * La ayuda del monto tambien usa esa tasa: cobrando en bolivares el equivalente
   * en dolares es el que el API va a registrar (el precio de la pantalla pasado a
   * la tasa del cobro).
   */
  @Input() rateKey: RateKey | null = null;
  /** Bloquea el selector (por ejemplo si la cuenta ya tiene abonos). */
  @Input() disabled = false;

  @Output() valueChange = new EventEmitter<string>();

  /** Monedas habilitadas en el local (USD siempre presente). */
  get options() {
    return this.rates.enabledCurrencies;
  }

  /**
   * Etiqueta de una moneda en la lista: `Dólares (USD) · tasa BCV`. El origen de
   * la tasa va en la propia opcion para que el operador sepa, sin escribir el
   * monto, si la conversion usa la tasa del BCV, la personalizada del local o una
   * tasa manual.
   */
  optionLabel(option: CurrencyRateOption): string {
    const tag = rateSourceLabel(this.sourceOf(option.code));
    const name = `${option.label ?? option.code} (${option.code})`;
    return tag ? `${name} · tasa ${tag}` : name;
  }

  get missingRate(): boolean {
    const code = this.code();
    if (code === BASE_CURRENCY_CODE) return false;
    return this.rates.bsPerUnit(code) === null;
  }

  /**
   * Equivalente del monto: en USD o, si ya es USD, al cambio en bolívares.
   *
   * La conversión usa la **tasa de cobro** (`rateKey`) cuando el campo la recibe:
   * es la misma que el API aplica al guardar, así que el número que se lee aquí es
   * el que queda registrado (en bolívares, el precio de la pantalla llevado a
   * dólares con la tasa del cobro, no con la de los precios).
   */
  get hint(): string | null {
    if (!this.showHint) return null;
    const amount = Number(this.amount ?? 0);
    if (!amount) return null;

    const code = this.code();
    if (code === BASE_CURRENCY_CODE) {
      const converted = this.rates.toBs(amount, this.rateKey ?? undefined);
      return converted === null
        ? null
        : `≈ ${bs(converted)} al cambio${this.conversionHint(code)}`;
    }

    const converted = this.rates.toBase(amount, code, this.rateKey);
    if (converted === null) return null;
    const symbol = currencyMeta(BASE_CURRENCY_CODE).symbol;
    return `= ${symbol} ${converted.toFixed(2)} · ${moneyIn(amount, code)}${this.conversionHint(code)}`;
  }

  /**
   * Fuente de la tasa con la que se convierte una moneda en la **lista**: la del
   * BCV (API), la personalizada del local o la manual de la moneda.
   *
   * Con una **tasa de cobro** elegida, el dólar —que es la moneda del cobro— se
   * convierte con esa tasa: la etiqueta lo dice para que el cajero no lea
   * "personalizada" mientras cobra al BCV.
   */
  private sourceOf(code: string): CurrencyRateOption['source'] {
    if (this.rateKey && code === BASE_CURRENCY_CODE) {
      return rateKeySource(this.rateKey);
    }
    return this.rates.currencyOf(code)?.source ?? 'NONE';
  }

  /**
   * Tasa con la que se hizo la conversión que muestra la ayuda (`≈ Bs … al cambio`,
   * `= $ … · Bs …`): va rotulada con su origen para que el operador sepa de dónde
   * sale el número.
   */
  private conversionHint(code: string): string {
    const tag = rateSourceLabel(this.conversionSourceOf(code));
    return tag ? ` · tasa ${tag}` : '';
  }

  /**
   * Tasa con la que se convierte el monto de la ayuda.
   *
   * El bolívar no tiene tasa propia (1 Bs = 1 Bs) y su equivalente en dólares sale
   * del puente del dólar: con una tasa de cobro elegida ese puente es la tasa del
   * cobro, y sin nombrarla el equivalente no se explica (los bolívares del precio
   * no se convirtieron con la tasa de la pantalla). Las demás monedas conservan la
   * suya: es la que se leyó en la lista y la que vale el precio por unidad.
   */
  private conversionSourceOf(code: string): CurrencyRateOption['source'] {
    if (code === LOCAL_CURRENCY_CODE && this.rateKey) {
      return rateKeySource(this.rateKey);
    }
    return this.sourceOf(code);
  }

  /** Moneda del pago, normalizada (vacio = moneda base). */
  code(): string {
    return String(this.value ?? '').trim().toUpperCase() || BASE_CURRENCY_CODE;
  }

  onChange(event: Event): void {
    const code = (event.target as HTMLSelectElement).value;
    this.value = code;
    this.valueChange.emit(code);
  }
}
