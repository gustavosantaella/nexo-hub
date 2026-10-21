import {
  ChangeDetectionStrategy,
  Component,
  Input,
  booleanAttribute,
  inject,
} from '@angular/core';
import { RatesService } from '../../core/services/rates.service';
import type { RateKey } from '../../core/models/rates.model';
import {
  compact,
  displayBaseCode,
  isCompact,
  money,
  moneyIn,
  moneyLoaded,
  number,
} from '../../core/utils/format';
import { IconComponent } from './icon.component';
import { MoneyComponent } from './money.component';

/**
 * En las tarjetas el ancho es muy corto (seis por fila en reportes y caja): los
 * valores se abrevian antes que en el resto de la app para no salirse.
 */
const CARD_COMPACT_FROM = 1_000;

/** Tarjeta de indicador para el panel y los reportes. */
@Component({
  selector: 'app-stat-card',
  standalone: true,
  imports: [IconComponent, MoneyComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './stat-card.component.html',
})
export class StatCardComponent {
  private readonly rates = inject(RatesService);

  @Input({ required: true }) label = '';
  @Input({ required: true }) value: string | number = '';
  @Input() hint?: string;
  @Input() icon = 'chart';
  @Input() tone: 'brand' | 'emerald' | 'amber' | 'rose' | 'sky' | 'slate' = 'brand';
  @Input() isCurrency = false;
  /** Tasa con la que se pinta el monto (las ventas y la caja usan `BCV_USD`). */
  @Input() displayRateKey: string | null = null;
  /**
   * Monto exacto en la moneda de visualización (lo cobrado, no su equivalente
   * en dólares). Se pinta tal cual cuando la moneda de la tarjeta es la misma
   * que se está mostrando; si no, manda `value`.
   */
  @Input() entered: number | null | undefined = null;
  /** Moneda en la que está expresado `entered`. */
  @Input() currency: string | null | undefined = null;
  /**
   * Abrevia los montos grandes (`$ 1.3m`). Por defecto sí, porque en reportes se
   * ven seis tarjetas por fila; la caja la apaga para enseñar el monto exacto.
   */
  @Input({ transform: booleanAttribute }) compact = true;

  /** Monto (moneda base) que se pinta con su equivalente "al cambio". */
  get amount(): number {
    return Number(this.value) || 0;
  }

  /** `true` si el valor se abrevia (12.5k) para no salirse de la tarjeta. */
  get abbreviated(): boolean {
    return this.compact && isCompact(this.amount, CARD_COMPACT_FROM);
  }

  /** Valor cuando no es un monto (los numeros se agrupan y abrevian solos). */
  get text(): string {
    if (typeof this.value !== 'number') return String(this.value);
    return this.abbreviated ? compact(this.value) : this.exact;
  }

  /** Valor sin abreviar: se pinta como tooltip cuando el visible va abreviado. */
  get title(): string | null {
    return this.abbreviated ? this.exact : null;
  }

  /**
   * Tamano del valor: se achica a medida que el monto exacto es mas largo, para
   * que quepa completo en tarjetas angostas (siete por fila en la caja).
   */
  private get sizeClass(): string {
    if (this.abbreviated) return 'text-xl';
    const length = this.shown.length;
    if (length > 16) return 'text-sm';
    if (length > 13) return 'text-base';
    if (length > 10) return 'text-xl';
    return 'text-2xl';
  }

  /**
   * Texto que ocupa el ancho de la tarjeta, para elegir el tamano.
   *
   * Con `displayRateKey` el monto se pinta a esa tasa (la caja y las ventas van
   * al BCV), asi que el largo se calcula con la misma conversion y no con la
   * tasa de vitrina: si no, una tarjeta con `Bs 1.131.250,00` se medía como
   * `$ 1,250.00` y elegía una letra que no cabe.
   */
  private get shown(): string {
    if (!this.isCurrency) return this.text;
    // El monto cobrado en la moneda de visualización se pinta tal cual: es el
    // texto que ocupa la tarjeta (y el que hay que medir para elegir la letra).
    const loaded = moneyLoaded(this.entered, this.currency);
    if (loaded) return loaded;
    const code = displayBaseCode();
    const key = String(this.displayRateKey ?? '').trim();
    if (!key) return money(this.amount);
    const converted = this.rates.fromBase(this.amount, code, key as RateKey);
    return moneyIn(converted ?? 0, code);
  }

  /** Clases del valor: se reduce el tamano cuando el numero no cabe exacto. */
  valueClasses(display: string): string {
    return [
      display,
      'mt-2 overflow-hidden font-semibold text-slate-900',
      this.sizeClass,
    ]
      .filter((part) => !!part)
      .join(' ');
  }

  get toneClasses(): string {
    const tones: Record<string, string> = {
      brand: 'bg-brand-50 text-brand-700',
      emerald: 'bg-emerald-50 text-emerald-700',
      amber: 'bg-amber-50 text-amber-700',
      rose: 'bg-rose-50 text-rose-700',
      sky: 'bg-sky-50 text-sky-700',
      slate: 'bg-slate-100 text-slate-600',
    };
    return tones[this.tone] ?? tones['brand'];
  }

  /** Valor formateado del numero exacto (base de la tarjeta). */
  private get exact(): string {
    if (this.isCurrency) return money(this.amount);
    return number(this.amount, Number.isInteger(this.amount) ? 0 : 2);
  }
}
