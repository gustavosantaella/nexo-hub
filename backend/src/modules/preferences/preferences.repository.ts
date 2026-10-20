import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

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

export type PreferenceRow = Prisma.CompanyPreferenceGetPayload<{
  select: typeof PREFERENCES_SELECT;
}>;

/**
 * Acceso a datos de las preferencias de interfaz de la empresa. Toda
 * consulta/escritura de Prisma del modulo vive aqui: el servicio conserva la
 * normalizacion de los valores, pero no conoce el cliente de base de datos.
 */
@Injectable()
export class PreferencesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Fila de preferencias de la empresa (`null` si nunca configuro nada). */
  find(companyId: string): Promise<PreferenceRow | null> {
    return this.prisma.companyPreference.findUnique({
      where: { companyId },
      select: PREFERENCES_SELECT,
    });
  }

  /** Crea la fila de la empresa o actualiza la existente (una por empresa). */
  upsert(
    companyId: string,
    create: Prisma.CompanyPreferenceUncheckedCreateInput,
    update: Prisma.CompanyPreferenceUncheckedUpdateInput,
  ): Promise<PreferenceRow> {
    return this.prisma.companyPreference.upsert({
      where: { companyId },
      create,
      update,
      select: PREFERENCES_SELECT,
    });
  }
}
