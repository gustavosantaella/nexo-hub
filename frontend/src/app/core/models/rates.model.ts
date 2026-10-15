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

/** Una de las tasas que quedan guardadas en el historial de un cobro. */
export interface RateHistoryEntry {
  key: RateKey;
  currency: 'USD' | 'EUR';
  source: 'BCV' | 'CUSTOM';
  /** Bolívares por 1 unidad de `currency`. */
  rate: number;
  /** Fecha publicada por el BCV (`YYYY-MM-DD`); `null` en la personalizada. */
  date: string | null;
}

/**
 * HISTORIAL DE TASAS: foto de TODAS las tasas vigentes (BCV dólar, BCV euro y la
 * personalizada del local) en el momento de un cobro.
 *
 * Es lo que el backend guarda con cada pago, para poder auditar después con qué
 * tasas se cobró ese día aunque las tasas hayan cambiado.
 */
export interface RateHistory {
  /** Momento en que se tomaron las tasas. */
  capturedAt: string;
  /** Fecha de la serie del BCV de la que salen las tasas oficiales. */
  bcvDate: string | null;
  /** `true` cuando el BCV no respondió y se repitió su última serie conocida. */
  stale: boolean;
  /** Tasa con la que el sistema cotiza por defecto (personalizada o BCV dólar). */
  activeKey: RateKey;
  /** Todas las tasas vigentes, en el mismo orden en que las ofrece la pantalla. */
  rates: RateHistoryEntry[];
}

/** Origen de la tasa de una moneda. */
export type CurrencyRateSource = 'BASE' | 'BCV' | 'CUSTOM' | 'MANUAL' | 'NONE';

/**
 * Moneda base del sistema: la que el local eligió para mostrar los montos
 * primero (tarjetas, listados y reportes). Los montos se siguen guardando en
 * dólares (`baseAmount`).
 */
export interface BaseCurrencyInfo {
  code: string;
  label: string;
  symbol: string;
  /** Decimales sugeridos al mostrar montos en esta moneda. */
  decimals: number;
  /** Bolívares por 1 unidad de esta moneda (`null` si aún no tiene tasa). */
  bsPerUnit: number | null;
  /** Bolívares por 1 USD: puente para pasar de la moneda guardada a la mostrada. */
  bsPerUsd: number;
}

/**
 * Moneda con la tasa lista para cobrar/pagar.
 * `bsPerUnit` son los bolívares por 1 unidad de la moneda (null si aun no
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
  /** `true` para la moneda base CONTABLE del sistema (siempre USD). */
  isBase: boolean;
  /** `true` para la moneda base con la que se muestran los montos. */
  isDisplayBase: boolean;
  bsPerUsd: number;
}

/**
 * Tasa USDT/VES de una fuente externa (Binance P2P).
 *
 * Es SOLO informativa: se muestra para comparar con las tasas del local y no
 * participa en ninguna conversión de montos.
 */
export interface ReferenceRate {
  /** Par consultado (ej. `USDT/VES`). */
  pair: string;
  /** Etiqueta legible de la fuente (ej. `Binance · P2P piso`). */
  label: string;
  source: string;
  method: string;
  side: string | null;
  paymentMethod: string | null;
  /** Bolívares por 1 USDT según la fuente. */
  price: number;
  /** Momento (ISO) del dato publicado por la fuente. */
  asOf: string;
  /** Momento (ISO) en que la fuente entregó la respuesta. */
  fetchedAt: string;
  /** `true` cuando la fuente falló y se muestra la última tasa conocida. */
  stale: boolean;
  sourceUrl: string;
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
  /** Moneda base con la que se muestran los montos (USD por defecto). */
  baseCurrency: BaseCurrencyInfo;
  /**
   * Tasa USDT/VES de referencia, solo para mostrar en Configuración.
   * `null` cuando la fuente no respondió y no hay dato previo.
   */
  reference: ReferenceRate | null;
}

/** Monto convertido con una tasa (lo que pinta `<app-money>`). */
export interface RateConversion {
  /** Clave de la tasa (`BCV_USD`) o código de la moneda (`EUR`). */
  key: string;
  /**
   * Etiqueta de la línea: la tasa (`BCV $`, `BCV €`, `Personalizada`) o la moneda
   * con el origen de su tasa (`USD · BCV`, `EUR · BCV`, `COP · manual`).
   */
  label: string;
  rate: number;
  amount: number;
  text: string;
  /** Código de la moneda de la conversión (cuando es una moneda, no una tasa). */
  code?: string;
  /**
   * `true` cuando `amount` y `text` están en bolívares: las conversiones de la
   * moneda base **dólar** (una línea por tasa). Con otra moneda base cada línea va
   * en la moneda de su tasa o de su moneda (`USD · BCV $ 10,33`).
   */
  inBs?: boolean;
}
