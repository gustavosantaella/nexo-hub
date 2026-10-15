import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { DialogView } from '../../common/constants/enums';
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
}

/** Columnas que viajan al cliente (el `companyId` es la sesion, no hace falta). */
const PREFERENCES_SELECT = {
  tipPercent: true,
  dialogView: true,
  priceCurrency: true,
} satisfies Prisma.CompanyPreferenceSelect;

type PreferenceRow = Prisma.CompanyPreferenceGetPayload<{
  select: typeof PREFERENCES_SELECT;
}>;

/** Sin fila guardada la empresa nunca configuro nada: todo de fabrica. */
const NO_PREFERENCES: CompanyPreferences = {
  tipPercent: null,
  dialogView: null,
  priceCurrency: null,
};

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

function toPreferences(row: PreferenceRow): CompanyPreferences {
  return {
    tipPercent: row.tipPercent,
    dialogView: (row.dialogView as DialogView | null) ?? null,
    priceCurrency: row.priceCurrency ?? null,
  };
}

/**
 * Preferencias de interfaz de la empresa activa.
 *
 * Una sola fila por empresa (`company_preferences`), compartida por todo su
 * personal: la propina que propone el punto de venta, la moneda en la que el
 * cajero ve los precios y la presentacion de los formularios son configuracion
 * del local, no de cada cajero. Quien entra desde otro navegador recibe al
 * iniciar sesion lo mismo que ve el resto del equipo (el frontend copia la
 * respuesta a su `localStorage` para pintar de inmediato).
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

    const row = await this.prisma.companyPreference.upsert({
      where: { companyId },
      create: {
        companyId,
        tipPercent: normalizeTipPercent(dto.tipPercent),
        dialogView: dto.dialogView ?? null,
        priceCurrency: normalizePriceCurrency(dto.priceCurrency),
      },
      update,
      select: PREFERENCES_SELECT,
    });
    return toPreferences(row);
  }
}
