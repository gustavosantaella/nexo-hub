import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { BASE_CURRENCY, QUOTE_CURRENCY, currencyMeta } from '../constants/currency';

/**
 * Moneda en la que el sistema muestra los montos base (los que se guardan en
 * dólares). Se configura en Configuración → Tasas; por defecto es USD.
 */
export interface DisplayCurrency {
  code: string;
  label: string;
  symbol: string;
  /** Decimales sugeridos al mostrar montos en esta moneda. */
  decimals: number;
  /** Bolívares por 1 unidad de esta moneda. */
  bsPerUnit: number | null;
  /** Bolívares por 1 USD: puente desde la moneda guardada a la mostrada. */
  bsPerUsd: number | null;
}

/** Moneda base del sistema mientras la empresa no elija otra. */
const DEFAULT_DISPLAY_CURRENCY: DisplayCurrency = {
  code: BASE_CURRENCY.code,
  label: BASE_CURRENCY.label,
  symbol: BASE_CURRENCY.symbol,
  decimals: 2,
  bsPerUnit: null,
  bsPerUsd: null,
};

/**
 * Moneda de visualización (signal): `RatesService` la sincroniza con la que la
 * empresa eligió, así todo el sistema (tarjetas, listados y reportes) repinta
 * los montos sin cambiar de dónde salen.
 */
const display = signal<DisplayCurrency>(DEFAULT_DISPLAY_CURRENCY);

/** Cambia la moneda de visualización (con `null` vuelve a dólares). */
export function setDisplayCurrency(next: DisplayCurrency | null): void {
  display.set(next ?? DEFAULT_DISPLAY_CURRENCY);
}

/** Código de la moneda base con la que se muestran los montos (USD por defecto). */
export function displayBaseCode(): string {
  return display().code;
}

/** Etiqueta de la moneda base con la que se muestran los montos. */
export function displayBaseLabel(): string {
  return display().label;
}

/**
 * Monto guardado en dólares (moneda base contable) con su símbolo, valor y
 * decimales ya expresados en la moneda de visualización.
 */
function toDisplay(value: number | null | undefined): {
  symbol: string;
  value: number;
  decimals: number;
} {
  // El monto se redondea a centavos ANTES de convertir: es el numero que el
  // operador lee en pantalla y el que debe usar cualquier conversion posterior
  // (ej. USD 9,3494 se lee $ 9,35 y a 881,87 Bs/USD son Bs 8.245,48, no 8.245,00).
  const raw = Number(value ?? 0);
  const amount = Math.round((raw + Number.EPSILON) * 100) / 100;
  const state = display();
  if (state.code === BASE_CURRENCY.code) {
    return { symbol: state.symbol, value: amount, decimals: state.decimals };
  }
  const { bsPerUsd, bsPerUnit } = state;
  // Sin tasas no hay forma de convertir: se muestra el monto tal cual (en USD).
  if (!bsPerUsd || !bsPerUnit) {
    return { symbol: BASE_CURRENCY.symbol, value: amount, decimals: 2 };
  }
  return {
    symbol: state.symbol,
    value: (amount * bsPerUsd) / bsPerUnit,
    decimals: state.decimals,
  };
}

/** Numero con separador de miles y la cantidad de decimales indicada. */
function decimal(value: number, digits: number): string {
  return new Intl.NumberFormat(BASE_CURRENCY.locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number.isFinite(value) ? value : 0);
}

/**
 * Formatea un monto de la moneda base del sistema en la moneda de
 * visualización elegida (USD por defecto).
 * Ej.: `money(1234.5)` -> `$ 1,234.50`; con moneda base VES -> `Bs 1,082,406.05`.
 */
export function money(value: number | null | undefined): string {
  const part = toDisplay(value);
  return `${part.symbol} ${decimal(part.value, part.decimals)}`;
}

/**
 * Formatea un monto en la moneda indicada (su simbolo del catalogo).
 * Ej.: `moneyIn(5000, 'VES')` -> `Bs 5,000.00`; `moneyIn(20)` -> `$ 20.00`.
 */
export function moneyIn(value: number | null | undefined, code?: string | null): string {
  const meta = currencyMeta(code);
  return `${meta.symbol} ${decimal(Number(value ?? 0), meta.decimals)}`;
}

/**
 * Formatea el equivalente en bolivares de un monto "al cambio".
 * Ej.: `bs(1052110.66)` -> `Bs 1,052,110.66`.
 */
export function bs(value: number | null | undefined): string {
  return `${QUOTE_CURRENCY.symbol} ${decimal(Number(value ?? 0), 2)}`;
}

/**
 * Equivalente en bolivares abreviado, para espacios estrechos (tarjetas).
 * Ej.: `bsCompact(1052110.66)` -> `Bs 1.1m`.
 */
export function bsCompact(value: number | null | undefined, digits = 1): string {
  return `${QUOTE_CURRENCY.symbol} ${compact(Number(value ?? 0), digits)}`;
}

/**
 * Formatea una tasa de cambio (bolivares por unidad).
 * Ej.: `rate(876.7976)` -> `876.7976`.
 */
export function rate(value: number | null | undefined, digits = 4): string {
  return decimal(Number(value ?? 0), digits);
}

/** Variacion porcentual con signo. Ej.: `signedPercent(0.131)` -> `+0.13%`. */
export function signedPercent(
  value: number | null | undefined,
  digits = 2,
): string {
  const amount = Number(value ?? 0);
  return `${amount > 0 ? '+' : ''}${amount.toFixed(digits)}%`;
}

/** Numero con separador de miles (sin simbolo de moneda). */
export function number(value: number | null | undefined, digits = 0): string {
  return new Intl.NumberFormat(BASE_CURRENCY.locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value ?? 0));
}

/**
 * Cantidad/existencia de inventario: hasta 3 decimales y sin ceros de relleno,
 * porque las recetas consumen fracciones (0.1 = 100 g de algo medido en kilos).
 * Ej.: `quantity(1.5)` -> `1.5`; `quantity(3)` -> `3`.
 */
export function quantity(value: number | null | undefined, digits = 3): string {
  const amount = Number(value ?? 0);
  const safe = Number.isFinite(amount) ? Math.round(amount * 1000) / 1000 : 0;
  return new Intl.NumberFormat(BASE_CURRENCY.locale, {
    maximumFractionDigits: digits,
  }).format(safe);
}

/**
 * Escalas de los numeros abreviados, de la mayor a la menor: 1 500 -> `1.5k`,
 * 1 200 000 -> `1.2m`, 2 500 000 000 -> `2.5b`.
 */
const COMPACT_STEPS: { limit: number; suffix: string }[] = [
  { limit: 1e9, suffix: 'b' },
  { limit: 1e6, suffix: 'm' },
  { limit: 1e3, suffix: 'k' },
];

/** Magnitud a partir de la cual conviene abreviar un numero (10 000 -> `10k`). */
export const COMPACT_FROM = 10_000;

/** `true` si el numero alcanza la magnitud a partir de la cual se abrevia. */
export function isCompact(
  value: number | null | undefined,
  from = COMPACT_FROM,
): boolean {
  return Math.abs(Number(value ?? 0)) >= from;
}

/**
 * Numero abreviado con su escala y sin decimales de relleno:
 * `compact(3000)` -> `3k`; `compact(1500)` -> `1.5k`; `compact(1250000)` -> `1.3m`.
 *
 * Pensado para espacios estrechos (tarjetas, ejes y rankings): el valor exacto
 * se sigue mostrando en el `title` (tooltip) de quien lo pinta.
 */
export function compact(value: number | null | undefined, digits = 1): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return number(0);

  const sign = amount < 0 ? '-' : '';
  const absolute = Math.abs(amount);
  let index = COMPACT_STEPS.findIndex((step) => absolute >= step.limit);
  if (index === -1) {
    return `${sign}${Number.isInteger(absolute) ? number(absolute) : number(absolute, digits)}`;
  }

  let scaled = roundTo(absolute / COMPACT_STEPS[index].limit, digits);
  // 999 999 no debe quedar como "1000k": se sube a la escala mayor ("1m").
  if (index > 0 && scaled >= 1000) {
    index -= 1;
    scaled = roundTo(absolute / COMPACT_STEPS[index].limit, digits);
  }
  return `${sign}${scaledText(scaled, digits)}${COMPACT_STEPS[index].suffix}`;
}

/**
 * Monto abreviado en la moneda de visualización.
 * Ej.: `moneyCompact(1250000)` -> `$ 1.3m`.
 */
export function moneyCompact(value: number | null | undefined, digits = 1): string {
  const part = toDisplay(value);
  return `${part.symbol} ${compact(part.value, digits)}`;
}

/** Monto abreviado en la moneda indicada. Ej.: `moneyInCompact(3200, 'VES')` -> `Bs 3.2k`. */
export function moneyInCompact(
  value: number | null | undefined,
  code?: string | null,
  digits = 1,
): string {
  return `${currencyMeta(code).symbol} ${compact(value, digits)}`;
}

/**
 * Monto **tal como lo escribió el operador** (`*Entered`, en `*Currency`)
 * cuando el sistema está mostrando los montos en ESA misma moneda.
 *
 * Los montos se guardan en dólares (moneda base contable) redondeados a
 * centavos, así que un precio escrito en bolívares se redondea al convertirlo:
 * Bs 350,00 a 970 Bs por dólar son $ 0,36 y al volver a bolívares daría
 * **349,20**. Con el contexto de moneda del precio (`priceEntered` +
 * `priceCurrency`, `unitPriceEntered` + `unitPriceCurrency`, …) la pantalla
 * recupera lo que se escribió; las conversiones que van debajo siguen mostrando
 * el equivalente contable de cada moneda y tasa.
 *
 * Devuelve `null` cuando no aplica (sin monto escrito, en `0` —que también se
 * guarda en `0`— o cuando el monto se escribió en otra moneda).
 *
 * Ej.: con la moneda de visualización en bolívares,
 * `moneyLoaded(350, 'VES')` -> `Bs 350.00`.
 */
export function moneyLoaded(
  entered: number | null | undefined,
  code?: string | null,
): string | null {
  if (!isAmountLoaded(entered, code)) return null;
  return moneyIn(entered, code);
}

/** `moneyLoaded` abreviado, para espacios estrechos. Ej.: `Bs 1.2k`. */
export function moneyLoadedCompact(
  entered: number | null | undefined,
  code?: string | null,
  digits = 1,
): string | null {
  if (!isAmountLoaded(entered, code)) return null;
  return moneyInCompact(entered, code, digits);
}

/** `true` cuando el monto se puede mostrar tal cual se escribió. */
function isAmountLoaded(
  entered: number | null | undefined,
  code?: string | null,
): boolean {
  const amount = Number(entered ?? 0);
  if (entered == null || !Number.isFinite(amount) || amount <= 0) return false;
  return String(code ?? '').trim().toUpperCase() === displayBaseCode();
}

/** Redondea a `digits` decimales. */
function roundTo(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

/** Texto de un valor ya escalado, sin ceros de relleno: `1.50` -> `1.5`, `3.00` -> `3`. */
function scaledText(value: number, digits: number): string {
  return Number.isInteger(value) ? number(value) : number(value, digits);
}


/** Fecha corta: 13 oct 2026. */
export function shortDate(value?: string | Date | null): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-PE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/** Fecha y hora: 13 oct 2026, 09:15. */
export function dateTime(value?: string | Date | null): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-PE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** Valor para `<input type="date">`. */
export function toDateInput(value?: string | Date | null): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

/** Extrae un mensaje legible de un error HTTP del backend NestJS. */
export function apiErrorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) {
      return 'No se pudo conectar con el servidor. Verifica que la API esté en ejecución.';
    }
    const payload = error.error as { message?: string | string[] } | string | null;
    if (typeof payload === 'string' && payload.trim()) return payload;
    const message = payload && typeof payload === 'object' ? payload.message : null;
    if (Array.isArray(message)) return message.join(' · ');
    if (typeof message === 'string' && message.trim()) return message;
    return `Error ${error.status}: ${error.statusText || 'solicitud rechazada'}`;
  }
  if (error instanceof Error) return error.message;
  return 'Ocurrió un error inesperado';
}

/** Código que devuelve el backend cuando la empresa aún está en revisión. */
export const COMPANY_UNDER_REVIEW_CODE = 'COMPANY_UNDER_REVIEW';

/**
 * True si el error es el aviso de "empresa en revisión": la pantalla de acceso
 * lo muestra como advertencia (no como credenciales inválidas).
 */
export function isCompanyUnderReview(error: unknown): boolean {
  if (!(error instanceof HttpErrorResponse)) return false;
  const payload = error.error as { code?: string } | null;
  return (
    !!payload &&
    typeof payload === 'object' &&
    payload.code === COMPANY_UNDER_REVIEW_CODE
  );
}

/** Suma segura de montos (evita los decimales de punto flotante). */
export function sumMoney(values: number[]): number {
  return Math.round(values.reduce((acc, v) => acc + Number(v || 0), 0) * 100) / 100;
}

/** Multiplica montos redondeando a 2 decimales. */
export function mulMoney(a: number, b: number): number {
  return Math.round(Number(a || 0) * Number(b || 0) * 100) / 100;
}

/**
 * Divide montos redondeando a 2 decimales (reparte el precio de una caja entre
 * sus unidades). Devuelve 0 cuando el divisor es 0 para no pintar `NaN`.
 */
export function divMoney(a: number, b: number): number {
  const divisor = Number(b || 0);
  if (!divisor) return 0;
  return Math.round((Number(a || 0) / divisor) * 100) / 100;
}

export function trackById<T extends { id: string }>(_index: number, item: T): string {
  return item.id;
}
