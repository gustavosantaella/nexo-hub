import { UnauthorizedException } from '@nestjs/common';

/**
 * El sistema es multi-empresa: cada consulta de dominio debe filtrar por la
 * empresa activa. Estos helpers evitan repetir el literal `{ companyId }` y
 * dejan claro en cada `where` que el filtro es de aislamiento entre empresas.
 */

/** Filtro de Prisma que aísla los datos de una empresa. */
export function tenantWhere(companyId: string): { companyId: string } {
  return { companyId };
}

/**
 * El `companyId` siempre viene del token (nunca del cliente). Si falta es que
 * la sesion no tiene empresa activa y no se debe poder leer/escribir nada.
 */
export function requireCompany(
  companyId: string | undefined | null,
): string {
  if (!companyId) {
    throw new UnauthorizedException(
      'La sesion no tiene una empresa activa. Inicia sesion de nuevo.',
    );
  }
  return companyId;
}
