import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  inject,
} from '@angular/core';
import { BASE_CURRENCY_CODE, currencyMeta } from '../../core/constants/currency';
import { RatesService } from '../../core/services/rates.service';
import { bs, moneyIn } from '../../core/utils/format';
import { IconComponent } from './icon.component';

/**
 * Selector de la moneda de un pago.
 *
 * Lista únicamente las monedas habilitadas en Configuración → Monedas y, cuando
 * se conoce el monto, muestra debajo el equivalente en la moneda base (USD) o,
 * si se cobra en la moneda base, su equivalente al cambio en bolívares,
 * indicando si la tasa viene del BCV (API) o es la personalizada del local.
 *
 * Se usa con doble binding: `<app-currency-select [(value)]="form.currency" />`.
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
      [value]="value || baseCode"
      [disabled]="disabled"
      (change)="onChange($event)"
    >
      @for (option of options(); track option.code) {
        <option [value]="option.code">{{ option.label }} ({{ option.code }})</option>
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
  /** Bloquea el selector (por ejemplo si la cuenta ya tiene abonos). */
  @Input() disabled = false;

  @Output() valueChange = new EventEmitter<string>();

  readonly baseCode = BASE_CURRENCY_CODE;

  /** Monedas habilitadas en el local (USD siempre presente). */
  get options() {
    return this.rates.enabledCurrencies;
  }

  get missingRate(): boolean {
    const code = this.code();
    if (code === BASE_CURRENCY_CODE) return false;
    return this.rates.bsPerUnit(code) === null;
  }

  /** Equivalente del monto: en USD o, si ya es USD, al cambio en bolívares. */
  get hint(): string | null {
    if (!this.showHint) return null;
    const amount = Number(this.amount ?? 0);
    if (!amount) return null;

    const code = this.code();
    if (code === BASE_CURRENCY_CODE) {
      const converted = this.rates.toBs(amount);
      return converted === null
        ? null
        : `≈ ${bs(converted)} al cambio${this.sourceHint(code)}`;
    }

    const converted = this.rates.toBase(amount, code);
    if (converted === null) return null;
    const symbol = currencyMeta(BASE_CURRENCY_CODE).symbol;
    return `= ${symbol} ${converted.toFixed(2)} · ${moneyIn(amount, code)}${this.sourceHint(code)}`;
  }

  /**
   * Fuente de la tasa con la que se convierte: del BCV (API) o del local
   * (personalizada del dólar / manual de la moneda).
   */
  private sourceHint(code: string): string {
    switch (this.rates.currencyOf(code)?.source) {
      case 'BCV':
        return ' · tasa BCV';
      case 'CUSTOM':
        return ' · tasa personalizada del dólar';
      case 'MANUAL':
        return ' · tasa manual';
      default:
        return '';
    }
  }

  private code(): string {
    return String(this.value ?? '').trim().toUpperCase() || BASE_CURRENCY_CODE;
  }

  onChange(event: Event): void {
    const code = (event.target as HTMLSelectElement).value;
    this.value = code;
    this.valueChange.emit(code);
  }
}
