import { BadRequestException, Injectable } from '@nestjs/common';
import {
  BASE_CURRENCY_CODE,
  BCV_CURRENCY_CODES,
  BCV_SECONDARY_CURRENCY_CODE,
  CurrencySetting,
  DEFAULT_CURRENCY_CODES,
  LOCAL_CURRENCY_CODE,
  SELF_RATED_CURRENCY_CODES,
  currencyInfo,
  defaultCurrencySetting,
  isDefaultCurrency,
  normalizeCurrencyCode,
} from '../../common/constants/currencies';
import { round2 } from '../../common/utils/money.util';
import {
  BASE_CURRENCY_KEY,
  CURRENCIES_KEY,
  CurrenciesRepository,
} from './currencies.repository';

export { BASE_CURRENCY_KEY, CURRENCIES_KEY };

/** Entrada aceptada al guardar una moneda. */
export interface CurrencyInput {
  code: string;
  enabled?: boolean;
  rate?: number | null;
  label?: string;
  symbol?: string;
}

/**
 * Monedas que el local acepta cobrar/pagar.
 *
 * Se persisten como un unico documento JSON en la tabla `Setting`. Las monedas
 * por defecto (**USD** base, con la tasa del BCV o la personalizada, **VES**
 * 1 Bs = 1 Bs y **EUR** con la tasa del BCV) siempre estan presentes: no se
 * pueden quitar, solo desactivar (la base tampoco eso). Las monedas adicionales
 * las agrega y quita el local.
 */
@Injectable()
export class CurrenciesService {
  constructor(private readonly currencies: CurrenciesRepository) {}

  /** Monedas configuradas en la empresa (la moneda base siempre presente). */
  async list(companyId: string): Promise<CurrencySetting[]> {
    const value = await this.currencies.findValue(companyId, CURRENCIES_KEY);
    return this.merge(this.parse(value));
  }

  /** Solo las monedas habilitadas para cobrar/pagar en la empresa. */
  async enabled(companyId: string): Promise<CurrencySetting[]> {
    return (await this.list(companyId)).filter((item) => item.enabled);
  }

  /**
   * Codigo de la moneda base con la que el sistema muestra los montos
   * (USD mientras el local no elija otra).
   *
   * No valida contra la configuracion: si la moneda guardada ya no existe, el
   * snapshot de tasas cae de vuelta al USD.
   */
  async baseCurrencyCode(companyId: string): Promise<string> {
    const value = await this.currencies.findValue(companyId, BASE_CURRENCY_KEY);
    return normalizeCurrencyCode(value) || BASE_CURRENCY_CODE;
  }

  /**
   * Guarda la configuracion completa de la empresa (valida y normaliza).
   * `base` es opcional: cuando se omite, la moneda base guardada no se toca.
   */
  async save(
    companyId: string,
    inputs: CurrencyInput[],
    userId?: string,
    base?: string,
  ): Promise<CurrencySetting[]> {
    const normalized = this.normalizeInputs(inputs);
    const target =
      base === undefined ? undefined : this.resolveBase(base, normalized);
    await this.persist(companyId, normalized, userId, target);
    return this.merge(normalized);
  }

  /** Crea o actualiza una sola moneda sin tocar las demas. */
  async upsert(
    companyId: string,
    code: string,
    input: Omit<CurrencyInput, 'code'>,
    userId?: string,
  ): Promise<CurrencySetting[]> {
    const current = await this.list(companyId);
    const target = normalizeCurrencyCode(code);
    const map = new Map(current.map((item) => [item.code, item]));
    const base = map.get(target) ?? defaultCurrencySetting(target);
    map.set(target, {
      ...base,
      ...(input.label ? { label: input.label } : {}),
      ...(input.symbol ? { symbol: input.symbol } : {}),
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      ...(input.rate === undefined ? {} : { rate: input.rate }),
    });
    return this.save(companyId, [...map.values()], userId);
  }

  /** Quita una moneda de la configuracion (las monedas por defecto no se quitan). */
  async remove(
    companyId: string,
    code: string,
    userId?: string,
  ): Promise<CurrencySetting[]> {
    const target = normalizeCurrencyCode(code);
    this.assertMutable(target);
    const current = await this.list(companyId);
    // Si la moneda quitada era la base de visualizacion, el sistema vuelve a USD.
    const base = await this.baseCurrencyCode(companyId);
    return this.save(
      companyId,
      current.filter((item) => item.code !== target),
      userId,
      base === target ? BASE_CURRENCY_CODE : undefined,
    );
  }

  // ------------------------------------------------------------------ interno

  private async persist(
    companyId: string,
    settings: CurrencySetting[],
    userId?: string,
    base?: string,
  ): Promise<void> {
    const value = JSON.stringify(settings);
    await this.currencies.upsertValue(
      companyId,
      CURRENCIES_KEY,
      value,
      userId,
    );

    if (base === undefined) return;

    const baseValue = normalizeCurrencyCode(base) || BASE_CURRENCY_CODE;
    await this.currencies.upsertValue(
      companyId,
      BASE_CURRENCY_KEY,
      baseValue,
      userId,
    );
  }

  /**
   * Valida la moneda base elegida: tiene que estar configurada y poder
   * convertirse (el bolivar vale 1 Bs, el dolar y el euro salen del BCV y el
   * resto necesita su tasa manual en bolivares por unidad).
   */
  private resolveBase(
    base: string | null | undefined,
    settings: CurrencySetting[],
  ): string {
    const code = normalizeCurrencyCode(base);
    if (!code) {
      throw new BadRequestException('La moneda base no puede quedar vacia');
    }

    const found = settings.find((item) => item.code === code);
    if (!found) {
      throw new BadRequestException(
        `${code} no esta configurada: agregala a la lista antes de usarla como moneda base`,
      );
    }
    if (!SELF_RATED_CURRENCY_CODES.includes(code) && !found.rate) {
      throw new BadRequestException(
        `Configura la tasa de ${code} (bolivares por 1 ${code}) para usarla como moneda base`,
      );
    }

    return code;
  }

  /**
   * Completa la configuracion guardada y la ordena (base, local y euro primero).
   *
   * Las monedas por defecto (USD, VES y EUR) siempre quedan presentes: si el
   * local las quito se vuelven a agregar con sus valores por defecto (habilitada
   * y sin tasa manual), pero se conserva lo que el local haya guardado de ellas
   * (por ejemplo, el EUR desactivado). El resto de monedas se respeta tal cual.
   */
  private merge(stored: CurrencySetting[]): CurrencySetting[] {
    const map = new Map<string, CurrencySetting>();

    for (const item of stored) {
      if (!item.code) continue;
      map.set(item.code, item);
    }

    for (const code of DEFAULT_CURRENCY_CODES) {
      if (!map.has(code)) map.set(code, defaultCurrencySetting(code));
    }

    const order = (code: string): number => {
      if (code === BASE_CURRENCY_CODE) return 0;
      if (code === LOCAL_CURRENCY_CODE) return 1;
      if (code === BCV_SECONDARY_CURRENCY_CODE) return 2;
      return 3;
    };

    return [...map.values()].sort((a, b) => {
      const diff = order(a.code) - order(b.code);
      return diff !== 0 ? diff : a.code.localeCompare(b.code);
    });
  }

  /** Valida y completa las entradas antes de persistirlas. */
  private normalizeInputs(inputs: CurrencyInput[]): CurrencySetting[] {
    if (!Array.isArray(inputs) || inputs.length === 0) {
      throw new BadRequestException('Debes enviar al menos una moneda');
    }

    const result: CurrencySetting[] = [];
    const seen = new Set<string>();

    for (const input of inputs) {
      const code = normalizeCurrencyCode(input?.code);
      if (!/^[A-Z]{3,5}$/.test(code)) {
        throw new BadRequestException(
          `El codigo de moneda "${input?.code ?? ''}" no es valido (usa 3 a 5 letras, ej. USD)`,
        );
      }
      if (seen.has(code)) {
        throw new BadRequestException(`La moneda ${code} esta repetida`);
      }
      seen.add(code);

      const info = currencyInfo(code);
      const enabled = input.enabled ?? true;
      const rate =
        input.rate === null || input.rate === undefined
          ? null
          : round2(Number(input.rate));

      if (rate !== null && (!Number.isFinite(rate) || rate <= 0)) {
        throw new BadRequestException(
          `La tasa de ${code} debe ser mayor a cero`,
        );
      }
      if (code === BASE_CURRENCY_CODE && !enabled) {
        throw new BadRequestException(
          `${BASE_CURRENCY_CODE} es la moneda base del sistema y no se puede desactivar`,
        );
      }
      if (
        enabled &&
        !SELF_RATED_CURRENCY_CODES.includes(code) &&
        !rate
      ) {
        throw new BadRequestException(
          BCV_CURRENCY_CODES.includes(code)
            ? `No se pudo obtener la tasa del BCV para ${code}; define una tasa manual (bolivares por 1 ${code}) para poder cobrar en esa moneda`
            : `Debes configurar la tasa (bolivares por 1 ${code}) para poder cobrar en esa moneda`,
        );
      }

      result.push({
        code,
        label: input.label?.trim() || info.label,
        symbol: input.symbol?.trim() || info.symbol,
        enabled,
        rate,
        decimals: info.decimals,
      });
    }

    if (!result.some((item) => item.code === BASE_CURRENCY_CODE)) {
      throw new BadRequestException(
        `La configuracion debe incluir la moneda base ${BASE_CURRENCY_CODE}`,
      );
    }

    const missingDefaults = DEFAULT_CURRENCY_CODES.filter(
      (code) => !result.some((item) => item.code === code),
    );
    if (missingDefaults.length) {
      throw new BadRequestException(
        `${missingDefaults.join(', ')} son monedas por defecto del sistema y no se pueden quitar; desactivalas si no las usas`,
      );
    }

    return result;
  }

  /** Lee el JSON almacenado tolerando valores corruptos o incompletos. */
  private parse(value: string | undefined): CurrencySetting[] {
    if (!value) return [];
    try {
      const parsed: unknown = JSON.parse(value);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((item) => this.normalizeStored(item))
        .filter((item): item is CurrencySetting => item !== null);
    } catch {
      return [];
    }
  }

  private normalizeStored(value: unknown): CurrencySetting | null {
    const raw = value as Partial<CurrencySetting> | null;
    const code = normalizeCurrencyCode(raw?.code);
    if (!code) return null;
    const info = currencyInfo(code);
    const rate = Number(raw?.rate);
    return {
      code,
      label: String(raw?.label ?? info.label),
      symbol: String(raw?.symbol ?? info.symbol),
      enabled: raw?.enabled !== false,
      rate: Number.isFinite(rate) && rate > 0 ? round2(rate) : null,
      decimals: info.decimals,
    };
  }

  /** Las monedas por defecto (y sobre todo la base) no se pueden eliminar. */
  private assertMutable(code: string): void {
    if (code === BASE_CURRENCY_CODE) {
      throw new BadRequestException(
        `${BASE_CURRENCY_CODE} es la moneda base del sistema y no se puede eliminar`,
      );
    }
    if (isDefaultCurrency(code)) {
      throw new BadRequestException(
        `${code} es una moneda por defecto del sistema y no se puede quitar; desactivala si no la usas`,
      );
    }
  }
}


