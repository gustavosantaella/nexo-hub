/**
 * Mensajes de error compartidos entre modulos.
 *
 * Se devuelven como texto plano en espanol (sin acentos, como el resto del
 * backend) y con un CODE estable: el frontend puede distinguirlos sin comparar
 * cadenas de texto.
 */

/** Empresa pendiente de revision (todavia no activada por el equipo). */
export const COMPANY_UNDER_REVIEW_CODE = 'COMPANY_UNDER_REVIEW';

/**
 * Aviso mostrado al intentar entrar con una empresa que aun no fue activada:
 * ni el login ni el cambio de empresa emiten token para ella.
 */
export const COMPANY_UNDER_REVIEW_MESSAGE =
  'Su empresa aun sigue estando en revision. por favor espere a que lo contactemos';

/** Cuerpo del error 403 de empresa en revision (mensaje + codigo estable). */
export function companyUnderReviewError(): {
  message: string;
  code: string;
} {
  return {
    message: COMPANY_UNDER_REVIEW_MESSAGE,
    code: COMPANY_UNDER_REVIEW_CODE,
  };
}
