/**
 * Utilidades monetarias.
 *
 * El dinero se guarda en la base de datos como un ENTERO de centavos y esta
 * capa es la unica que conoce esa representacion: los servicios, los DTOs, la
 * API y el frontend siguen trabajando con decimales (`194.34`). La conversion
 * ocurre en la frontera de Prisma (`./money-codec.ts`), no en cada llamada.
 *
 * Internamente toda operacion se calcula con enteros de centavos para que no
 * exista error de redondeo (0.1 + 0.2 !== 0.3). Los montos que reciben estas
 * funciones son decimales con 2 cifras, igual que antes.
 *
 * Regla: los valores se normalizan siempre a 2 decimales antes de guardarse o
 * compararse.
 */

/** Decimales del dinero (2) y su factor de escala a centavos (100). */
export const MONEY_DECIMALS = 2;
export const MONEY_SCALE = 100;

/** Tolerancia para comparaciones monetarias (medio centavo). */
export const MONEY_EPSILON = 0.005;

/**
 * Monto (decimal) -> centavos enteros.
 * Conserva exactamente el redondeo historico de `round2` (medio hacia arriba).
 */
export function toCents(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : (value as number);
  if (!Number.isFinite(parsed)) return 0;
  const cents = Math.round((parsed as number + Number.EPSILON) * MONEY_SCALE);
  return cents === 0 ? 0 : cents; // normaliza "-0"
}

/** Centavos enteros -> monto (decimal). */
export function fromCents(cents: number): number {
  return cents / MONEY_SCALE;
}

/** Redondea un numero a 2 decimales de forma segura. */
export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return fromCents(toCents(value));
}

/** Normaliza cualquier entrada (string, null, undefined) a un monto valido. */
export function toMoney(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : (value as number);
  return round2(Number.isFinite(parsed) ? (parsed as number) : 0);
}

/** Redondea una cantidad de centavos (resultado de un producto/division). */
function roundCents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const cents = Math.round(value + Number.EPSILON);
  return cents === 0 ? 0 : cents;
}

export const money = {
  add: (a: number, b: number): number => fromCents(toCents(a) + toCents(b)),
  sub: (a: number, b: number): number => fromCents(toCents(a) - toCents(b)),
  mul: (a: number, b: number, factor = 1): number =>
    fromCents(roundCents(toCents(a) * b * factor)),
  div: (a: number, b: number): number =>
    b === 0 ? 0 : fromCents(roundCents(toCents(a) / b)),
  sum: (values: number[]): number =>
    fromCents(values.reduce((acc, v) => acc + toCents(v), 0)),
};

/** Devuelve true si el monto es efectivamente cero (no llega a un centavo). */
export function isZero(value: number): boolean {
  return toCents(value) === 0;
}

/** Compara dos montos: -1 si a<b, 0 si son iguales, 1 si a>b (exacto). */
export function compareMoney(a: number, b: number): number {
  const diff = toCents(a) - toCents(b);
  if (diff === 0) return 0;
  return diff > 0 ? 1 : -1;
}

/**
 * Tolerancia al cobrar en una moneda distinta de la base: la conversion a
 * bolivares se redondea a 2 decimales, por lo que el equivalente en USD puede
 * quedar una o dos centesimas por encima del saldo pendiente.
 */
export const PAYMENT_TOLERANCE = 0.02;

/**
 * Ajusta un monto convertido al saldo pendiente de una cuenta.
 *
 * Devuelve el monto a aplicar (igualandolo al saldo cuando el exceso es solo
 * redondeo) o `null` cuando el exceso es real y hay que rechazar el cobro.
 */
export function fitToBalance(
  amount: number,
  balance: number,
  tolerance = PAYMENT_TOLERANCE,
): number | null {
  const value = toCents(amount);
  const limit = toCents(balance);
  const excess = value - limit;
  if (excess <= 0) return fromCents(value);
  return excess <= toCents(tolerance) ? fromCents(limit) : null;
}

/**
 * Convierte a centavos los campos de dinero de una lista de objetos que se
 * serializa en JSON dentro de la base (por ejemplo el desglose del fondo en
 * `CashSession.openingLines`, que SQLite guarda como texto).
 *
 * Las tasas de esos objetos (`rate`) no se tocan: no son dinero.
 */
export function moneyFieldsToCents<T>(rows: readonly T[], fields: readonly string[]): T[] {
  return rows.map((row) => {
    const out = { ...(row as Record<string, unknown>) };
    for (const field of fields) {
      if (out[field] !== null && out[field] !== undefined) {
        out[field] = toCents(out[field]);
      }
    }
    return out as T;
  });
}

/** Inverso de `moneyFieldsToCents`: montos en centavos -> decimales. */
export function moneyFieldsFromCents<T>(rows: readonly T[], fields: readonly string[]): T[] {
  return rows.map((row) => {
    const out = { ...(row as Record<string, unknown>) };
    for (const field of fields) {
      const value = out[field];
      if (value === null || value === undefined) continue;
      const parsed = Number(value);
      out[field] = fromCents(Number.isFinite(parsed) ? parsed : 0);
    }
    return out as T;
  });
}
