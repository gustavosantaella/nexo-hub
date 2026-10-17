import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ChargeRateKey, DialogView, PosView } from '../../common/constants/enums';
import { CHARGE_RATE_KEYS, POS_VIEWS } from '../../common/constants/enums';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';

/**
 * Preferencias de interfaz de la EMPRESA activa.
 * `null` significa "sin configurar": la interfaz aplica su valor de fabrica
 * (10 % de propina, formularios en ventana modal y la moneda base del sistema).
 */
export interface CompanyPreferences {
  tipPercent: number | null;
  dialogView: DialogView | null;
  priceCurrency: string | null;
  /**
   * Monedas cuyas conversiones ve el personal de caja debajo de cada monto
   * (`null` = ninguna: solo ve los precios en su moneda). Se guardan como JSON de
   * texto porque es una lista.
   */
  conversionCurrencies: string[] | null;
  /**
   * `true` para mostrar debajo de cada monto, ademas de las conversiones, el
   * precio en dolares a la tasa oficial del BCV. `null` = no se muestra.
   */
  showBcvPrice: boolean | null;
  /**
   * Tasa del dolar (bolivares por 1 USD) con la que el punto de venta cobra: el
   * cajero convierte con ella el saldo del pedido, el efectivo recibido y el
   * vuelto, sin preguntar nada. `null` = sin configurar: se cobra con la tasa
   * activa del sistema (la personalizada del dolar o, si no existe, la del BCV).
   */
  chargeRateKey: ChargeRateKey | null;
  /**
   * Como lista el catalogo el punto de venta: `cards` (tarjetas con foto),
   * `table` (tabla de 20 por pagina) o `columns` (sin foto, columnas de 10).
   * `null` = `cards`, el valor de fabrica.
   */
  posView: PosView | null;
}

/** Columnas que viajan al cliente (el `companyId` es la sesion, no hace falta). */
const PREFERENCES_SELECT = {
  tipPercent: true,
  dialogView: true,
  priceCurrency: true,
  conversionCurrencies: true,
  showBcvPrice: true,
  chargeRateKey: true,
  posView: true,
} satisfies Prisma.CompanyPreferenceSelect;

type PreferenceRow = Prisma.CompanyPreferenceGetPayload<{
  select: typeof PREFERENCES_SELECT;
}>;

/** Sin fila guardada la empresa nunca configuro nada: todo de fabrica. */
const NO_PREFERENCES: CompanyPreferences = {
  tipPercent: null,
  dialogView: null,
  priceCurrency: null,
  conversionCurrencies: null,
  showBcvPrice: null,
  chargeRateKey: null,
  posView: null,
};

/** Tope de monedas en la lista (la interfaz ofrece las configuradas del local). */
const MAX_CONVERSION_CURRENCIES = 24;

/**
 * Deja la propina en un porcentaje utilizable (0-100, dos decimales) o en
 * `null` para borrarla. Igual que en la interfaz, no se admite cualquier numero.
 */
function normalizeTipPercent(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const percent = Number(value);
  if (!Number.isFinite(percent)) return null;
  return Math.min(100, Math.max(0, Math.round(percent * 100) / 100));
}

/**
 * Deja la moneda de los precios en un codigo ISO utilizable (`VES`) o en `null`
 * para borrar la preferencia: sin eleccion el cajero ve la moneda base del
 * sistema. Igual que en la interfaz, cualquier otra cosa se descarta.
 */
function normalizePriceCurrency(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const code = String(value).trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

/**
 * Deja la lista de conversiones del cajero en codigos ISO sin repetir, o en `null`
 * cuando no queda ninguna (es el valor de fabrica: el cajero solo ve los precios
 * en su moneda). Cualquier elemento que no sea un codigo se descarta.
 */
function normalizeConversionCurrencies(
  value: readonly string[] | null | undefined,
): string[] | null {
  if (!value || !Array.isArray(value)) return null;
  const codes = value
    .map((item) => String(item ?? '').trim().toUpperCase())
    .filter((code) => /^[A-Z]{3}$/.test(code));
  const unique = [...new Set(codes)].slice(0, MAX_CONVERSION_CURRENCIES);
  return unique.length ? unique : null;
}

/**
 * Lee la lista guardada como JSON de texto tolerando valores corruptos: lo que no
 * sea una lista de codigos se descarta (misma normalizacion que al escribir).
 */
function parseConversionCurrencies(value: string | null): string[] | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? normalizeConversionCurrencies(parsed as string[])
      : null;
  } catch {
    return null;
  }
}

/**
 * La lista como JSON de texto para guardarla en la columna (`null` borra la
 * preferencia): SQLite no tiene listas, la columna es un `String`.
 */
function serializeConversionCurrencies(
  codes: string[] | null,
): string | null {
  return codes ? JSON.stringify(codes) : null;
}

/**
 * Deja la preferencia del precio en dolares del BCV en `true` (se muestra) o en
 * `null` para borrarla: sin configurar, el cajero no ve esa linea. Solo un
 * booleano la enciende; cualquier otra cosa la deja apagada, igual que en la
 * interfaz.
 */
function normalizeShowBcvPrice(value: boolean | null | undefined): boolean | null {
  return value === true ? true : null;
}

/**
 * Deja la tasa de cobro del cajero en una de las tasas del dolar permitidas o en
 * `null` para cobrar con la tasa activa del sistema. Cualquier otro valor se
 * descarta, igual que en la interfaz.
 */
function normalizeChargeRateKey(value: string | null | undefined): ChargeRateKey | null {
  if (value === null || value === undefined) return null;
  const key = String(value).trim().toUpperCase();
  return (CHARGE_RATE_KEYS as readonly string[]).includes(key) ? (key as ChargeRateKey) : null;
}

/**
 * Deja la vista del catalogo en una de las presentaciones soportadas o en `null`
 * (tarjetas, el valor de fabrica). Cualquier otro valor se descarta.
 */
function normalizePosView(value: string | null | undefined): PosView | null {
  if (value === null || value === undefined) return null;
  const view = String(value).trim().toLowerCase();
  return (POS_VIEWS as readonly string[]).includes(view) ? (view as PosView) : null;
}

function toPreferences(row: PreferenceRow): CompanyPreferences {
  return {
    tipPercent: row.tipPercent,
    dialogView: (row.dialogView as DialogView | null) ?? null,
    priceCurrency: row.priceCurrency ?? null,
    conversionCurrencies: parseConversionCurrencies(row.conversionCurrencies),
    showBcvPrice: row.showBcvPrice ?? null,
    chargeRateKey: normalizeChargeRateKey(row.chargeRateKey),
    posView: normalizePosView(row.posView),
  };
}

/**
 * Preferencias de interfaz de la empresa activa.
 *
 * Una sola fila por empresa (`company_preferences`), compartida por todo su
 * personal: la propina que propone el punto de venta, la moneda en la que el
 * cajero ve los precios —con las conversiones que puede ver debajo de cada
 * monto, el precio en dolares del BCV y la tasa con la que cobra— y la
 * presentacion de los formularios son
 * configuracion del local, no de cada cajero. Quien entra desde otro navegador
 * recibe al iniciar sesion lo mismo que ve el resto del equipo (el frontend copia
 * la respuesta a su `localStorage` para pintar de inmediato).
 */
@Injectable()
export class PreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Preferencias guardadas de la empresa (`null` en un campo = sin configurar). */
  async find(companyId: string): Promise<CompanyPreferences> {
    const row = await this.prisma.companyPreference.findUnique({
      where: { companyId },
      select: PREFERENCES_SELECT,
    });
    return row ? toPreferences(row) : { ...NO_PREFERENCES };
  }

  /**
   * Guarda las preferencias enviadas y devuelve el estado completo. Los campos
   * ausentes se quedan como estaban y `null` vuelve al valor de fabrica.
   */
  async update(
    companyId: string,
    dto: UpdatePreferencesDto,
  ): Promise<CompanyPreferences> {
    const update: Prisma.CompanyPreferenceUncheckedUpdateInput = {};
    if (dto.tipPercent !== undefined) {
      update.tipPercent = normalizeTipPercent(dto.tipPercent);
    }
    if (dto.dialogView !== undefined) {
      update.dialogView = dto.dialogView ?? null;
    }
    if (dto.priceCurrency !== undefined) {
      update.priceCurrency = normalizePriceCurrency(dto.priceCurrency);
    }
    if (dto.conversionCurrencies !== undefined) {
      update.conversionCurrencies = serializeConversionCurrencies(
        normalizeConversionCurrencies(dto.conversionCurrencies),
      );
    }
    if (dto.showBcvPrice !== undefined) {
      update.showBcvPrice = normalizeShowBcvPrice(dto.showBcvPrice);
    }
    if (dto.chargeRateKey !== undefined) {
      update.chargeRateKey = normalizeChargeRateKey(dto.chargeRateKey);
    }
    if (dto.posView !== undefined) {
      update.posView = normalizePosView(dto.posView);
    }

    const row = await this.prisma.companyPreference.upsert({
      where: { companyId },
      create: {
        companyId,
        tipPercent: normalizeTipPercent(dto.tipPercent),
        dialogView: dto.dialogView ?? null,
        priceCurrency: normalizePriceCurrency(dto.priceCurrency),
        conversionCurrencies: serializeConversionCurrencies(
          normalizeConversionCurrencies(dto.conversionCurrencies),
        ),
        showBcvPrice: normalizeShowBcvPrice(dto.showBcvPrice),
        chargeRateKey: normalizeChargeRateKey(dto.chargeRateKey),
        posView: normalizePosView(dto.posView),
      },
      update,
      select: PREFERENCES_SELECT,
    });
    return toPreferences(row);
  }
}
