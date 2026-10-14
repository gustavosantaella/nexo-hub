import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import {
  BASE_CURRENCY,
  BASE_CURRENCY_CODE,
  LOCAL_CURRENCY_CODE,
  RATE_META,
  currencyMeta,
} from '../constants/currency';
import type {
  BaseCurrencyInfo,
  CurrencyRateOption,
  CustomRate,
  RateConversion,
  RateKey,
  RatesSnapshot,
  ReferenceRate,
} from '../models/rates.model';
import { bs, money, moneyIn, setDisplayCurrency } from '../utils/format';

/** Redondeo monetario (2 decimales) equivalente al del backend. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Moneda base mientras las tasas aún no se han cargado (dólares). */
const DEFAULT_BASE_CURRENCY: BaseCurrencyInfo = {
  code: BASE_CURRENCY.code,
  label: BASE_CURRENCY.label,
  symbol: BASE_CURRENCY.symbol,
  decimals: 2,
  bsPerUnit: null,
  bsPerUsd: 0,
};

/** Preferencia local: mostrar los montos "al cambio" en todo el sistema. */
const CONVERSIONS_KEY = 'nexo-hub.rate-conversions';

function storedConversions(): boolean {
  try {
    return localStorage.getItem(CONVERSIONS_KEY) !== '0';
  } catch {
    return true;
  }
}

/**
 * Tasas de cambio del BCV (dólar y euro) + tasa personalizada del local.
 *
 * El backend consulta `https://rates.dolarvzla.com/bcv/current.json`, cachea la
 * respuesta y persiste la tasa personalizada; aquí solo se mantiene el estado
 * reactivo (signals) que usan `<app-money>` y el módulo de configuración.
 *
 * También expone la tasa **USDT/VES de referencia** publicada por Binance P2P:
 * es informativa y no participa en ninguna conversión.
 */
@Injectable({ providedIn: 'root' })
export class RatesService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/rates`;

  private readonly _snapshot = signal<RatesSnapshot | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _conversions = signal(storedConversions());
  /** Última petición lanzada (para ignorar respuestas obsoletas). */
  private requestId = 0;

  readonly snapshot = this._snapshot.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  /** Interruptor global de los montos "al cambio". */
  readonly showConversions = this._conversions.asReadonly();

  /** Tasas disponibles: 2 (BCV) o 3 (con la personalizada). */
  readonly rates = computed(() => this._snapshot()?.rates ?? []);
  readonly custom = computed<CustomRate | null>(() => this._snapshot()?.custom ?? null);
  readonly hasCustom = computed(() => this.custom() !== null);
  readonly bcv = computed(() => this._snapshot()?.bcv ?? null);
  /**
   * Tasa USDT/VES de referencia (Binance P2P), solo para mostrar.
   * No se usa en ninguna conversión del sistema.
   */
  readonly reference = computed<ReferenceRate | null>(
    () => this._snapshot()?.reference ?? null,
  );
  /** `true` cuando la referencia viene de la última consulta válida. */
  readonly referenceStale = computed(() => this.reference()?.stale ?? false);
  readonly activeKey = computed<RateKey | null>(
    () => this._snapshot()?.activeKey ?? null,
  );
  /** `true` cuando el BCV no respondió y se muestra la última tasa conocida. */
  readonly stale = computed(() => this._snapshot()?.bcv.stale ?? false);
  readonly ready = computed(() => this._snapshot() !== null);

  /** Monedas configuradas con su tasa en bolívares. */
  readonly currencies = computed(() => this._snapshot()?.currencies ?? []);
  /** Monedas que se pueden cobrar/pagar (las habilitadas en Configuración). */
  readonly enabledCurrencies = computed(() =>
    this.currencies().filter((item) => item.enabled),
  );
  /** Moneda base con la que se muestran los montos (USD por defecto). */
  readonly baseCurrency = computed<BaseCurrencyInfo>(
    () => this._snapshot()?.baseCurrency ?? DEFAULT_BASE_CURRENCY,
  );
  /** Código de la moneda base (el que pinta `format.money()`). */
  readonly baseCode = computed(() => this.baseCurrency().code);
  /** `true` cuando los montos se muestran en una moneda distinta del dólar. */
  readonly convertsBase = computed(() => this.baseCode() !== BASE_CURRENCY_CODE);
  /** Bolívares por 1 USD con la tasa activa del sistema (personalizada si existe). */
  readonly bsPerUsd = computed(() => {
    const base = this.currencies().find((item) => item.isBase);
    return base?.bsPerUsd ?? this.bcv()?.current.usd ?? null;
  });

  /**
   * Carga (o recarga) las tasas. `force` pide al backend ignorar su caché y
   * volver a consultar el BCV; además, en multi-empresa, se usa tras iniciar
   * sesión o cambiar de empresa para traer las tasas/ monedas de esa empresa.
   */
  load(force = false): void {
    if (this._loading() && !force) return;

    // Identificador de petición: descarta respuestas obsoletas si el usuario
    // cambia de empresa antes de que llegue la anterior.
    const requestId = ++this.requestId;
    this._loading.set(true);

    this.http
      .get<RatesSnapshot>(`${this.baseUrl}${force ? '?refresh=true' : ''}`)
      .subscribe({
        next: (snapshot) => {
          if (requestId !== this.requestId) return;
          this._snapshot.set(snapshot);
          this.applyDisplayBase(snapshot);
          this._error.set(null);
          this._loading.set(false);
        },
        error: (error: Error) => {
          if (requestId !== this.requestId) return;
          this._error.set(error.message ?? 'No se pudieron cargar las tasas');
          this._loading.set(false);
        },
      });
  }

  /** Carga las tasas solo una vez (al montar el layout). */
  ensureLoaded(): void {
    if (!this.ready() && !this._loading()) this.load();
  }

  /**
   * Sincroniza el formateo global de montos (`format.money()`) con la moneda
   * base de la empresa: así tarjetas, listados y reportes muestran primero esa
   * moneda sin cambiar de dónde salen los datos (que siguen en USD).
   */
  private applyDisplayBase(snapshot: RatesSnapshot): void {
    const base = snapshot.baseCurrency;
    // Compatibilidad: un snapshot sin moneda base deja los montos en dólares.
    if (!base) {
      setDisplayCurrency(null);
      return;
    }
    setDisplayCurrency({
      code: base.code,
      label: base.label,
      symbol: base.symbol,
      decimals: base.decimals ?? 2,
      bsPerUnit: base.bsPerUnit,
      bsPerUsd: base.bsPerUsd,
    });
  }

  /** Guarda la tasa personalizada; con `null` la elimina. */
  setCustomRate(usd: number | null, onDone?: (custom: CustomRate | null) => void): void {
    const request =
      usd === null
        ? this.http.delete<CustomRate | null>(`${this.baseUrl}/custom`)
        : this.http.put<CustomRate | null>(`${this.baseUrl}/custom`, { usd });

    request.subscribe({
      next: (custom) => {
        this.load(true);
        onDone?.(custom);
      },
    });
  }

  /** Muestra u oculta los montos "al cambio" en todo el sistema. */
  setConversions(show: boolean): void {
    this._conversions.set(show);
    try {
      localStorage.setItem(CONVERSIONS_KEY, show ? '1' : '0');
    } catch {
      /* almacenamiento no disponible */
    }
  }

  toggleConversions(): void {
    this.setConversions(!this._conversions());
  }

  /** Tasa con `key` (o la activa si se omite). */
  rateOf(key?: RateKey): number | null {
    const rates = this.rates();
    if (rates.length === 0) return null;
    const found = key ? rates.find((item) => item.key === key) : undefined;
    if (found) return found.rate;
    return rates.find((item) => item.key === this.activeKey())?.rate ?? rates[0].rate;
  }

  /**
   * Convierte un monto (en moneda base, USD) a bolívares con cada tasa activa.
   * Devuelve `[]` mientras las tasas no estén cargadas.
   */
  conversions(amount: number | null | undefined): RateConversion[] {
    const value = Number(amount ?? 0);
    return this.rates().map((option) => ({
      key: option.key,
      label: RATE_META[option.key]?.shortLabel ?? option.key,
      rate: option.rate,
      amount: value * option.rate,
      text: bs(value * option.rate),
    }));
  }

  /**
   * Convierte un monto (en moneda base contable, USD) a las demás monedas
   * configuradas: es la lista que se muestra debajo del monto cuando la moneda
   * base elegida no es el dólar.
   */
  currencyConversions(amount: number | null | undefined): RateConversion[] {
    const usd = Number(amount ?? 0);
    const bsPerUsd = this.bsPerUsd();
    const base = this.baseCode();
    if (!bsPerUsd) return [];

    return this.currencies()
      .filter((item) => item.enabled && item.code !== base && !!item.bsPerUnit)
      .map((item) => {
        const bsPerUnit = item.bsPerUnit as number;
        const value = round2((usd * bsPerUsd) / bsPerUnit);
        return {
          key: item.code,
          code: item.code,
          label: item.code,
          rate: bsPerUnit,
          amount: value,
          text: moneyIn(value, item.code),
        };
      });
  }

  /** Equivalente en bolívares con la tasa indicada (la activa por defecto). */
  toBs(amount: number | null | undefined, key?: RateKey): number | null {
    const rate = this.rateOf(key);
    if (rate === null) return null;
    return Number(amount ?? 0) * rate;
  }

  // ===========================================================================
  //  MONEDAS DE PAGO
  // ===========================================================================

  /** Configuración y tasa de una moneda (o `undefined` si no está registrada). */
  currencyOf(code?: string | null): CurrencyRateOption | undefined {
    const normalized =
      String(code ?? '').trim().toUpperCase() || BASE_CURRENCY_CODE;
    return this.currencies().find((item) => item.code === normalized);
  }

  /** Etiqueta legible de una moneda ("Bolívares (VES)"). */
  currencyLabel(code?: string | null): string {
    const found = this.currencyOf(code);
    if (found) return `${found.label} (${found.code})`;
    const meta = currencyMeta(code);
    return `${meta.label} (${meta.code})`;
  }

  /** Bolívares por 1 unidad de `code` (1 para el bolívar; null si falta tasa). */
  bsPerUnit(code?: string | null): number | null {
    const normalized =
      String(code ?? '').trim().toUpperCase() || BASE_CURRENCY_CODE;
    if (normalized === BASE_CURRENCY_CODE) return this.bsPerUsd();
    if (normalized === LOCAL_CURRENCY_CODE) return 1;
    return this.currencyOf(normalized)?.bsPerUnit ?? null;
  }

  /**
   * Convierte un monto expresado en `code` a la moneda base (USD).
   * Devuelve `null` cuando falta la tasa necesaria.
   */
  toBase(
    amount: number | null | undefined,
    code?: string | null,
  ): number | null {
    const value = Number(amount ?? 0);
    const normalized =
      String(code ?? '').trim().toUpperCase() || BASE_CURRENCY_CODE;
    if (normalized === BASE_CURRENCY_CODE) return round2(value);

    const bsPerUsd = this.bsPerUsd();
    if (!bsPerUsd) return null;
    const bsPerUnit = this.bsPerUnit(normalized);
    if (!bsPerUnit) return null;

    return round2((value * bsPerUnit) / bsPerUsd);
  }

  /** Convierte un monto de la moneda base (USD) a `code`. */
  fromBase(
    amount: number | null | undefined,
    code?: string | null,
  ): number | null {
    const value = Number(amount ?? 0);
    const normalized =
      String(code ?? '').trim().toUpperCase() || BASE_CURRENCY_CODE;
    if (normalized === BASE_CURRENCY_CODE) return round2(value);

    const bsPerUsd = this.bsPerUsd();
    const bsPerUnit = this.bsPerUnit(normalized);
    if (!bsPerUsd || !bsPerUnit) return null;

    return round2((value * bsPerUsd) / bsPerUnit);
  }

  /**
   * Texto del equivalente en moneda base de un monto en `code`
   * (ej. `= $ 12.34`). Devuelve `null` si no hay conversión que mostrar
   * (misma moneda o falta de tasa).
   */
  baseHint(amount: number | null | undefined, code?: string | null): string | null {
    const normalized = String(code ?? '').trim().toUpperCase();
    if (!normalized || normalized === BASE_CURRENCY_CODE) return null;
    const converted = this.toBase(amount, normalized);
    if (converted === null) return null;
    return `= ${money(converted)}`;
  }
}
