import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Clave de `Setting` donde vive la configuracion de monedas (JSON). */
export const CURRENCIES_KEY = 'currencies.config';

/**
 * Clave de `Setting` donde vive la moneda base elegida por el local.
 *
 * Los montos del sistema SIEMPRE se guardan en dolares (`baseAmount`): esta
 * clave solo decide en que moneda se muestran primero (tarjetas, listados,
 * reportes). Cuando no existe, la moneda base es USD.
 */
export const BASE_CURRENCY_KEY = 'currencies.base';

/**
 * Acceso a datos de la configuracion de monedas. Toda consulta/escritura de
 * Prisma del modulo vive aqui: el servicio conserva las reglas de negocio
 * (monedas por defecto, tasas, moneda base), pero no conoce el cliente de base
 * de datos.
 */
@Injectable()
export class CurrenciesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Valor guardado de un `Setting` de la empresa (`undefined` si no existe). */
  async findValue(companyId: string, key: string): Promise<string | undefined> {
    const row = await this.prisma.setting.findUnique({
      where: { companyId_key: { companyId, key } },
    });
    return row?.value;
  }

  /** Crea o actualiza un `Setting` de la empresa (quien lo guardo incluido). */
  upsertValue(companyId: string, key: string, value: string, userId?: string) {
    return this.prisma.setting.upsert({
      where: { companyId_key: { companyId, key } },
      update: { value, updatedById: userId },
      create: { companyId, key, value, updatedById: userId },
    });
  }
}
