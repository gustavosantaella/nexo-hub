/**
 * Generacion de codigos legibles/secuenciales para entidades de negocio
 * (pedidos, sesiones de caja, etc). Formato:
 *   PREFIJO-YYYYMMDD-NNNN   ej: "PED-20261013-0007"
 */
export function dateStamp(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/** Rango [inicio, fin) de un dia para filtrar por fecha en Prisma. */
export function dayRange(date: Date = new Date()): { gte: Date; lt: Date } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { gte: start, lt: end };
}

/** Construye el codigo a partir del prefijo, la secuencia y la fecha. */
export function buildCode(
  prefix: string,
  sequence: number,
  date: Date = new Date(),
): string {
  return `${prefix.toUpperCase()}-${dateStamp(date)}-${String(sequence).padStart(4, '0')}`;
}
