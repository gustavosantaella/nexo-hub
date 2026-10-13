/**
 * Monedas que el local acepta cobrar/pagar (modulo de configuracion).
 *
 * La moneda base del sistema es siempre USD y `VES` es la moneda local
 * (1 Bs = 1 Bs). Por defecto tambien viene habilitado el EUR: su tasa la publica
 * el BCV, igual que la del dolar (que ademas puede usar la tasa personalizada
 * del local). Cualquier otra moneda habilitada necesita su tasa en bolivares
 * (`rate` = bolivares por 1 unidad).
 */

/** Configuracion persistida de una moneda. */
export interface CurrencySetting {
  code: string;
  label: string;
  symbol: string;
  /** `true` cuando se puede cobrar/pagar en esa moneda. */
  enabled: boolean;
  /** Bolivares por 1 unidad (`null` = usar la tasa del BCV si existe). */
  rate: number | null;
  decimals: number;
}

/** Lo que se envia al guardar el catalogo de monedas. */
export interface CurrencySettingPayload {
  code: string;
  enabled: boolean;
  rate?: number | null;
  label?: string;
  symbol?: string;
}

/** Respuesta de `GET/PUT /api/currencies`. */
export interface CurrenciesResponse {
  currencies: CurrencySetting[];
}
