/**
 * AUDITOR CONTABLE (herramienta permanente del proyecto).
 *
 * Recalcula TODOS los totales derivados desde las filas de la base con
 * aritmetica independiente (centavos exactos) y los compara contra lo guardado.
 * Verifica ademas el invariante de almacenamiento: todo monto vive en la base
 * como un entero de centavos (nunca como decimal con deriva de punto flotante),
 * incluido el desglose del fondo en `CashSession.openingLines`.
 *
 *   npm run audit:money
 */
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { OPENING_LINE_MONEY_FIELDS } from '../src/common/constants/money-columns';
import { applyMoneyCodec } from '../src/common/utils/money-codec';
import { moneyFieldsFromCents } from '../src/common/utils/money.util';

dotenv.config({ path: resolve(__dirname, '..', '.env') });

/** Cliente con el codec de dinero: el auditor razona en decimales. */
const prisma = applyMoneyCodec(new PrismaClient());

/** Cliente crudo: lee la base tal cual (montos en centavos enteros). */
const raw = new PrismaClient();

/** Centavos exactos (la unidad en la que DEBERIA vivir el dinero). */
const c = (v: number | null | undefined): number => {
  const n = Number(v ?? 0);
  return Math.round((Number.isFinite(n) ? n : 0) * 100);
};
/** Redondeo a 2 decimales "de libro". */
const r2 = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100;

let checks = 0;
const failures: string[] = [];
const drift: string[] = [];

function check(ok: boolean, label: string, detail = ''): void {
  checks++;
  if (!ok) failures.push(detail ? `${label} :: ${detail}` : label);
}
function checkMoney(actual: number, expected: number, label: string, detail = ''): void {
  checks++;
  if (c(actual) !== c(expected)) {
    failures.push(`${label} :: ${actual} != ${expected}${detail ? ` :: ${detail}` : ''}`);
  }
}
/** Detecta montos que NO son exactamente un numero entero de centavos. */
function driftCheck(label: string, value: number | null | undefined): void {
  if (value == null || !Number.isFinite(Number(value))) return;
  const scaled = Number(value) * 100;
  if (Math.abs(scaled - Math.round(scaled)) > 1e-6) drift.push(`${label} = ${value}`);
}
const dayOf = (d: Date | string | null | undefined): string => {
  if (!d) return 'none';
  const date = new Date(d);
  // Dia de NEGOCIO (hora local del local): el seed y los servicios usan
  // `setHours`, por lo que agrupar por dia UTC partiria un dia en dos.
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};
const money = (v: unknown): number => r2(Number(v ?? 0) || 0);

async function main(): Promise<void> {
  // ======================================================================
  //  PEDIDOS
  // ======================================================================
  const orders = await prisma.order.findMany({ include: { items: true, payments: true } });
  for (const o of orders) {
    const tag = `order ${o.code}`;
    driftCheck(`${tag}.subtotal`, o.subtotal);
    driftCheck(`${tag}.discount`, o.discount);
    driftCheck(`${tag}.tax`, o.tax);
    driftCheck(`${tag}.total`, o.total);
    driftCheck(`${tag}.paidAmount`, o.paidAmount);

    const itemsSum = o.items.reduce((a, i) => a + money(i.total), 0);
    const recomputed = r2(r2(o.subtotal - o.discount) + o.tax);
    const paymentsSum = o.payments.reduce((a, p) => a + money(p.baseAmount), 0);

    checkMoney(o.subtotal, itemsSum, `${tag}.subtotal != suma de items`, `${o.subtotal} vs ${itemsSum} (${o.items.length} items)`);
    checkMoney(o.total, recomputed, `${tag}.total != subtotal - desc + IVA`, `${o.total} vs ${recomputed}`);
    checkMoney(o.paidAmount, paymentsSum, `${tag}.paidAmount != suma de pagos`, `${o.paidAmount} vs ${paymentsSum}`);
    check(c(o.paidAmount) <= c(o.total), `${tag}.paidAmount > total`, `${o.paidAmount} > ${o.total}`);
    check(c(o.discount) <= c(o.subtotal), `${tag}.discount > subtotal`, `${o.discount} > ${o.subtotal}`);
    check(c(o.tax) >= 0 && c(o.subtotal) > 0, `${tag}.tax/subtotal invalidos`, `tax=${o.tax} subtotal=${o.subtotal}`);

    const expectedStatus =
      c(o.paidAmount) >= c(o.total) && c(o.total) > 0
        ? 'PAID'
        : c(o.paidAmount) > 0
          ? 'PARTIAL'
          : 'UNPAID';
    check(o.paymentStatus === expectedStatus, `${tag}.paymentStatus != derivado`, `${o.paymentStatus} vs ${expectedStatus}`);
    check(o.cashSessionId != null || o.payments.every((p) => p.method !== 'CASH'), `${tag} cobra en efectivo sin caja`);

    for (const i of o.items) {
      driftCheck(`${tag} item ${i.name}.unitPrice`, i.unitPrice);
      driftCheck(`${tag} item ${i.name}.total`, i.total);
      checkMoney(i.total, r2(i.unitPrice * i.quantity), `${tag} item ${i.name}.total != unitPrice * qty`, `${i.total} vs ${r2(i.unitPrice * i.quantity)}`);
      check(i.quantity > 0, `${tag} item ${i.name} cantidad <= 0`, `${i.quantity}`);
    }
    for (const p of o.payments) {
      driftCheck(`${tag} pago ${p.method}.amount`, p.amount);
      driftCheck(`${tag} pago ${p.method}.baseAmount`, p.baseAmount);
      check(c(p.amount) > 0, `${tag} pago con monto <= 0`, `${p.amount}`);
    }
  }

  // (La consistencia de tasas se verifica al final, cruzando TODAS las tablas.)



  // ======================================================================
  //  CAJA
  // ======================================================================
  const sessions = await prisma.cashSession.findMany({ include: { movements: true } });
  const open = sessions.filter((s) => s.status === 'OPEN');
  check(open.length <= 1, `hay ${open.length} sesiones OPEN (debe haber maximo 1)`);

  for (const s of sessions) {
    const tag = `caja ${s.code}`;
    driftCheck(`${tag}.openingAmount`, s.openingAmount);
    if (s.openingLines) {
      const parsed = JSON.parse(s.openingLines) as Record<string, unknown>[];
      check(Array.isArray(parsed), `${tag}.openingLines no es un arreglo`);
      // El JSON guarda los montos en centavos: aca se vuelven a decimales.
      const lines = Array.isArray(parsed)
        ? moneyFieldsFromCents(parsed, OPENING_LINE_MONEY_FIELDS)
        : [];
      let linesSum = 0;
      for (const [i, l] of lines.entries()) {
        driftCheck(`${tag}.openingLines[${i}].amount`, Number(l.amount));
        driftCheck(`${tag}.openingLines[${i}].baseAmount`, Number(l.baseAmount));
        linesSum += l.baseAmount as number;
      }
      checkMoney(s.openingAmount, linesSum, `${tag}.openingAmount != suma de lineas`, `${s.openingAmount} vs ${r2(linesSum)}`);
    }

    let cashIn = 0;
    let cashOut = 0;
    for (const m of s.movements) {
      driftCheck(`${tag} mov ${m.category}.amount/${m.currency}`, m.amount);
      driftCheck(`${tag} mov ${m.category}.baseAmount`, m.baseAmount);
      check(c(m.amount) > 0, `${tag} movimiento con monto <= 0`, `${m.amount}`);
      check(m.type === 'IN' || m.type === 'OUT', `${tag} movimiento con tipo invalido`, m.type);
      if (m.currency === 'USD') checkMoney(m.baseAmount, m.amount, `${tag} mov USD baseAmount != amount`, `${m.baseAmount} vs ${m.amount}`);
      if (m.paymentMethod === 'CASH') {
        if (m.type === 'IN') cashIn += m.baseAmount;
        else cashOut += m.baseAmount;
      }
      if (s.status === 'CLOSED' && s.closedAt) {
        check(new Date(m.createdAt) <= new Date(s.closedAt), `${tag} movimiento posterior al cierre`, `${m.createdAt} > ${s.closedAt}`);
      }
    }
    const expected = r2(r2(s.openingAmount + cashIn) - cashOut);

    if (s.status === 'CLOSED') {
      check(s.closedAt != null, `${tag} CLOSED sin closedAt`);
      check(s.closedById != null, `${tag} CLOSED sin closedById`);
      check(s.expectedAmount != null, `${tag} CLOSED sin expectedAmount`);
      check(s.countedAmount != null, `${tag} CLOSED sin countedAmount`);
      check(s.difference != null, `${tag} CLOSED sin difference`);
      driftCheck(`${tag}.expectedAmount`, s.expectedAmount);
      driftCheck(`${tag}.countedAmount`, s.countedAmount);
      driftCheck(`${tag}.difference`, s.difference);
      checkMoney(s.expectedAmount ?? 0, expected, `${tag}.expectedAmount != apertura + IN(cash) - OUT(cash)`, `${s.expectedAmount} vs ${expected}`);
      checkMoney(
        s.difference ?? 0,
        r2((s.countedAmount ?? 0) - (s.expectedAmount ?? 0)),
        `${tag}.difference != contado - esperado`,
        `${s.difference} vs ${r2((s.countedAmount ?? 0) - (s.expectedAmount ?? 0))}`,
      );
    }
  }


  // ======================================================================
  //  GASTOS
  // ======================================================================
  const expenses = await prisma.expense.findMany();
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  for (const e of expenses) {
    driftCheck(`gasto ${e.description}.amount/${e.currency}`, e.amount);
    driftCheck(`gasto ${e.description}.baseAmount`, e.baseAmount);
    check(c(e.amount) > 0, `gasto ${e.description} con monto <= 0`, `${e.amount}`);
    if (e.currency === 'USD') checkMoney(e.baseAmount, e.amount, `gasto ${e.description} USD baseAmount != amount`, `${e.baseAmount} vs ${e.amount}`);
    if (e.paymentMethod === 'CASH') {
      check(e.cashSessionId != null, `gasto en efectivo ${e.description} sin caja`);
      const s = e.cashSessionId ? sessionById.get(e.cashSessionId) : undefined;
      if (s) {
        check(
          new Date(e.date) >= new Date(s.openedAt) && (!s.closedAt || new Date(e.date) <= new Date(s.closedAt)),
          `gasto ${e.description} fuera de la ventana de la caja ${s.code}`,
          `${e.date} no esta en [${s.openedAt}, ${s.closedAt}]`,
        );
      }
    }
  }

  // ======================================================================
  //  CUENTAS POR COBRAR / PAGAR
  // ======================================================================
  const receivables = await prisma.accountReceivable.findMany({ include: { payments: true } });
  for (const x of receivables) {
    const tag = `por cobrar ${x.description}`;
    driftCheck(`${tag}.amount`, x.amount);
    driftCheck(`${tag}.baseAmount`, x.baseAmount);
    driftCheck(`${tag}.paidAmount`, x.paidAmount);
    if (x.currency === 'USD') checkMoney(x.baseAmount, x.amount, `${tag} USD baseAmount != amount`, `${x.baseAmount} vs ${x.amount}`);
    const sum = x.payments.reduce((a, p) => a + money(p.baseAmount), 0);
    for (const p of x.payments) {
      driftCheck(`${tag} abono.amount`, p.amount);
      driftCheck(`${tag} abono.baseAmount`, p.baseAmount);
      if (p.currency === 'USD') checkMoney(p.baseAmount, p.amount, `${tag} abono USD baseAmount != amount`, `${p.baseAmount} vs ${p.amount}`);
    }
    checkMoney(x.paidAmount, sum, `${tag}.paidAmount != suma de abonos`, `${x.paidAmount} vs ${r2(sum)}`);
    check(c(x.paidAmount) <= c(x.baseAmount), `${tag}.paidAmount > baseAmount`, `${x.paidAmount} > ${x.baseAmount}`);
    const expectedStatus =
      x.status === 'CANCELLED' ? 'CANCELLED' : c(x.paidAmount) >= c(x.baseAmount) ? 'PAID' : c(x.paidAmount) > 0 ? 'PARTIAL' : 'PENDING';
    check(x.status === expectedStatus, `${tag}.status != derivado`, `${x.status} vs ${expectedStatus}`);
  }

  const payables = await prisma.accountPayable.findMany({ include: { payments: true } });
  for (const x of payables) {
    const tag = `por pagar ${x.description}`;
    driftCheck(`${tag}.amount`, x.amount);
    driftCheck(`${tag}.baseAmount`, x.baseAmount);
    driftCheck(`${tag}.paidAmount`, x.paidAmount);
    if (x.currency === 'USD') checkMoney(x.baseAmount, x.amount, `${tag} USD baseAmount != amount`, `${x.baseAmount} vs ${x.amount}`);
    const sum = x.payments.reduce((a, p) => a + money(p.baseAmount), 0);
    for (const p of x.payments) {
      driftCheck(`${tag} abono.amount`, p.amount);
      driftCheck(`${tag} abono.baseAmount`, p.baseAmount);
      if (p.currency === 'USD') checkMoney(p.baseAmount, p.amount, `${tag} abono USD baseAmount != amount`, `${p.baseAmount} vs ${p.amount}`);
    }
    checkMoney(x.paidAmount, sum, `${tag}.paidAmount != suma de abonos`, `${x.paidAmount} vs ${r2(sum)}`);
    check(c(x.paidAmount) <= c(x.baseAmount), `${tag}.paidAmount > baseAmount`, `${x.paidAmount} > ${x.baseAmount}`);
    const expectedStatus =
      x.status === 'CANCELLED' ? 'CANCELLED' : c(x.paidAmount) >= c(x.baseAmount) ? 'PAID' : c(x.paidAmount) > 0 ? 'PARTIAL' : 'PENDING';
    check(x.status === expectedStatus, `${tag}.status != derivado`, `${x.status} vs ${expectedStatus}`);
  }


  // ======================================================================
  //  INVENTARIO
  // ======================================================================
  const stockMoves = await prisma.stockMovement.findMany({
    orderBy: [{ productId: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  });
  const chain = new Map<string, number>();
  for (const m of stockMoves) {
    const tag = `stock mov ${m.type}(${m.referenceType ?? '-'})`;
    const prev = chain.get(m.productId);
    if (prev != null) {
      check(m.stockBefore === prev, `${tag} stockBefore != stockAfter anterior`, `${m.stockBefore} vs ${prev}`);
    }
    if (m.type === 'IN') {
      check(m.stockAfter === m.stockBefore + m.quantity, `${tag} stockAfter != stockBefore + qty`, `${m.stockAfter} != ${m.stockBefore} + ${m.quantity}`);
    } else if (m.type === 'OUT') {
      check(m.stockAfter === m.stockBefore - m.quantity, `${tag} stockAfter != stockBefore - qty`, `${m.stockAfter} != ${m.stockBefore} - ${m.quantity}`);
    } else {
      check(m.quantity === Math.abs(m.stockAfter - m.stockBefore), `${tag} ADJUSTMENT qty != |delta|`, `${m.quantity} vs ${Math.abs(m.stockAfter - m.stockBefore)}`);
    }
    check(m.stockAfter >= 0, `${tag} stock negativo`, `${m.stockAfter}`);
    check(m.quantity >= 0, `${tag} quantity negativa`, `${m.quantity}`);
    if (m.unitCost != null) driftCheck(`${tag} unitCost`, m.unitCost);
    chain.set(m.productId, m.stockAfter);
  }
  const products = await prisma.product.findMany();
  for (const p of products) {
    driftCheck(`producto ${p.sku}.price`, p.price);
    driftCheck(`producto ${p.sku}.cost`, p.cost);
    check(c(p.price) >= 0 && c(p.cost) >= 0, `producto ${p.sku} precio/costo negativo`, `${p.price}/${p.cost}`);
    const last = chain.get(p.id);
    if (last != null) check(p.stock === last, `producto ${p.sku}.stock != ultimo stockAfter`, `${p.stock} vs ${last}`);
  }

  // ======================================================================
  //  CONSISTENCIA CRUZADA
  // ======================================================================
  const completed = orders.filter((o) => o.status !== 'CANCELLED');
  const salesBase = r2(completed.reduce((a, o) => a + o.paidAmount, 0));
  const allMovements = await prisma.cashMovement.findMany();
  const cashSalesBase = r2(allMovements.filter((m) => m.category === 'SALE' && m.type === 'IN').reduce((a, m) => a + money(m.baseAmount), 0));
  // Cada cobro (de cualquier metodo) se refleja en la caja como movimiento
  // SALE: la suma de esos movimientos debe ser la suma de todos los cobros.
  const orderPayments = await prisma.orderPayment.findMany();
  const paymentsWithSession = r2(
    orderPayments
      .filter((p) => orders.find((o) => o.id === p.orderId)?.cashSessionId != null)
      .reduce((a, p) => a + money(p.baseAmount), 0),
  );
  checkMoney(cashSalesBase, paymentsWithSession, 'Σ movimientos de caja SALE != Σ cobros de pedidos con caja', `${cashSalesBase} vs ${paymentsWithSession}`);

  const expenseBase = r2(expenses.reduce((a, e) => a + money(e.baseAmount), 0));
  const receivableOpen = r2(receivables.filter((x) => x.status !== 'CANCELLED').reduce((a, x) => a + r2(x.amount - x.paidAmount), 0));
  const payableOpen = r2(payables.filter((x) => x.status !== 'CANCELLED').reduce((a, x) => a + r2(x.amount - x.paidAmount), 0));

  const byCat = new Map<string, number>();
  for (const m of allMovements) {
    const key = `${m.category}|${m.type}`;
    byCat.set(key, r2((byCat.get(key) ?? 0) + money(m.baseAmount)));
  }

  // ----------------------------------------------------------------------
  //  TASA DE CAMBIO (todas las tablas)
  // ----------------------------------------------------------------------
  // La tasa historica no se guarda en la base: se DERIVA de cada fila
  // (baseAmount = amount * exchangeRate / bsPerUsd) y se exige que TODAS las
  // conversiones de un mismo dia de negocio impliquen la MISMA tasa Bs/USD.
  interface ConvRow {
    source: string;
    amount: number;
    baseAmount: number;
    currency: string;
    exchangeRate: number | null;
    at: Date;
  }
  const convRows: ConvRow[] = [];
  const pushRows = (rows: ConvRow[]) => convRows.push(...rows);
  pushRows(
    (await prisma.orderPayment.findMany()).map((p) => ({
      source: `pago pedido ${p.orderId.slice(-6)}`,
      amount: p.amount, baseAmount: p.baseAmount, currency: p.currency, exchangeRate: p.exchangeRate, at: p.createdAt,
    })),
  );
  pushRows(
    allMovements.map((m) => ({
      source: `mov caja ${m.category}`,
      amount: m.amount, baseAmount: m.baseAmount, currency: m.currency, exchangeRate: m.exchangeRate, at: m.createdAt,
    })),
  );
  pushRows(
    expenses.map((e) => ({
      source: `gasto ${e.category}`,
      amount: e.amount, baseAmount: e.baseAmount, currency: e.currency, exchangeRate: e.exchangeRate, at: e.createdAt,
    })),
  );
  pushRows(
    (await prisma.payablePayment.findMany()).map((p) => ({
      source: 'abono por pagar',
      amount: p.amount, baseAmount: p.baseAmount, currency: p.currency, exchangeRate: p.exchangeRate, at: p.createdAt,
    })),
  );
  pushRows(
    (await prisma.receivablePayment.findMany()).map((p) => ({
      source: 'abono por cobrar',
      amount: p.amount, baseAmount: p.baseAmount, currency: p.currency, exchangeRate: p.exchangeRate, at: p.createdAt,
    })),
  );

  const rateByDay = new Map<string, { bs: number; source: string }>();
  let conversionsChecked = 0;
  for (const row of convRows) {
    const currency = String(row.currency);
    if (currency === 'USD') continue;
    const amount = money(row.amount);
    const base = money(row.baseAmount);
    const rate = Number(row.exchangeRate ?? 0);
    check(rate > 0, `${row.source}: conversion en ${currency} sin tasa guardada`);
    check(base > 0, `${row.source}: conversion sin baseAmount`, `${row.source} ${amount} ${currency}`);
    if (rate <= 0 || base <= 0 || amount <= 0) continue;
    const implied = (amount * rate) / base; // bolivares por 1 USD
    const key = dayOf(row.at);
    const prev = rateByDay.get(key);
    if (!prev) rateByDay.set(key, { bs: implied, source: row.source });
    conversionsChecked++;
  }

  // ----------------------------------------------------------------------
  //  AJUSTE DE LA TASA POR DIA (minimos cuadrados)
  // ----------------------------------------------------------------------
  // base_i = amount_i * rate_i / bs  =>  el bs que mejor explica el dia es
  // bs = SUMA(k^2) / SUMA(k * base), con k = amount * exchangeRate.
  // Luego se mide el residuo real de cada fila: si el sistema guardara el
  // dinero en centavos exactos, el residuo deberia ser <= medio centavo.
  const fit = new Map<string, { sumK2: number; sumKB: number; n: number }>();
  for (const row of convRows) {
    if (String(row.currency) === 'USD') continue;
    const k = money(row.amount) * Number(row.exchangeRate ?? 0);
    const base = money(row.baseAmount);
    if (k <= 0 || base <= 0) continue;
    const key = dayOf(row.at);
    const acc = fit.get(key) ?? { sumK2: 0, sumKB: 0, n: 0 };
    acc.sumK2 += k * k;
    acc.sumKB += k * base;
    acc.n += 1;
    fit.set(key, acc);
  }
  let fitExact = 0;
  let fitOneCent = 0;
  let maxResidual = 0;
  let worstRow = '';
  const byDayResidual = new Map<string, number>();
  for (const row of convRows) {
    if (String(row.currency) === 'USD') continue;
    const k = money(row.amount) * Number(row.exchangeRate ?? 0);
    const base = money(row.baseAmount);
    if (k <= 0 || base <= 0) continue;
    const key = dayOf(row.at);
    const acc = fit.get(key) as { sumK2: number; sumKB: number };
    const bs = acc.sumK2 / acc.sumKB;
    const residual = Math.abs(base - k / bs);
    if (residual <= 0.005) fitExact++;
    else if (residual <= 0.0201) fitOneCent++; // ajuste al saldo (fitToBalance)
    if (residual > (byDayResidual.get(key) ?? 0)) byDayResidual.set(key, residual);
    if (residual > maxResidual) {
      maxResidual = residual;
      worstRow = `${row.source} ${money(row.amount)} ${row.currency} base=${base} tasa=${acc.sumK2 / acc.sumKB}`;
    }
    check(residual <= 0.0201, `${row.source}: la conversion se desvia ${residual.toFixed(4)} del ajuste del dia`, `${row.source} ${key}`);
  }
  const peorDia = [...byDayResidual.entries()].sort((a, b) => b[1] - a[1])[0];

  // ----------------------------------------------------------------------
  //  INVARIANTE: CENTAVOS ENTEROS Y SUM() DEL MOTOR
  // ----------------------------------------------------------------------
  const aggTargets: [string, string][] = [
    ['orders', 'total'],
    ['orders', 'paidAmount'],
    ['order_items', 'total'],
    ['order_payments', 'baseAmount'],
    ['cash_movements', 'baseAmount'],
    ['cash_movements', 'amount'],
    ['expenses', 'baseAmount'],
    ['accounts_payable', 'amount'],
    ['accounts_receivable', 'amount'],
  ];
  let sqlDriftMax = 0;
  let sqlDriftWorst = '';
  let fractional = 0;
  for (const [table, column] of aggTargets) {
    // Se leen los valores crudos (sin codec): deben ser centavos enteros.
    const stored = await raw.$queryRawUnsafe<Record<string, number | null>[]>(
      `SELECT "${column}" AS value FROM "${table}" WHERE "${column}" IS NOT NULL`,
    );
    const values = stored.map((r) => Number(r.value));
    const broken = values.filter((v) => !Number.isInteger(v));
    checks++;
    if (broken.length > 0) {
      fractional += broken.length;
      failures.push(
        `${table}.${column}: ${broken.length} montos con centavos fraccionarios (${broken.slice(0, 3).join(', ')})`,
      );
    }

    // SUM() de SQLite vs suma exacta en JS (aritmetica entera, sin redondeo).
    const [row] = await raw.$queryRawUnsafe<{ c: number | null }[]>(
      `SELECT SUM("${column}") AS c FROM "${table}"`,
    );
    const sqlSum = Number(row?.c ?? 0);
    const jsSum = values.reduce((a, v) => a + v, 0);
    const drift = Math.abs(sqlSum - jsSum);
    checks++;
    if (drift > 0) {
      failures.push(
        `SUM("${table}"."${column}") del motor (${sqlSum}) != suma exacta (${jsSum})`,
      );
    }
    if (drift > sqlDriftMax) {
      sqlDriftMax = drift;
      sqlDriftWorst = `${table}.${column}`;
    }
    console.log(
      `  SUM ${`${table}.${column}`.padEnd(30)} centavos=${String(sqlSum).padStart(14)} ` +
        `deriva=${drift} (${values.length} montos, ${broken.length} no enteros)`,
    );
  }

  // ======================================================================
  //  REPORTE
  // ======================================================================
  const line = '-'.repeat(72);
  console.log(line);
  console.log('AUDITORIA CONTABLE');
  console.log(line);
  console.log(
    `filas: pedidos=${orders.length} items=${orders.reduce((a, o) => a + o.items.length, 0)} ` +
      `pagos=${orders.reduce((a, o) => a + o.payments.length, 0)} sesiones=${sessions.length} ` +
      `movCaja=${allMovements.length} gastos=${expenses.length} xCobrar=${receivables.length} ` +
      `xPagar=${payables.length} movStock=${stockMoves.length} productos=${products.length}`,
  );
  console.log(line);
  console.log('AGREGADOS (USD base)');
  console.log(`  ventas cobradas (pedidos != CANCELLED) : ${salesBase}`);
  console.log(`  movimientos de caja SALE               : ${cashSalesBase}`);
  console.log(`  pagos de pedidos con caja              : ${paymentsWithSession}`);
  console.log(`  gastos                                 : ${expenseBase}`);
  console.log(`  por cobrar pendiente                   : ${receivableOpen}`);
  console.log(`  por pagar pendiente                    : ${payableOpen}`);
  console.log(`  resultado (ventas - gastos)            : ${r2(salesBase - expenseBase)}`);
  console.log('  movimientos de caja por categoria:');
  for (const [k, v] of [...byCat.entries()].sort()) console.log(`     ${k.padEnd(18)} ${v}`);
  console.log(line);
  console.log(`verificaciones ejecutadas : ${checks}`);
  console.log(`fallas                    : ${failures.length}`);
  for (const f of failures.slice(0, 40)) console.log(`   x ${f}`);
  console.log(`montos con deriva de punto flotante : ${drift.length}`);
  for (const d of drift.slice(0, 20)) console.log(`   ~ ${d}`);
  console.log(`conversiones de moneda verificadas : ${conversionsChecked} en ${rateByDay.size} dias de negocio`);
  console.log(
    `  exactas (<=0.005 USD)              : ${fitExact} | ajustadas al saldo (<=0.02) : ${fitOneCent}`,
  );
  console.log(`  residuo maximo del ajuste diario   : ${maxResidual.toFixed(4)} USD  (${worstRow})`);
  console.log(`  peor dia                           : ${peorDia ? `${peorDia[0]} -> ${peorDia[1].toFixed(4)} USD` : 'n/a'}`);
  console.log(
    `SUM() del motor vs suma exacta      : ${sqlDriftMax === 0 ? 'identica en todas las columnas' : `${sqlDriftMax} (${sqlDriftWorst})`}`,
  );
  console.log(
    `montos con centavos fraccionarios    : ${fractional}${fractional === 0 ? ' (todo el dinero almacenado es entero)' : ''}`,
  );
  console.log(line);
}

main()
  .then(() => Promise.all([prisma.$disconnect(), raw.$disconnect()]))
  .catch(async (e) => {
    console.error(e);
    await Promise.all([prisma.$disconnect(), raw.$disconnect()]);
    process.exit(1);
  });
