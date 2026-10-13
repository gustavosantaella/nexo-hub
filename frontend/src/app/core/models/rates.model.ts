/**
 * Modelos de las tasas de cambio (BCV + tasa personalizada del local).
 * Los montos del sistema se guardan en dolares (moneda base) y se muestran
 * "al cambio" en bolivares con las tasas que expone el backend en `/rates`.
 */

/** Identificador de cada tasa utilizable. */
export type RateKey = 'BCV_USD' | 'BCV_EUR' | 'CUSTOM_USD';

/** Punto de la serie publicada por el BCV (via dolarvzla). */
export interface BcvPoint {
  date: string;
  usd: number;
  eur: number;
}

/** Respuesta cruda del endpoint publico del BCV. */
export interface BcvSnapshot {
  current: BcvPoint;
  previous: BcvPoint;
  changePercentage: { usd: number; eur: number };
  /** Momento en que se consulto el endpoint externo. */
  fetchedAt: string;
  /** Momento en que la cache del backend se renueva sola. */
  expiresAt: string;
  /** `true` cuando el BCV no respondio y se sirvio la ultima tasa conocida. */
  stale: boolean;
  sourceUrl: string;
}

/** Tasa personalizada del local (Bs por USD). */
export interface CustomRate {
  usd: number;
  updatedAt: string;
  updatedBy?: string | null;
}

/** Tasa lista para usar en la interfaz. */
export interface RateOption {
  key: RateKey;
  currency: 'USD' | 'EUR';
  source: 'BCV' | 'CUSTOM';
  /** Bolivares por 1 unidad de `currency`. */
  rate: number;
  date: string | null;
  previousRate: number | null;
  changePercentage: number | null;
}

/** Origen de la tasa de una moneda. */
export type CurrencyRateSource = 'BASE' | 'BCV' | 'CUSTOM' | 'MANUAL' | 'NONE';

/**
 * Moneda con la tasa lista para cobrar/pagar.
 * `bsPerUnit` son los bolivares por 1 unidad de la moneda (null si aun no
 * tiene tasa configurada) y `bsPerUsd` es el puente hacia la moneda base.
 */
export interface CurrencyRateOption {
  code: string;
  label: string;
  symbol: string;
  /** `true` cuando la moneda se puede cobrar/pagar en caja. */
  enabled: boolean;
  bsPerUnit: number | null;
  source: CurrencyRateSource;
  /** `true` para la moneda base del sistema (USD). */
  isBase: boolean;
  bsPerUsd: number;
}

/** Respuesta de `GET /api/rates`. */
export interface RatesSnapshot {
  bcv: BcvSnapshot;
  custom: CustomRate | null;
  /** 2 tasas sin personalizada (BCV dolar/euro) y 3 cuando existe. */
  rates: RateOption[];
  /** Tasa que el sistema usa por defecto para el monto "al cambio". */
  activeKey: RateKey;
  /** Monedas configurables con su tasa en bolivares. */
  currencies: CurrencyRateOption[];
}

/** Monto convertido con una tasa (lo que pinta `<app-money>`). */
export interface RateConversion {
  key: RateKey;
  label: string;
  rate: number;
  amount: number;
  text: string;
}
