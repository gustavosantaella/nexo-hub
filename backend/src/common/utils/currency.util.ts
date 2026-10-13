/**
 * Conversion entre monedas del sistema.
 *
 * El sistema guarda SIEMPRE el equivalente en USD (moneda base) de cada pago,
 * ademas del monto original en la moneda en que se cobro. El puente entre
 * ambas es el bolivar:
 *
 *   baseAmount = amount * (Bs por 1 unidad de la moneda) / (Bs por 1 USD)
 *
 * Con eso, cobrar en Bs, en USD o en cualquier otra moneda configurada queda
 * comparable y sumable en los arqueos, listados y estadisticas.
 */
import {
  BASE_CURRENCY_CODE,
  LOCAL_CURRENCY_CODE,
  normalizeCurrencyCode,
} from '../constants/currencies';
import { money, round2, toMoney } from './money.util';

/** Tasas necesarias para convertir un monto a la moneda base. */
export interface ConversionRates {
  /** Bolivares por 1 USD (tasa activa del sistema). */
  bsPerUsd: number | null;
  /** Bolivares por 1 unidad de la moneda que se esta convirtiendo. */
  bsPerCurrency: number | null;
}

/** Resultado de convertir un pago a la moneda base. */
export interface PaymentConversion {
  currency: string;
  /** Bolivares por 1 unidad de `currency` (tasa efectiva aplicada). */
  exchangeRate: number | null;
  /** Equivalente en USD (moneda base del sistema). */
  baseAmount: number;
}

function positiveOrNull(value: number | null | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Convierte un monto expresado en `currency` a la moneda base (USD).
 * Devuelve `null` cuando falta la tasa necesaria para convertir.
 */
export function convertToBase(
  amount: number | null | undefined,
  currency: string,
  rates: ConversionRates,
): PaymentConversion | null {
  const value = toMoney(amount);
  const code = normalizeCurrencyCode(currency);
  const bsPerUsd = positiveOrNull(rates.bsPerUsd);

  if (code === BASE_CURRENCY_CODE) {
    return { currency: code, exchangeRate: bsPerUsd, baseAmount: value };
  }

  if (code === LOCAL_CURRENCY_CODE) {
    if (!bsPerUsd) return null;
    return {
      currency: code,
      exchangeRate: 1,
      baseAmount: money.div(value, bsPerUsd),
    };
  }

  const bsPerCurrency = positiveOrNull(rates.bsPerCurrency);
  if (!bsPerCurrency || !bsPerUsd) return null;

  return {
    currency: code,
    exchangeRate: bsPerCurrency,
    baseAmount: money.div(money.mul(value, bsPerCurrency), bsPerUsd),
  };
}

/**
 * Inverso: expresa un monto de la moneda base (USD) en `currency`.
 * Devuelve `null` cuando falta la tasa necesaria.
 */
export function convertFromBase(
  baseAmount: number | null | undefined,
  currency: string,
  rates: ConversionRates,
): number | null {
  const value = toMoney(baseAmount);
  const code = normalizeCurrencyCode(currency);
  const bsPerUsd = positiveOrNull(rates.bsPerUsd);

  if (code === BASE_CURRENCY_CODE) return value;
  if (code === LOCAL_CURRENCY_CODE) {
    return bsPerUsd ? money.mul(value, bsPerUsd) : null;
  }

  const bsPerCurrency = positiveOrNull(rates.bsPerCurrency);
  if (!bsPerCurrency || !bsPerUsd) return null;
  return money.div(money.mul(value, bsPerUsd), bsPerCurrency);
}

/** Tasa (bolivares por unidad) con la que se guarda un pago en `currency`. */
export function exchangeRateOf(
  currency: string,
  rates: ConversionRates,
): number | null {
  const code = normalizeCurrencyCode(currency);
  const bsPerUsd = positiveOrNull(rates.bsPerUsd);
  if (code === BASE_CURRENCY_CODE) return bsPerUsd;
  if (code === LOCAL_CURRENCY_CODE) return 1;
  return positiveOrNull(rates.bsPerCurrency);
}

/** `true` cuando se puede convertir un monto en `currency` a la moneda base. */
export function canConvert(currency: string, rates: ConversionRates): boolean {
  return convertToBase(round2(1), currency, rates) !== null;
}
