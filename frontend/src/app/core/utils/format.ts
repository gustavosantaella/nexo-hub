import { HttpErrorResponse } from '@angular/common/http';
import {
  BASE_CURRENCY,
  QUOTE_CURRENCY,
  currencyMeta,
} from '../constants/currency';

/** Numero con separador de miles y la cantidad de decimales indicada. */
function decimal(value: number, digits: number): string {
  return new Intl.NumberFormat(BASE_CURRENCY.locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number.isFinite(value) ? value : 0);
}

/**
 * Formatea un monto en la moneda base del sistema (USD).
 * Ej.: `money(1234.5)` -> `$ 1,234.50`.
 */
export function money(value: number | null | undefined): string {
  return `${BASE_CURRENCY.symbol} ${decimal(Number(value ?? 0), 2)}`;
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

/** Suma segura de montos (evita los decimales de punto flotante). */
export function sumMoney(values: number[]): number {
  return Math.round(values.reduce((acc, v) => acc + Number(v || 0), 0) * 100) / 100;
}

/** Multiplica montos redondeando a 2 decimales. */
export function mulMoney(a: number, b: number): number {
  return Math.round(Number(a || 0) * Number(b || 0) * 100) / 100;
}

export function trackById<T extends { id: string }>(_index: number, item: T): string {
  return item.id;
}
