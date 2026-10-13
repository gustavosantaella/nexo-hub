/**
 * Monedas del sistema.
 *
 * Regla general: TODO monto se guarda ademas en su equivalente en USD
 * (`baseAmount`) porque el dolar es la moneda base contable del sistema
 * (`BASE_CURRENCY_CODE`). El bolivar (`LOCAL_CURRENCY_CODE`) no necesita tasa
 * del BCV: 1 Bs = 1 Bs; el dolar y el euro usan la tasa que publica el BCV
 * (el dolar puede usar ademas la tasa personalizada del local) y el resto de
 * monedas requiere una tasa configurada (bolivares por 1 unidad) desde el
 * modulo de configuracion.
 */

/** Moneda base contable del sistema. */
export const BASE_CURRENCY_CODE = 'USD';

/** Moneda de curso legal local (su tasa es siempre 1). */
export const LOCAL_CURRENCY_CODE = 'VES';

/** Moneda cuyo valor publica el BCV ademas del dolar. */
export const BCV_SECONDARY_CURRENCY_CODE = 'EUR';

/**
 * Codigo ficticio que se guarda en `openingCurrency` cuando el fondo inicial se
 * conto en varias monedas a la vez (ej. 100 USD + 5.000 Bs + 50 EUR). No es una
 * moneda del catalogo: nunca se usa para convertir montos, solo como marca. El
 * desglose real vive en `CashSession.openingLines`.
 */
export const MIXED_CURRENCY_CODE = 'MIX';

/**
 * Monedas cuya tasa publica el BCV (bolivares por 1 unidad). Se mantienen
 * "conectadas" a la API de tasas (`/rates`) y por eso no necesitan una tasa
 * configurada a mano.
 */
export const BCV_CURRENCY_CODES: readonly string[] = [
  BASE_CURRENCY_CODE,
  BCV_SECONDARY_CURRENCY_CODE,
];

/**
 * Monedas que se pueden cobrar/pagar sin configurar una tasa manual: USD y EUR
 * (las publica el BCV) y VES (1 Bs = 1 Bs). El resto exige su tasa en bolivares.
 */
export const SELF_RATED_CURRENCY_CODES: readonly string[] = [
  ...BCV_CURRENCY_CODES,
  LOCAL_CURRENCY_CODE,
];

export interface CurrencyInfo {
  code: string;
  label: string;
  symbol: string;
  /** Decimales sugeridos al mostrar el monto en esta moneda. */
  decimals: number;
}

/** Catalogo de monedas sugeridas en el modulo de configuracion. */
export const CURRENCY_CATALOG: readonly CurrencyInfo[] = [
  { code: 'USD', label: 'Dolares', symbol: '$', decimals: 2 },
  { code: 'VES', label: 'Bolivares', symbol: 'Bs', decimals: 2 },
  { code: 'EUR', label: 'Euros', symbol: '€', decimals: 2 },
  { code: 'COP', label: 'Pesos colombianos', symbol: 'COL$', decimals: 2 },
  { code: 'PEN', label: 'Soles', symbol: 'S/', decimals: 2 },
  { code: 'BRL', label: 'Reales', symbol: 'R$', decimals: 2 },
  { code: 'CLP', label: 'Pesos chilenos', symbol: 'CLP$', decimals: 0 },
  { code: 'ARS', label: 'Pesos argentinos', symbol: 'AR$', decimals: 2 },
  { code: 'MXN', label: 'Pesos mexicanos', symbol: 'MX$', decimals: 2 },
  { code: 'DOP', label: 'Pesos dominicanos', symbol: 'RD$', decimals: 2 },
  { code: 'TRY', label: 'Liras turcas', symbol: '₺', decimals: 2 },
] as const;

/**
 * Monedas por defecto del sistema: USD (moneda base, con la tasa del BCV o la
 * personalizada del local), VES (moneda local, 1 Bs = 1 Bs) y EUR (tasa del
 * BCV).
 *
 * Siempre estan presentes en la configuracion del local: **no se pueden
 * quitar**, solo desactivar (y la moneda base, ni eso). Las monedas adicionales
 * que agregue el local si se pueden quitar.
 */
export const DEFAULT_CURRENCY_CODES: readonly string[] = [
  BASE_CURRENCY_CODE,
  LOCAL_CURRENCY_CODE,
  BCV_SECONDARY_CURRENCY_CODE,
];

/** `true` si la moneda es una de las que el sistema trae por defecto. */
export function isDefaultCurrency(code: string): boolean {
  return DEFAULT_CURRENCY_CODES.includes(normalizeCurrencyCode(code));
}

/** Configuracion de una moneda persistida en `Setting` (JSON). */
export interface CurrencySetting {
  code: string;
  label: string;
  symbol: string;
  /** `true` cuando la moneda se puede cobrar/pagar en caja. */
  enabled: boolean;
  /**
   * Bolivares por 1 unidad de esta moneda.
   * `null` = usar la tasa del BCV cuando exista (USD/EUR) o no definida.
   */
  rate: number | null;
  decimals: number;
}

/** Normaliza un codigo de moneda (`usd ` -> `USD`). */
export function normalizeCurrencyCode(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toUpperCase();
}

/** Ficha de una moneda a partir del catalogo (o generica si no existe). */
export function currencyInfo(code: string): CurrencyInfo {
  const normalized = normalizeCurrencyCode(code);
  const found = CURRENCY_CATALOG.find((item) => item.code === normalized);
  if (found) return found;
  return {
    code: normalized || BASE_CURRENCY_CODE,
    label: normalized || BASE_CURRENCY_CODE,
    symbol: normalized ? `${normalized} ` : '$',
    decimals: 2,
  };
}

/** Configuracion base de una moneda (habilitada solo si es de las por defecto). */
export function defaultCurrencySetting(code: string): CurrencySetting {
  const info = currencyInfo(code);
  return {
    code: info.code,
    label: info.label,
    symbol: info.symbol,
    enabled: DEFAULT_CURRENCY_CODES.includes(info.code),
    rate: null,
    decimals: info.decimals,
  };
}
