/**
 * Moneda base del sistema y presentacion de las tasas de cambio.
 *
 * Los montos del sistema se guardan en dolares (`BASE_CURRENCY`); el "monto al
 * cambio" siempre se expresa en bolivares (Bs) usando las tasas del BCV y, si
 * el local la definio, la tasa personalizada.
 */
import type { RateKey } from '../models/rates.model';

export const BASE_CURRENCY = {
  code: 'USD',
  symbol: '$',
  label: 'Dólares',
  locale: 'es-PE',
} as const;

/** Moneda destino de las conversiones. */
export const QUOTE_CURRENCY = {
  code: 'VES',
  symbol: 'Bs',
  label: 'Bolívares',
} as const;

export const DEFAULT_RATE_KEY: RateKey = 'BCV_USD';

/** Codigo de la moneda base contable del sistema. */
export const BASE_CURRENCY_CODE = BASE_CURRENCY.code;

/** Moneda de curso legal local: su tasa es siempre 1 Bs por 1 Bs. */
export const LOCAL_CURRENCY_CODE = 'VES';

/**
 * Marca que el backend guarda en `openingCurrency` cuando el fondo inicial se
 * contó en varias monedas a la vez (el desglose real está en `openingLines`).
 * No es una moneda del catálogo: nunca se usa para convertir montos.
 */
export const MIXED_CURRENCY_CODE = 'MIX';

/** Etiqueta para mostrar un fondo contado en varias monedas. */
export const MIXED_CURRENCY_LABEL = 'Varias monedas';

/**
 * Monedas que el sistema trae por defecto: USD (base, con la tasa del BCV o la
 * personalizada), VES (local) y EUR (tasa del BCV).
 *
 * Siempre estan presentes en Configuración → Monedas: no se pueden quitar, solo
 * desactivar (la base, ni eso). Las monedas adicionales si se pueden quitar.
 */
export const DEFAULT_CURRENCY_CODES: readonly string[] = [
  BASE_CURRENCY_CODE,
  LOCAL_CURRENCY_CODE,
  'EUR',
];

/** `true` si la moneda es una de las que trae el sistema por defecto. */
export function isDefaultCurrency(code: string | null | undefined): boolean {
  return DEFAULT_CURRENCY_CODES.includes(
    String(code ?? '').trim().toUpperCase(),
  );
}

export interface CurrencyMeta {
  code: string;
  label: string;
  symbol: string;
  /** Decimales sugeridos al mostrar montos en esta moneda. */
  decimals: number;
}

/** Catalogo de monedas sugeridas al configurar las que acepta el local. */
export const CURRENCY_CATALOG: readonly CurrencyMeta[] = [
  { code: 'USD', label: 'Dólares', symbol: '$', decimals: 2 },
  { code: 'VES', label: 'Bolívares', symbol: 'Bs', decimals: 2 },
  { code: 'EUR', label: 'Euros', symbol: '€', decimals: 2 },
  { code: 'COP', label: 'Pesos colombianos', symbol: 'COL$', decimals: 2 },
  { code: 'PEN', label: 'Soles', symbol: 'S/', decimals: 2 },
  { code: 'BRL', label: 'Reales', symbol: 'R$', decimals: 2 },
  { code: 'CLP', label: 'Pesos chilenos', symbol: 'CLP$', decimals: 0 },
  { code: 'ARS', label: 'Pesos argentinos', symbol: 'AR$', decimals: 2 },
  { code: 'MXN', label: 'Pesos mexicanos', symbol: 'MX$', decimals: 2 },
  { code: 'DOP', label: 'Pesos dominicanos', symbol: 'RD$', decimals: 2 },
  { code: 'TRY', label: 'Liras turcas', symbol: '₺', decimals: 2 },
];

/** Ficha de una moneda del catalogo (o generica si no esta registrada). */
export function currencyMeta(code: string | null | undefined): CurrencyMeta {
  const normalized = String(code ?? '').trim().toUpperCase() || BASE_CURRENCY_CODE;
  const found = CURRENCY_CATALOG.find((item) => item.code === normalized);
  if (found) return found;
  return {
    code: normalized,
    label: normalized,
    symbol: `${normalized} `,
    decimals: 2,
  };
}

export interface RateMeta {
  /** Nombre completo (tablas y configuración). */
  label: string;
  /** Etiqueta corta para los montos "al cambio". */
  shortLabel: string;
  /** Clases Tailwind del distintivo. */
  badge: string;
  /** Descripcion de la fuente de la tasa. */
  source: string;
}

export const RATE_META: Record<RateKey, RateMeta> = {
  BCV_USD: {
    label: 'BCV Dólar',
    shortLabel: 'BCV $',
    badge: 'bg-sky-100 text-sky-700',
    source: 'Banco Central de Venezuela · tasa oficial del día en bolívares por dólar',
  },
  BCV_EUR: {
    label: 'BCV Euro',
    shortLabel: 'BCV €',
    badge: 'bg-indigo-100 text-indigo-700',
    source: 'Banco Central de Venezuela · tasa oficial del día en bolívares por euro',
  },
  CUSTOM_USD: {
    label: 'Personalizada',
    shortLabel: 'Personalizada',
    badge: 'bg-amber-100 text-amber-700',
    source: 'Tasa definida por el local en este módulo de configuración',
  },
};
