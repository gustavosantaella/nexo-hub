import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Clave de `Setting` donde vive la tasa personalizada (Bs por USD). */
export const CUSTOM_RATE_KEY = 'rates.custom_usd';

/** Tasa personalizada con el usuario que la guardo (para el historial). */
const CUSTOM_RATE_INCLUDE = {
  updatedBy: { select: { name: true } },
} as const;

/**
 * Acceso a datos de tasas. Lo unico que persiste el modulo es la tasa
 * personalizada del local en la tabla `Setting`; todo lo demas (BCV, cache,
 * conversion) es calculo del servicio.
 */
@Injectable()
export class RatesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Lee la tasa personalizada de la empresa (o `null` si no existe). */
  findCustomRateSetting(companyId: string) {
    return this.prisma.setting.findUnique({
      where: { companyId_key: { companyId, key: CUSTOM_RATE_KEY } },
      include: CUSTOM_RATE_INCLUDE,
    });
  }

  /** Borra la tasa personalizada de la empresa. */
  deleteCustomRate(companyId: string) {
    return this.prisma.setting.deleteMany({
      where: { companyId, key: CUSTOM_RATE_KEY },
    });
  }

  /** Guarda (o reemplaza) la tasa personalizada de la empresa. */
  upsertCustomRate(companyId: string, value: string, userId?: string) {
    return this.prisma.setting.upsert({
      where: { companyId_key: { companyId, key: CUSTOM_RATE_KEY } },
      update: { value, updatedById: userId },
      create: { companyId, key: CUSTOM_RATE_KEY, value, updatedById: userId },
    });
  }
}
