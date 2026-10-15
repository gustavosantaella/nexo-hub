import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BASE_CURRENCY_CODE,
  BCV_SECONDARY_CURRENCY_CODE,
  CurrencySetting,
  LOCAL_CURRENCY_CODE,
  currencyInfo,
  normalizeCurrencyCode,
} from '../../common/constants/currencies';
import {
  ConversionRates,
  convertToBase,
  convertFromBase,
  PaymentConversion,
} from '../../common/utils/currency.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrenciesService } from '../currencies/currencies.service';

/** Clave de `Setting` donde vive la tasa personalizada (Bs por USD). */
export const CUSTOM_RATE_KEY = 'rates.custom_usd';

export type RateKey = 'BCV_USD' | 'BCV_EUR' | 'CUSTOM_USD';

/**
 * Tasas que el operador puede ELEGIR para convertir un monto del catalogo.
 *
 * Las tres se expresan en bolivares (por USD o por EUR), asi que cualquiera
 * sirve de puente bolivares -> dolares: el local decide con cual trabaja
 * (ej. cargar el precio de una caja en bolivares al cambio del euro).
 */
export const RATE_KEYS = ['BCV_USD', 'BCV_EUR', 'CUSTOM_USD'] as const;

/** Clave de tasa valida (`null` cuando no es una de las elegibles). */
export function normalizeRateKey(value?: string | null): RateKey | null {
  const key = String(value ?? '')
    .trim()
    .toUpperCase();
  return (RATE_KEYS as readonly string[]).includes(key) ? (key as RateKey) : null;
}

/** Punto de la serie publicada por el BCV (via dolarvzla). */
export interface BcvPoint {
  date: string;
  usd: number;
  eur: number;
}

/** Respuesta cruda del endpoint publico del BCV. */
export interface BcvPayload {
  current: BcvPoint;
  previous: BcvPoint;
  changePercentage: { usd: number; eur: number };
}

export interface BcvSnapshot extends BcvPayload {
  /** Momento (ISO) en que se consulto el endpoint externo. */
  fetchedAt: string;
  /** Momento (ISO) en que la cache deja de ser valida y se vuelve a consultar. */
  expiresAt: string;
  /** `true` cuando el endpoint fallo y se devolvio la ultima respuesta conocida. */
  stale: boolean;
  sourceUrl: string;
}

export interface CustomRate {
  usd: number;
  updatedAt: string;
  updatedBy: string | null;
}

/**
 * Tasa USDT/VES de una fuente externa (Binance P2P).
 *
 * Es SOLO informativa: sirve para comparar la tasa del local con el mercado y
 * no participa en ninguna conversion de montos (no alimenta `rates`,
 * `activeKey` ni `currencies`).
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
  /** Bolivares por 1 USDT segun la fuente. */
  price: number;
  /** Momento (ISO) del dato publicado por la fuente. */
  asOf: string;
  /** Momento (ISO) en que la fuente entrego la respuesta. */
  fetchedAt: string;
  /** `true` cuando la consulta fallo y se muestra la ultima tasa conocida. */
  stale: boolean;
  sourceUrl: string;
}

/** Una de las tasas que el frontend usa para mostrar los montos "al cambio". */
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

/**
 * Una de las tasas que quedan guardadas en el historial de un cobro.
 *
 * Se guarda solo lo que no cambia nunca: la clave, de que moneda es, de donde
 * salio, su valor en bolivares y la fecha que publico el BCV. La variacion del
 * dia (`changePercentage`) no se guarda porque se recalcula con la serie.
 */
export interface RateHistoryEntry {
  key: RateKey;
  currency: 'USD' | 'EUR';
  source: 'BCV' | 'CUSTOM';
  /** Bolivares por 1 unidad de `currency`. */
  rate: number;
  /** Fecha publicada por el BCV (`YYYY-MM-DD`); `null` en la personalizada. */
  date: string | null;
}

/**
 * HISTORIAL DE TASAS: foto de TODAS las tasas vigentes (BCV dolar, BCV euro y
 * la personalizada del local) en un momento dado.
 *
 * Es lo que se guarda junto a cada cobro para poder auditar despues con que
 * tasas se cobro y que otras existian ese dia, aunque despues cambien. No
 * incluye la tasa USDT de referencia (es informativa y no convierte montos).
 */
export interface RateHistory {
  /** Momento (ISO) en que se tomaron las tasas. */
  capturedAt: string;
  /** Fecha de la serie del BCV de la que salen las tasas oficiales. */
  bcvDate: string | null;
  /** `true` cuando el BCV no respondio y se repitio su ultima serie conocida. */
  stale: boolean;
  /** Tasa con la que el sistema cotiza por defecto (personalizada o BCV dolar). */
  activeKey: RateKey;
  /** Todas las tasas vigentes, en el mismo orden en que las ofrece la pantalla. */
  rates: RateHistoryEntry[];
}

/** Fuente de la tasa de una moneda. */
export type CurrencyRateSource = 'BASE' | 'BCV' | 'CUSTOM' | 'MANUAL' | 'NONE';

/** Moneda aceptada por el local con la tasa lista para convertir montos. */
export interface CurrencyRateOption {
  code: string;
  label: string;
  symbol: string;
  enabled: boolean;
  /** Bolivares por 1 unidad (null cuando no hay tasa configurada). */
  bsPerUnit: number | null;
  source: CurrencyRateSource;
  /** `true` para la moneda base CONTABLE del sistema (siempre USD). */
  isBase: boolean;
  /** `true` para la moneda base con la que se muestran los montos. */
  isDisplayBase: boolean;
  /** Bolivares por 1 USD: puente para convertir entre monedas. */
  bsPerUsd: number;
}

/**
 * Moneda base del sistema: la que el local eligio para mostrar los montos
 * primero (tarjetas, listados, reportes). Los montos se siguen guardando en USD.
 */
export interface BaseCurrencyInfo {
  code: string;
  label: string;
  symbol: string;
  decimals: number;
  /** Bolivares por 1 unidad de la moneda base elegida. */
  bsPerUnit: number | null;
  /** Bolivares por 1 USD (para pasar de la moneda guardada a la mostrada). */
  bsPerUsd: number;
}

export interface RatesSnapshot {
  bcv: BcvSnapshot;
  custom: CustomRate | null;
  /** 2 tasas sin personalizada (BCV USD/EUR) y 3 cuando existe. */
  rates: RateOption[];
  /** Tasa que el POS usa por defecto para el monto "al cambio". */
  activeKey: RateKey;
  /** Monedas configurables con su tasa en bolivares (para cobrar/pagar). */
  currencies: CurrencyRateOption[];
  /** Moneda con la que se muestran los montos del sistema (USD por defecto). */
  baseCurrency: BaseCurrencyInfo;
  /**
   * Tasa USDT/VES de referencia (Binance P2P), solo para mostrar.
   * `null` cuando la fuente externa no respondio y no hay dato previo.
   */
  reference: ReferenceRate | null;
}

/**
 * Tasas de cambio del sistema.
 *
 * Las tasas oficiales se leen del endpoint publico del BCV publicado por
 * dolarvzla (`https://rates.dolarvzla.com/bcv/current.json`) y se cachean en
 * memoria para no golpear al tercero en cada peticion. Si el servicio externo
 * falla se devuelve la ultima respuesta conocida marcada como `stale`.
 *
 * La tasa personalizada del local se guarda en la tabla `Setting` y, cuando
 * existe, se agrega como tercera opcion (`CUSTOM_USD`).
 *
 * Ademas se consulta la tasa USDT/VES de Binance P2P
 * (`https://fx.vexwallet.co/api/v1/fx/latest`) que se devuelve en `reference`
 * SOLO para compararla en pantalla: no participa en ninguna conversion.
 */
@Injectable()
export class RatesService {
  private readonly logger = new Logger(RatesService.name);
  private readonly bcvUrl: string;
  private readonly cacheTtlMs: number;
  private readonly timeoutMs: number;
  private readonly usdtUrl: string;
  private readonly usdtCacheTtlMs: number;

  /** Ultima respuesta valida del BCV (cache en memoria del proceso). */
  private cache: { fetchedAt: number; payload: BcvPayload } | null = null;
  /** Consulta en curso: evita peticiones duplicadas simultaneas. */
  private inflight: Promise<BcvPayload> | null = null;
  /** Ultima tasa USDT de referencia valida (cache en memoria del proceso). */
  private usdtCache: { fetchedAt: number; payload: ReferenceRate } | null = null;
  /** Consulta en curso de la tasa de referencia. */
  private usdtInflight: Promise<ReferenceRate> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly currencies: CurrenciesService,
    config: ConfigService,
  ) {
    this.bcvUrl =
      config.get<string>('rates.bcvUrl') ??
      'https://rates.dolarvzla.com/bcv/current.json';
    this.cacheTtlMs =
      (config.get<number>('rates.cacheTtlSeconds') ?? 900) * 1000;
    this.timeoutMs = config.get<number>('rates.timeoutMs') ?? 8000;
    this.usdtUrl =
      config.get<string>('rates.usdtUrl') ??
      'https://fx.vexwallet.co/api/v1/fx/latest?pair=USDT/VES&source=binance&method=p2p_floor';
    this.usdtCacheTtlMs =
      (config.get<number>('rates.usdtCacheTtlSeconds') ?? 300) * 1000;
  }

  /** Estado completo: BCV + tasa personalizada + tasas utilizables. */
  async snapshot(companyId: string, refresh = false): Promise<RatesSnapshot> {
    // Las dos consultas externas van en paralelo: la de referencia nunca
    // rechaza (si falla devuelve su ultima tasa conocida o null).
    const [{ payload, fetchedAt, stale }, reference] = await Promise.all([
      this.bcv(refresh),
      this.reference(refresh),
    ]);
    const custom = await this.customRate(companyId);
    const rates = this.rateOptions(payload, custom);

    const bsPerUsd = this.bsPerUsd(payload, custom);
    const configured = await this.currencies.list(companyId);
    // Moneda base elegida por el local (la que se muestra primero). Si ya no
    // esta configurada, el sistema vuelve a mostrar los montos en USD.
    const requestedBase = await this.currencies.baseCurrencyCode(companyId);
    const baseCode = configured.some((item) => item.code === requestedBase)
      ? requestedBase
      : BASE_CURRENCY_CODE;
    const options = configured.map((item) =>
      this.currencyOption(item, payload, bsPerUsd, custom !== null, baseCode),
    );

    return {
      bcv: {
        ...payload,
        fetchedAt: new Date(fetchedAt).toISOString(),
        expiresAt: new Date(fetchedAt + this.cacheTtlMs).toISOString(),
        stale,
        sourceUrl: this.bcvUrl,
      },
      custom,
      rates,
      activeKey: this.activeKeyOf(custom),
      currencies: options,
      baseCurrency: this.baseCurrencyInfo(
        options.find((item) => item.isDisplayBase),
        bsPerUsd,
      ),
      reference,
    };
  }

  // =========================================================================
  //  HISTORIAL DE TASAS
  // =========================================================================

  /**
   * TODAS las tasas vigentes (BCV dolar, BCV euro y, cuando existe, la
   * personalizada del local) para guardarlas como HISTORIAL junto a un
   * movimiento de dinero: es lo que se registra en cada cobro.
   *
   * Nunca lanza. Si el BCV no responde y no hay cache previa, o la tasa
   * personalizada no se puede leer, se guarda lo que si se pudo resolver: perder
   * la foto de las tasas no puede impedir registrar un cobro que ya se convirtio
   * bien, asi que el historial es "lo mejor disponible en ese momento".
   */
  async ratesHistory(companyId: string): Promise<RateHistory> {
    const capturedAt = new Date().toISOString();

    let custom: CustomRate | null = null;
    try {
      custom = await this.customRate(companyId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `No se pudo leer la tasa personalizada para el historial de tasas (${message})`,
      );
    }

    let payload: BcvPayload | null = null;
    let stale = false;
    try {
      const bcv = await this.bcv();
      payload = bcv.payload;
      stale = bcv.stale;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `No se pudo leer la tasa del BCV para el historial de tasas (${message})`,
      );
    }

    return {
      capturedAt,
      bcvDate: payload?.current.date ?? null,
      stale,
      activeKey: this.activeKeyOf(custom),
      rates: this.rateOptions(payload, custom).map((rate) => ({
        key: rate.key,
        currency: rate.currency,
        source: rate.source,
        rate: rate.rate,
        date: rate.date,
      })),
    };
  }

  // =========================================================================
  //  MONEDAS / CONVERSIONES
  // =========================================================================

  /**
   * Las tasas utilizables (BCV dolar, BCV euro y -si existe- la personalizada
   * del local), con su serie del dia. Sin serie del BCV (`payload` nulo) quedan
   * solo las tasas que no dependen de el: la personalizada.
   */
  private rateOptions(
    payload: BcvPayload | null,
    custom: CustomRate | null,
  ): RateOption[] {
    const rates: RateOption[] = [];

    if (payload) {
      rates.push(
        {
          key: 'BCV_USD',
          currency: 'USD',
          source: 'BCV',
          rate: payload.current.usd,
          date: payload.current.date,
          previousRate: payload.previous.usd,
          changePercentage: payload.changePercentage.usd,
        },
        {
          key: 'BCV_EUR',
          currency: 'EUR',
          source: 'BCV',
          rate: payload.current.eur,
          date: payload.current.date,
          previousRate: payload.previous.eur,
          changePercentage: payload.changePercentage.eur,
        },
      );
    }

    if (custom) {
      rates.push({
        key: 'CUSTOM_USD',
        currency: 'USD',
        source: 'CUSTOM',
        rate: custom.usd,
        date: null,
        previousRate: null,
        changePercentage: null,
      });
    }

    return rates;
  }

  /** Tasa con la que el sistema cotiza por defecto (personalizada o BCV dolar). */
  private activeKeyOf(custom: CustomRate | null): RateKey {
    return custom ? 'CUSTOM_USD' : 'BCV_USD';
  }

  /** Bolivares por 1 USD con la tasa que el sistema tiene activa. */
  private bsPerUsd(payload: BcvPayload, custom: CustomRate | null): number {
    return custom?.usd ?? payload.current.usd;
  }

  /**
   * Bolivares por 1 USD con la tasa ELEGIDA por el operador (`rateKey`).
   *
   * El local puede decidir con que tasa se convierte cada monto del catalogo:
   * `BCV_USD` (tasa oficial del dolar), `BCV_EUR` (tasa oficial del euro, muy
   * usada como referencia) o `CUSTOM_USD` (la tasa propia del local). Cuando no
   * se elige ninguna —o la elegida ya no existe porque se elimino la tasa
   * personalizada— se usa la activa del sistema.
   */
  private bsPerUsdOf(
    payload: BcvPayload,
    custom: CustomRate | null,
    rateKey?: string | null,
  ): number {
    switch (normalizeRateKey(rateKey)) {
      case 'BCV_USD':
        return payload.current.usd;
      case 'BCV_EUR':
        return payload.current.eur;
      case 'CUSTOM_USD':
        return custom?.usd ?? this.bsPerUsd(payload, custom);
      default:
        return this.bsPerUsd(payload, custom);
    }
  }

  /** Arma la ficha de una moneda con su tasa en bolivares. */
  private currencyOption(
    setting: CurrencySetting,
    payload: BcvPayload,
    bsPerUsd: number,
    hasCustom: boolean,
    displayBase: string,
  ): CurrencyRateOption {
    const { rate, source } = this.resolveBsPerUnit(
      setting,
      payload,
      bsPerUsd,
      hasCustom,
    );
    return {
      code: setting.code,
      label: setting.label,
      symbol: setting.symbol,
      enabled: setting.enabled,
      bsPerUnit: rate,
      source,
      isBase: setting.code === BASE_CURRENCY_CODE,
      isDisplayBase: setting.code === displayBase,
      bsPerUsd,
    };
  }

  /**
   * Ficha de la moneda base (la que se muestra primero). Cuando el local no
   * eligio ninguna o la elegida ya no existe, cae en el dolar.
   */
  private baseCurrencyInfo(
    option: CurrencyRateOption | undefined,
    bsPerUsd: number,
  ): BaseCurrencyInfo {
    const code = option?.code ?? BASE_CURRENCY_CODE;
    const info = currencyInfo(code);
    return {
      code,
      label: option?.label ?? info.label,
      symbol: option?.symbol ?? info.symbol,
      decimals: info.decimals,
      bsPerUnit: option?.bsPerUnit ?? null,
      bsPerUsd,
    };
  }

  /** Tasa (bolivares por 1 unidad) de una moneda configurada. */
  private resolveBsPerUnit(
    setting: CurrencySetting,
    payload: BcvPayload,
    bsPerUsd: number,
    hasCustom = false,
  ): { rate: number | null; source: CurrencyRateSource } {
    if (setting.code === BASE_CURRENCY_CODE) {
      if (setting.rate) return { rate: setting.rate, source: 'MANUAL' };
      // El dolar queda conectado a la API del BCV y, cuando el local definio su
      // propio precio del dolar (bolivares por USD), se usa ese precio.
      return { rate: bsPerUsd, source: hasCustom ? 'CUSTOM' : 'BCV' };
    }
    if (setting.code === LOCAL_CURRENCY_CODE) {
      return { rate: 1, source: 'BASE' };
    }
    if (setting.code === BCV_SECONDARY_CURRENCY_CODE) {
      return setting.rate
        ? { rate: setting.rate, source: 'MANUAL' }
        : { rate: payload.current.eur, source: 'BCV' };
    }
    if (setting.rate) return { rate: setting.rate, source: 'MANUAL' };
    return { rate: null, source: 'NONE' };
  }

  /**
   * Tasas necesarias para convertir un monto expresado en `currency`
   * (bolivares por USD + bolivares por unidad de la moneda).
   *
   * Con `rateKey` el puente bolivares -> dolares es la tasa ELEGIDA (BCV dolar,
   * BCV euro o la personalizada del local); sin ella se usa la activa.
   */
  async conversionRates(
    companyId: string,
    currency?: string | null,
    rateKey?: string | null,
  ): Promise<ConversionRates> {
    const { payload } = await this.bcv();
    const custom = await this.customRate(companyId);
    const bsPerUsd = this.bsPerUsdOf(payload, custom, rateKey);
    const normalized = this.normalizeCurrency(currency);
    const setting = (await this.currencies.list(companyId)).find(
      (item) => item.code === normalized,
    );

    return {
      bsPerUsd,
      bsPerCurrency: setting
        ? this.resolveBsPerUnit(setting, payload, bsPerUsd, custom !== null).rate
        : null,
    };
  }

  /**
   * Convierte un pago a la moneda base (USD) validando que la moneda este
   * aceptada por el local y tenga tasa disponible.
   *
   * `rateKey` es la tasa elegida para ESE monto (opcional): reemplaza al puente
   * por defecto (`personalizada ?? BCV dolar`).
   */
  async resolvePayment(
    companyId: string,
    amount: number,
    currency?: string | null,
    rateKey?: string | null,
  ): Promise<PaymentConversion> {
    const normalized = this.normalizeCurrency(currency);
    const setting = (await this.currencies.list(companyId)).find(
      (item) => item.code === normalized,
    );

    if (!setting || !setting.enabled) {
      throw new BadRequestException(
        `La moneda ${normalized} no esta habilitada. Activala en Configuracion > Monedas.`,
      );
    }

    const conversion = convertToBase(
      amount,
      normalized,
      await this.conversionRates(companyId, normalized, rateKey),
    );

    if (!conversion) {
      throw new BadRequestException(
        `Falta la tasa de ${normalized} (bolivares por 1 ${normalized}). Configurala en Configuracion > Monedas.`,
      );
    }

    return conversion;
  }

  /**
   * Equivalente en la moneda base (USD) de un monto en `currency`.
   */
  async toBaseAmount(
    companyId: string,
    amount: number,
    currency?: string | null,
  ): Promise<number> {
    return (await this.resolvePayment(companyId, amount, currency)).baseAmount;
  }

  /**
   * Contexto de moneda de un monto que NO es un cobro: precio, costo o costo
   * unitario del catalogo, o la valorizacion de un movimiento de inventario.
   *
   * Hace exactamente el mismo calculo que `resolvePayment` (`baseAmount` en USD +
   * la tasa aplicada), pero con el nombre del dominio del catalogo, que es quien
   * lo usa desde productos, menus e inventario.
   *
   * `rateKey` (opcional) es la tasa elegida por el operador para ESE monto.
   */
  async resolveAmount(
    companyId: string,
    amount: number,
    currency?: string | null,
    rateKey?: string | null,
  ): Promise<PaymentConversion> {
    return this.resolvePayment(companyId, amount, currency, rateKey);
  }

  /**
   * Equivalente en `currency` de un monto de la moneda base (USD), con la misma
   * tasa elegida que la ida (`rateKey`): asi el monto que se recupera al reabrir
   * el formulario vuelve a dar el mismo valor en USD.
   */
  async toCurrencyAmount(
    companyId: string,
    amount: number,
    currency?: string | null,
    rateKey?: string | null,
  ): Promise<number> {
    const normalized = this.normalizeCurrency(currency);
    const converted = convertFromBase(
      amount,
      normalized,
      await this.conversionRates(companyId, normalized, rateKey),
    );
    if (converted === null) {
      throw new BadRequestException(
        `Falta la tasa de ${normalized} (bolivares por 1 ${normalized}). Configurala en Configuracion > Monedas.`,
      );
    }
    return converted;
  }

  /** Normaliza el codigo de moneda (vacio = moneda base). */
  private normalizeCurrency(currency: string | null | undefined): string {
    return normalizeCurrencyCode(currency) || BASE_CURRENCY_CODE;
  }

  /**
   * Saldo que puede cubrir un cobro hecho con la **tasa de cobro** `rateKey`.
   *
   * El cajero cobra el precio que lee en pantalla, y los montos se muestran en la
   * moneda base de la empresa (`baseCurrency`), no en dolares: cuando la tasa de
   * cobro no es la activa (el BCV en vez de la personalizada del local), el cobro
   * en divisas vale MAS que el total del pedido —que esta en dolares— sin que sea
   * un exceso real, y al cobrar en bolivares el cliente paga el precio de la
   * pantalla. Esta es la misma conversion que hace el punto de venta antes de
   * mandar el cobro.
   *
   * Sin tasa elegida devuelve el saldo tal cual (`fitToBalance` sigue comparando en
   * dolares); con la empresa mostrando los precios en dolares, tambien.
   */
  async chargeBalance(
    companyId: string,
    balance: number,
    rateKey?: string | null,
  ): Promise<number> {
    const key = normalizeRateKey(rateKey);
    if (!key) return balance;

    const displayCode = await this.currencies.baseCurrencyCode(companyId);
    if (displayCode === BASE_CURRENCY_CODE) return balance;

    const shown = convertFromBase(
      balance,
      displayCode,
      await this.conversionRates(companyId, displayCode, null),
    );
    if (shown === null) return balance;

    const converted = convertToBase(
      shown,
      displayCode,
      await this.conversionRates(companyId, displayCode, key),
    );
    return converted?.baseAmount ?? balance;
  }

  /** Lee la tasa personalizada de la empresa (o `null` si no existe). */
  async customRate(companyId: string): Promise<CustomRate | null> {
    const row = await this.prisma.setting.findUnique({
      where: { companyId_key: { companyId, key: CUSTOM_RATE_KEY } },
      include: { updatedBy: { select: { name: true } } },
    });
    if (!row) return null;

    const usd = Number(row.value);
    if (!Number.isFinite(usd) || usd <= 0) return null;

    return {
      usd,
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: row.updatedBy?.name ?? null,
    };
  }

  /** Guarda la tasa personalizada; con `usd = null` la elimina. */
  async setCustomRate(
    companyId: string,
    usd: number | null,
    userId?: string,
  ): Promise<CustomRate | null> {
    if (usd === null) {
      await this.prisma.setting.deleteMany({
        where: { companyId, key: CUSTOM_RATE_KEY },
      });
      return null;
    }

    const value = String(usd);
    await this.prisma.setting.upsert({
      where: { companyId_key: { companyId, key: CUSTOM_RATE_KEY } },
      update: { value, updatedById: userId },
      create: { companyId, key: CUSTOM_RATE_KEY, value, updatedById: userId },
    });

    return this.customRate(companyId);
  }

  /**
   * Tasas oficiales del BCV. Usa la cache mientras siga vigente; ante un fallo
   * del tercero devuelve la ultima respuesta conocida (marcada como `stale`).
   */
  private async bcv(
    refresh = false,
  ): Promise<{ payload: BcvPayload; fetchedAt: number; stale: boolean }> {
    const cached = this.cache;
    const isFresh =
      cached !== null && Date.now() - cached.fetchedAt < this.cacheTtlMs;

    if (cached && isFresh && !refresh) {
      return {
        payload: cached.payload,
        fetchedAt: cached.fetchedAt,
        stale: false,
      };
    }

    try {
      const payload = await this.fetchBcv();
      this.cache = { fetchedAt: Date.now(), payload };
      return { payload, fetchedAt: this.cache.fetchedAt, stale: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (cached) {
        this.logger.warn(
          `No se pudo consultar el BCV (${message}); se usa la ultima tasa conocida (${new Date(cached.fetchedAt).toISOString()})`,
        );
        return {
          payload: cached.payload,
          fetchedAt: cached.fetchedAt,
          stale: true,
        };
      }

      this.logger.error(`No se pudo consultar el BCV: ${message}`);
      throw new ServiceUnavailableException(
        'No se pudieron obtener las tasas del BCV. Verifica la conexion e intenta de nuevo.',
      );
    }
  }

  /** Consulta el endpoint externo (deduplicando peticiones simultaneas). */
  private fetchBcv(): Promise<BcvPayload> {
    if (!this.inflight) {
      this.inflight = this.requestBcv().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  private async requestBcv(): Promise<BcvPayload> {
    const response = await fetch(this.bcvUrl, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`el BCV respondio ${response.status}`);
    }

    return this.parseBcv(await response.json());
  }

  /** Valida/normaliza la respuesta del BCV antes de cachearla. */
  private parseBcv(body: unknown): BcvPayload {
    const raw = body as {
      current?: Partial<BcvPoint>;
      previous?: Partial<BcvPoint>;
      changePercentage?: { usd?: unknown; eur?: unknown };
    } | null;

    const current = this.parsePoint(raw?.current);
    const previous = this.parsePoint(raw?.previous);
    if (!current || !previous) {
      throw new Error('la respuesta del BCV no tiene el formato esperado');
    }

    const change = raw?.changePercentage ?? {};
    return {
      current,
      previous,
      changePercentage: {
        usd: this.toNumber(change.usd) ?? this.delta(previous.usd, current.usd),
        eur: this.toNumber(change.eur) ?? this.delta(previous.eur, current.eur),
      },
    };
  }

  private parsePoint(point: Partial<BcvPoint> | undefined): BcvPoint | null {
    if (!point) return null;
    const usd = this.toNumber(point.usd);
    const eur = this.toNumber(point.eur);
    if (usd === null || eur === null || usd <= 0 || eur <= 0) return null;
    return { date: String(point.date ?? ''), usd, eur };
  }

  private toNumber(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private delta(from: number, to: number): number {
    if (!from) return 0;
    return ((to - from) / from) * 100;
  }

  // =========================================================================
  //  TASA USDT DE REFERENCIA (SOLO INFORMATIVA)
  // =========================================================================

  /**
   * Tasa USDT/VES publicada por la fuente externa (Binance P2P).
   *
   * Se cachea como el BCV, pero es **informativa**: no se usa para convertir
   * montos. Si la fuente falla se devuelve la ultima tasa conocida marcada como
   * `stale` y, si nunca hubo una respuesta valida, se devuelve `null` (la
   * pantalla de tasas sigue funcionando con el BCV).
   */
  private async reference(refresh = false): Promise<ReferenceRate | null> {
    const cached = this.usdtCache;
    const isFresh =
      cached !== null && Date.now() - cached.fetchedAt < this.usdtCacheTtlMs;

    if (cached && isFresh && !refresh) return cached.payload;

    try {
      const payload = await this.fetchReference();
      this.usdtCache = { fetchedAt: Date.now(), payload };
      return payload;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (cached) {
        this.logger.warn(
          `No se pudo consultar la tasa USDT de referencia (${message}); se usa la ultima conocida (${new Date(cached.fetchedAt).toISOString()})`,
        );
        return { ...cached.payload, stale: true };
      }

      this.logger.warn(
        `No se pudo consultar la tasa USDT de referencia: ${message}`,
      );
      return null;
    }
  }

  /** Consulta el endpoint externo (deduplicando peticiones simultaneas). */
  private fetchReference(): Promise<ReferenceRate> {
    if (!this.usdtInflight) {
      this.usdtInflight = this.requestReference().finally(() => {
        this.usdtInflight = null;
      });
    }
    return this.usdtInflight;
  }

  private async requestReference(): Promise<ReferenceRate> {
    const response = await fetch(this.usdtUrl, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`la fuente USDT respondio ${response.status}`);
    }

    return this.parseReference(await response.json());
  }

  /** Valida/normaliza la respuesta de la fuente antes de cachearla. */
  private parseReference(body: unknown): ReferenceRate {
    const raw = body as {
      pair?: unknown;
      source?: unknown;
      method?: unknown;
      price?: unknown;
      asOf?: unknown;
      fetchedAt?: unknown;
      side?: unknown;
      paymentMethod?: unknown;
    } | null;

    const price = this.toNumber(raw?.price);
    if (price === null || price <= 0) {
      throw new Error('la respuesta de la fuente USDT no tiene el formato esperado');
    }

    const source = this.optionalText(raw?.source) ?? 'desconocida';
    const method = this.optionalText(raw?.method) ?? 'sin metodo';

    return {
      pair: this.optionalText(raw?.pair) ?? 'USDT/VES',
      label: this.referenceLabel(source, method),
      source,
      method,
      side: this.optionalText(raw?.side),
      paymentMethod: this.optionalText(raw?.paymentMethod),
      price,
      asOf: this.optionalText(raw?.asOf) ?? '',
      fetchedAt: this.optionalText(raw?.fetchedAt) ?? new Date().toISOString(),
      stale: false,
      sourceUrl: this.usdtUrl,
    };
  }

  /** Texto legible de la fuente, ej. `Binance · P2P piso`. */
  private referenceLabel(source: string, method: string): string {
    const sources: Record<string, string> = {
      binance: 'Binance',
      bybit: 'Bybit',
      okx: 'OKX',
    };
    const methods: Record<string, string> = {
      p2p_floor: 'P2P piso',
      p2p_mean: 'P2P promedio',
      p2p_median: 'P2P mediana',
    };

    const sourceLabel = sources[source.toLowerCase()] ?? source;
    const methodLabel = methods[method.toLowerCase()] ?? method;
    return `${sourceLabel} · ${methodLabel}`;
  }

  /** Texto no vacio o `null` (los campos opcionales vienen como `null`). */
  private optionalText(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text === '' ? null : text;
  }
}
