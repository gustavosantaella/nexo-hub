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
  /** `true` para la moneda base del sistema (USD). */
  isBase: boolean;
  /** Bolivares por 1 USD: puente para convertir entre monedas. */
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
 */
@Injectable()
export class RatesService {
  private readonly logger = new Logger(RatesService.name);
  private readonly bcvUrl: string;
  private readonly cacheTtlMs: number;
  private readonly timeoutMs: number;

  /** Ultima respuesta valida del BCV (cache en memoria del proceso). */
  private cache: { fetchedAt: number; payload: BcvPayload } | null = null;
  /** Consulta en curso: evita peticiones duplicadas simultaneas. */
  private inflight: Promise<BcvPayload> | null = null;

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
  }

  /** Estado completo: BCV + tasa personalizada + tasas utilizables. */
  async snapshot(refresh = false): Promise<RatesSnapshot> {
    const { payload, fetchedAt, stale } = await this.bcv(refresh);
    const custom = await this.customRate();

    const rates: RateOption[] = [
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
    ];

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

    const bsPerUsd = this.bsPerUsd(payload, custom);
    const configured = await this.currencies.list();

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
      activeKey: custom ? 'CUSTOM_USD' : 'BCV_USD',
      currencies: configured.map((item) =>
        this.currencyOption(item, payload, bsPerUsd, custom !== null),
      ),
    };
  }

  // =========================================================================
  //  MONEDAS / CONVERSIONES
  // =========================================================================

  /** Bolivares por 1 USD con la tasa que el sistema tiene activa. */
  private bsPerUsd(payload: BcvPayload, custom: CustomRate | null): number {
    return custom?.usd ?? payload.current.usd;
  }

  /** Arma la ficha de una moneda con su tasa en bolivares. */
  private currencyOption(
    setting: CurrencySetting,
    payload: BcvPayload,
    bsPerUsd: number,
    hasCustom: boolean,
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
   */
  async conversionRates(currency?: string | null): Promise<ConversionRates> {
    const { payload } = await this.bcv();
    const custom = await this.customRate();
    const bsPerUsd = this.bsPerUsd(payload, custom);
    const normalized = this.normalizeCurrency(currency);
    const setting = (await this.currencies.list()).find(
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
   */
  async resolvePayment(
    amount: number,
    currency?: string | null,
  ): Promise<PaymentConversion> {
    const normalized = this.normalizeCurrency(currency);
    const setting = (await this.currencies.list()).find(
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
      await this.conversionRates(normalized),
    );

    if (!conversion) {
      throw new BadRequestException(
        `Falta la tasa de ${normalized} (bolivares por 1 ${normalized}). Configurala en Configuracion > Monedas.`,
      );
    }

    return conversion;
  }

  /** Equivalente en la moneda base (USD) de un monto en `currency`. */
  async toBaseAmount(
    amount: number,
    currency?: string | null,
  ): Promise<number> {
    return (await this.resolvePayment(amount, currency)).baseAmount;
  }

  /** Equivalente en `currency` de un monto de la moneda base (USD). */
  async toCurrencyAmount(
    amount: number,
    currency?: string | null,
  ): Promise<number> {
    const normalized = this.normalizeCurrency(currency);
    const converted = convertFromBase(
      amount,
      normalized,
      await this.conversionRates(normalized),
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

  /** Lee la tasa personalizada del local (o `null` si no existe). */
  async customRate(): Promise<CustomRate | null> {
    const row = await this.prisma.setting.findUnique({
      where: { key: CUSTOM_RATE_KEY },
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
    usd: number | null,
    userId?: string,
  ): Promise<CustomRate | null> {
    if (usd === null) {
      await this.prisma.setting.deleteMany({ where: { key: CUSTOM_RATE_KEY } });
      return null;
    }

    const value = String(usd);
    await this.prisma.setting.upsert({
      where: { key: CUSTOM_RATE_KEY },
      update: { value, updatedById: userId },
      create: { key: CUSTOM_RATE_KEY, value, updatedById: userId },
    });

    return this.customRate();
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
}
