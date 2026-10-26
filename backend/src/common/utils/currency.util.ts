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
import { round2 } from './money.util';

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
  /**
   * Unidades de `currency` que equivalen a 1 USD (`baseAmount = amount / unitsPerBase`).
   *
   * Con ella el arqueo valora el movimiento con toda su precision y recorta una
   * sola vez al final, en vez de sumar `baseAmount` ya redondeado movimiento por
   * movimiento (Bs 15.520,00 al BCV daba 17,57 y el turno cerraba un centavo de
   * mas que lo que pinta la pantalla).
   */
  unitsPerBase: number | null;
}

function positiveOrNull(value: number | null | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Monto a convertir, con TODA su precision.
 *
 * No se recorta antes de operar ni despues de convertir: la conversion es una
 * operacion matematica y solo se recorta al guardar el movimiento en caja
 * (`toCents`) o al pintarlo. Recortar el equivalente en USD antes de volver a
 * multiplicarlo por la tasa hacia que Bs 15.520,00 al BCV (887,30) se cobraran
 * como $ 17,49 y al reconvertirlos dieran Bs 15.518,88 en vez de los 15.520,00
 * originales.
 */
function amountOf(value: number | null | undefined): number {
  const parsed = typeof value === 'string' ? Number(value) : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
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
  const value = amountOf(amount);
  const code = normalizeCurrencyCode(currency);
  const bsPerUsd = positiveOrNull(rates.bsPerUsd);

  if (code === BASE_CURRENCY_CODE) {
    // La moneda base ya esta en USD: 1 unidad = 1 USD.
    return {
      currency: code,
      exchangeRate: bsPerUsd,
      baseAmount: value,
      unitsPerBase: 1,
    };
  }

  if (code === LOCAL_CURRENCY_CODE) {
    if (!bsPerUsd) return null;
    return {
      currency: code,
      exchangeRate: 1,
      // Se divide con toda la precision: Bs 15.520,00 / 887,30 = 17,491265...
      // (no 17,49). El recorte ocurre una sola vez al persistir el movimiento.
      baseAmount: value / bsPerUsd,
      // Unidades de bolivares por 1 USD.
      unitsPerBase: bsPerUsd,
    };
  }

  const bsPerCurrency = positiveOrNull(rates.bsPerCurrency);
  if (!bsPerCurrency || !bsPerUsd) return null;

  return {
    currency: code,
    exchangeRate: bsPerCurrency,
    baseAmount: (value * bsPerCurrency) / bsPerUsd,
    // Unidades de `currency` por 1 USD (puente por el bolivar).
    unitsPerBase: bsPerUsd / bsPerCurrency,
  };
}

/**
 * Inverso: expresa un monto de la moneda base (USD) en `currency`.
 *
 * Conserva toda la precision para que la ida y vuelta sea exacta cuando el
 * llamador tiene el monto completo (15.520 -> 17,491265... -> 15.520). El
 * recorte a los decimales de la moneda corresponde a la vista o al cobro fisico,
 * no a esta conversion.
 */
export function convertFromBase(
  baseAmount: number | null | undefined,
  currency: string,
  rates: ConversionRates,
): number | null {
  const value = amountOf(baseAmount);
  const code = normalizeCurrencyCode(currency);
  const bsPerUsd = positiveOrNull(rates.bsPerUsd);

  if (code === BASE_CURRENCY_CODE) return value;
  if (code === LOCAL_CURRENCY_CODE) {
    return bsPerUsd ? value * bsPerUsd : null;
  }

  const bsPerCurrency = positiveOrNull(rates.bsPerCurrency);
  if (!bsPerCurrency || !bsPerUsd) return null;
  return (value * bsPerUsd) / bsPerCurrency;
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
