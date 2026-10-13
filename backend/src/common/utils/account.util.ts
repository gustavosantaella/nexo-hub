import { AccountStatus } from '../constants/enums';
import { buildDateRange } from './date.util';
import { compareMoney, money } from './money.util';

/**
 * Helpers compartidos por cuentas por pagar y por cobrar.
 * El estado de la cuenta SIEMPRE es derivado de los importes: esto evita que
 * quede desincronizado cuando se registran abonos parciales.
 */

/** Deriva PENDING | PARTIAL | PAID a partir de amount/paidAmount. */
export function resolveAccountStatus(
  amount: number,
  paidAmount: number,
  current?: string,
): string {
  if (current === AccountStatus.CANCELLED) return AccountStatus.CANCELLED;
  if (compareMoney(paidAmount, amount) >= 0) return AccountStatus.PAID;
  if (compareMoney(paidAmount, 0) > 0) return AccountStatus.PARTIAL;
  return AccountStatus.PENDING;
}

/** Saldo pendiente (nunca negativo). */
export function accountBalance(amount: number, paidAmount: number): number {
  const balance = money.sub(amount, paidAmount);
  return balance < 0 ? 0 : balance;
}

/**
 * Filtro de rango de fechas. Si `from`/`to` vienen como 'YYYY-MM-DD' se
 * interpretan como fecha local (inicio/fin del dia) para que el rango sea
 * inclusivo y no se desplace un dia por el desfase UTC.
 */
export function buildDateRangeFilter(from?: string, to?: string) {
  return buildDateRange(from, to);
}

/** Inicio del dia (00:00:00.000) para comparaciones de vencimiento. */
export function startOfToday(): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}
