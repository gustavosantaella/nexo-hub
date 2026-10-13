/**
 * Utilidades de rango de fechas.
 *
 * Los filtros llegan del cliente como fechas `YYYY-MM-DD` (input type=date).
 * `new Date('YYYY-MM-DD')` las interpreta como medianoche UTC, por lo que en
 * zonas horarias al oeste de UTC (p. ej. UTC-4 / UTC-5) esa medianoche cae en el
 * dia anterior en hora local. Si despues se aplica `setHours(23, 59, ...)` para
 * el limite superior, el rango termina un dia antes y excluye los datos del dia
 * solicitado (bug tipico del filtro "Hoy").
 *
 * Estas funciones interpretan una fecha sin hora como fecha *local*, de modo
 * que el rango cubra exactamente el dia que ve el usuario. Un ISO con hora o
 * desfase (p. ej. `2026-10-13T10:00:00Z`) se respeta tal cual.
 */

/** Coincide con una fecha sin hora: `YYYY-MM-DD`. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Limite del dia para un valor de fecha. `edge` = `'start'` da 00:00:00.000 y
 * `'end'` da 23:59:59.999 en hora local cuando el valor no trae hora.
 */
export function parseDateBoundary(value: string, edge: 'start' | 'end'): Date {
  if (DATE_ONLY.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return edge === 'start'
      ? new Date(year, month - 1, day, 0, 0, 0, 0)
      : new Date(year, month - 1, day, 23, 59, 59, 999);
  }
  return new Date(value);
}

/**
 * Rango inclusivo `{ gte, lte }` a partir de fechas `YYYY-MM-DD` (o ISO con
 * hora). Cada limite solo se incluye cuando su valor fue enviado.
 */
export function buildDateRange(
  from?: string | null,
  to?: string | null,
): { gte?: Date; lte?: Date } {
  const range: { gte?: Date; lte?: Date } = {};
  if (from) range.gte = parseDateBoundary(from, 'start');
  if (to) range.lte = parseDateBoundary(to, 'end');
  return range;
}
