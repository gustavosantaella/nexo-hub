import { Injectable } from '@nestjs/common';
import { BASE_CURRENCY_CODE } from '../../common/constants/currencies';
import { parseDateBoundary } from '../../common/utils/date.util';
import { money, toMoney } from '../../common/utils/money.util';
import { CashService } from '../cash/cash.service';
import { PayablesService } from '../payables/payables.service';
import { ReceivablesService } from '../receivables/receivables.service';
import { StatsQueryDto, StatGranularity } from './dto/stats-query.dto';
import { StatsRepository } from './stats.repository';

export interface DateRange {
  from: Date;
  to: Date;
  granularity: StatGranularity;
}

/** Monto de un desglose: en su moneda original y su equivalente en USD. */
export interface CurrencyAmount {
  currency: string;
  amount: number;
  baseAmount: number;
  count: number;
}

/** Fila cruda de un `groupBy` por moneda de Prisma. */
interface CurrencyGroupRow {
  currency: string;
  _sum: { amount: number | null; baseAmount: number | null };
  _count: { _all: number };
}

/**
 * Normaliza las filas de un `groupBy` por moneda: redondea los montos, usa la
 * moneda base cuando el registro no trae una y ordena de mayor a menor por el
 * equivalente en USD (que es el total comparable entre monedas).
 */
function toCurrencyAmounts(rows: CurrencyGroupRow[]): CurrencyAmount[] {
  return rows
    .map((row) => ({
      currency: row.currency || BASE_CURRENCY_CODE,
      amount: toMoney(row._sum.amount ?? 0),
      baseAmount: toMoney(row._sum.baseAmount ?? 0),
      count: row._count._all,
    }))
    .sort((a, b) => b.baseAmount - a.baseAmount);
}

/** Inicio del dia en hora local. */
function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/** Fin del dia en hora local. */
function endOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

/** Lunes de la semana a la que pertenece la fecha. */
function startOfWeek(date: Date) {
  const copy = startOfDay(date);
  const day = copy.getDay(); // 0 = domingo
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  return copy;
}

/** Etiqueta de agrupacion segun granularidad. */
function bucketKey(date: Date, granularity: StatGranularity): string {
  if (granularity === 'month') {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }
  const base = granularity === 'week' ? startOfWeek(date) : startOfDay(date);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
}

@Injectable()
export class StatsService {
  constructor(
    private readonly repository: StatsRepository,
    private readonly cash: CashService,
    private readonly payables: PayablesService,
    private readonly receivables: ReceivablesService,
  ) {}

  /** Normaliza from/to/days/granularity a un rango concreto. */
  resolveRange(query: StatsQueryDto): DateRange {
    // `to`/`from` sin hora se interpretan como fecha local (inicio/fin del dia).
    // Con `new Date('YYYY-MM-DD')` (medianoche UTC) el limite superior caia en
    // el dia anterior en zonas al oeste de UTC y excluia los datos del dia.
    const to = query.to
      ? parseDateBoundary(query.to, 'end')
      : endOfDay(new Date());
    const from = query.from
      ? parseDateBoundary(query.from, 'start')
      : startOfDay(new Date(to.getTime() - (query.days - 1) * 86_400_000));

    const days = Math.max(
      1,
      Math.ceil((to.getTime() - from.getTime()) / 86_400_000),
    );

    const granularity: StatGranularity =
      query.granularity ?? (days <= 31 ? 'day' : days <= 120 ? 'week' : 'month');

    return { from, to, granularity };
  }

  // =========================================================================
  //  VENTAS
  // =========================================================================

  /** Serie temporal de ventas, gastos y utilidad operativa. */
  async salesSeries(companyId: string, query: StatsQueryDto) {
    const range = this.resolveRange(query);

    const [orders, expenses] = await this.repository.findSalesSeriesRows(
      companyId,
      range,
    );

    interface Bucket {
      period: string;
      orders: number;
      sales: number;
      collected: number;
      expenses: number;
      profit: number;
    }
    const buckets = new Map<string, Bucket>();
    const bucketOf = (period: string): Bucket => {
      const existing = buckets.get(period);
      if (existing) return existing;
      const created: Bucket = {
        period,
        orders: 0,
        sales: 0,
        collected: 0,
        expenses: 0,
        profit: 0,
      };
      buckets.set(period, created);
      return created;
    };

    for (const order of orders) {
      const bucket = bucketOf(bucketKey(order.createdAt, range.granularity));
      bucket.orders += 1;
      bucket.sales = money.add(bucket.sales, order.total);
      bucket.collected = money.add(bucket.collected, order.paidAmount);
    }

    for (const expense of expenses) {
      const bucket = bucketOf(bucketKey(expense.date, range.granularity));
      // Los gastos se suman por su equivalente en USD (`baseAmount`); el
      // respaldo cubre registros anteriores al multimoneda.
      const base = expense.baseAmount > 0 ? expense.baseAmount : expense.amount;
      bucket.expenses = money.add(bucket.expenses, base);
    }

    const series = [...buckets.values()]
      .sort((a, b) => a.period.localeCompare(b.period))
      .map((bucket) => ({
        ...bucket,
        profit: money.sub(bucket.sales, bucket.expenses),
      }));

    const totals = series.reduce(
      (acc, bucket) => ({
        orders: acc.orders + bucket.orders,
        sales: money.add(acc.sales, bucket.sales),
        collected: money.add(acc.collected, bucket.collected),
        expenses: money.add(acc.expenses, bucket.expenses),
        profit: money.add(acc.profit, bucket.profit),
      }),
      { orders: 0, sales: 0, collected: 0, expenses: 0, profit: 0 },
    );

    return {
      range: {
        from: range.from,
        to: range.to,
        granularity: range.granularity,
      },
      series,
      totals: {
        ...totals,
        ticketAverage: totals.orders > 0 ? money.div(totals.sales, totals.orders) : 0,
      },
    };
  }

  /** Productos mas vendidos del rango (con utilidad estimada por costo actual). */
  /**
   * Ranking de lo mas vendido en el rango. Incluye los MENUS ademas de los
   * productos sueltos: la venta de un menu se atribuye al menu (no a cada
   * ingrediente), que es lo que el cliente pidio y pago. `type` distingue ambos.
   */
  async topProducts(companyId: string, query: StatsQueryDto) {
    const range = this.resolveRange(query);

    const [productRows, menuRows] = await Promise.all([
      this.repository.findSoldByProduct(companyId, range, query.limit),
      this.repository.findSoldByMenu(companyId, range, query.limit),
    ]);

    const productIds = productRows
      .map((row) => row.productId)
      .filter((id): id is string => !!id);
    const menuIds = menuRows
      .map((row) => row.menuId)
      .filter((id): id is string => !!id);

    const [products, menus] = await Promise.all([
      this.repository.findProductCosts(companyId, productIds),
      this.repository.findMenuCosts(companyId, menuIds),
    ]);

    const productById = new Map(products.map((product) => [product.id, product]));
    const menuById = new Map(menus.map((menu) => [menu.id, menu]));

    const rows = [
      ...productRows.map((row) => {
        const product = productById.get(row.productId!);
        const quantity = row._sum.quantity ?? 0;
        const revenue = toMoney(row._sum.total ?? 0);
        const cost = money.mul(product?.cost ?? 0, quantity);
        return {
          type: 'PRODUCT' as const,
          productId: row.productId,
          menuId: null,
          name: product?.name ?? 'Producto eliminado',
          sku: product?.sku ?? null,
          quantity,
          revenue,
          cost,
          profit: money.sub(revenue, cost),
        };
      }),
      ...menuRows.map((row) => {
        const menu = menuById.get(row.menuId!);
        const quantity = row._sum.quantity ?? 0;
        const revenue = toMoney(row._sum.total ?? 0);
        // El costo del menu ya es el de su receta (una unidad preparada).
        const cost = money.mul(menu?.cost ?? 0, quantity);
        return {
          type: 'MENU' as const,
          productId: null,
          menuId: row.menuId,
          name: menu?.name ?? 'Menu eliminado',
          sku: menu?.code ?? null,
          quantity,
          revenue,
          cost,
          profit: money.sub(revenue, cost),
        };
      }),
    ];

    return rows.sort((a, b) => b.revenue - a.revenue).slice(0, query.limit);
  }

  /** Totales cobrados por metodo de pago. */
  async paymentsByMethod(companyId: string, query: StatsQueryDto) {
    const range = this.resolveRange(query);

    // Se agrupa en la moneda base (USD) para poder sumar/comparar montos
    // cobrados en distintas monedas; el desglose por moneda se expone aparte.
    const grouped = await this.repository.groupPaymentsByMethod(companyId, {
      createdAt: { gte: range.from, lte: range.to },
    });

    const total = money.sum(grouped.map((row) => row._sum.baseAmount ?? 0));

    return {
      total,
      items: grouped
        .map((row) => {
          const amount = toMoney(row._sum.baseAmount ?? 0);
          return {
            method: row.method,
            amount,
            count: row._count._all,
            share: total > 0 ? money.div(amount * 100, total) : 0,
          };
        })
        .sort((a, b) => b.amount - a.amount),
    };
  }

  /**
   * Desglose por moneda de los cobros de pedidos del rango: cuanto entro en
   * cada moneda (monto original) y su equivalente en USD (moneda base).
   */
  async paymentsByCurrency(companyId: string, query: StatsQueryDto) {
    const range = this.resolveRange(query);

    const grouped = await this.repository.groupPaymentsByCurrency(companyId, {
      createdAt: { gte: range.from, lte: range.to },
    });

    const items = grouped
      .map((row) => {
        const currency = row.currency || BASE_CURRENCY_CODE;
        return {
          currency,
          amount: toMoney(row._sum.amount ?? 0),
          baseAmount: toMoney(row._sum.baseAmount ?? 0),
          count: row._count._all,
        };
      })
      .sort((a, b) => b.baseAmount - a.baseAmount);

    return {
      total: money.sum(items.map((item) => item.baseAmount)),
      items,
    };
  }

  /** Ventas agrupadas por categoria de producto. */
  /**
   * Ventas agrupadas por categoria. Los menus se agrupan por su propia categoria
   * de menu; los productos sueltos, por la del producto. Un menu NO se reparte
   * entre las categorias de sus ingredientes: se vendio como un plato.
   */
  async salesByCategory(companyId: string, query: StatsQueryDto) {
    const range = this.resolveRange(query);

    const [productRows, menuRows] = await Promise.all([
      this.repository.findSoldByProduct(companyId, range),
      this.repository.findSoldByMenu(companyId, range),
    ]);

    const productIds = productRows
      .map((row) => row.productId)
      .filter((id): id is string => !!id);
    const menuIds = menuRows
      .map((row) => row.menuId)
      .filter((id): id is string => !!id);

    const [products, menus] = await Promise.all([
      this.repository.findProductCategories(companyId, productIds),
      this.repository.findMenuCategories(companyId, menuIds),
    ]);

    const categoryByProduct = new Map(
      products.map((product) => [
        product.id,
        product.category?.name ?? 'Sin categoria',
      ]),
    );
    const categoryByMenu = new Map(
      menus.map((menu) => [menu.id, menu.category?.name ?? 'Sin categoria']),
    );

    const byCategory = new Map<string, { name: string; quantity: number; revenue: number }>();
    const accumulate = (
      name: string,
      quantity: number,
      revenue: number,
    ): void => {
      const current = byCategory.get(name) ?? { name, quantity: 0, revenue: 0 };
      current.quantity += quantity;
      current.revenue = money.add(current.revenue, revenue);
      byCategory.set(name, current);
    };

    for (const row of productRows) {
      accumulate(
        categoryByProduct.get(row.productId!) ?? 'Sin categoria',
        row._sum.quantity ?? 0,
        toMoney(row._sum.total ?? 0),
      );
    }
    for (const row of menuRows) {
      accumulate(
        categoryByMenu.get(row.menuId!) ?? 'Sin categoria',
        row._sum.quantity ?? 0,
        toMoney(row._sum.total ?? 0),
      );
    }

    const items = [...byCategory.values()].sort(
      (a, b) => b.revenue - a.revenue,
    );
    const total = money.sum(items.map((item) => item.revenue));

    return {
      total,
      items: items.map((item) => ({
        ...item,
        share: total > 0 ? money.div(item.revenue * 100, total) : 0,
      })),
    };
  }

  /**
   * Productos con stock bajo (stock <= minStock). SQLite no permite comparar
   * dos columnas en un `where` de Prisma, por eso se filtra en memoria.
   */
  async lowStockProducts(companyId: string, limit = 20) {
    const products = await this.repository.findLowStockCandidates(companyId);

    return products
      .filter((product) => product.stock <= product.minStock)
      .slice(0, limit);
  }

  /**
   * Tarjetas y resumenes del panel principal (un solo round-trip).
   */
  async dashboard(companyId: string) {
    const now = new Date();
    const todayFrom = startOfDay(now);
    const todayTo = endOfDay(now);
    const monthFrom = startOfDay(
      new Date(now.getFullYear(), now.getMonth(), 1),
    );
    const prevMonthFrom = startOfDay(
      new Date(now.getFullYear(), now.getMonth() - 1, 1),
    );
    const prevMonthTo = endOfDay(
      new Date(now.getFullYear(), now.getMonth(), 0),
    );

    const [
      snapshot,
      lowStock,
      payableBalance,
      receivableBalance,
    ] = await Promise.all([
      this.repository.dashboardSnapshot(companyId, {
        todayFrom,
        todayTo,
        monthFrom,
        prevMonthFrom,
        prevMonthTo,
      }),
      this.lowStockProducts(companyId, 5),
      this.payables.outstandingBalance(companyId),
      this.receivables.outstandingBalance(companyId),
    ]);

    const {
      todayOrders,
      monthOrders,
      prevMonthOrders,
      todayExpenses,
      monthExpenses,
      openSession,
      activeOrders,
      productCount,
      customerCount,
      supplierCount,
      paymentsToday,
      paymentsTodayByCurrency,
      expensesTodayByCurrency,
    } = snapshot;

    const todaySales = toMoney(todayOrders._sum.total ?? 0);
    const todayOrderCount = todayOrders._count._all;
    const todayCollected = toMoney(todayOrders._sum.paidAmount ?? 0);
    const todayExpenseTotal = toMoney(todayExpenses._sum.baseAmount ?? 0);
    const monthSales = toMoney(monthOrders._sum.total ?? 0);
    const monthExpenseTotal = toMoney(monthExpenses._sum.baseAmount ?? 0);
    const prevMonthSales = toMoney(prevMonthOrders._sum.total ?? 0);

    const salesByCurrency = toCurrencyAmounts(paymentsTodayByCurrency);
    const expensesByCurrency = toCurrencyAmounts(expensesTodayByCurrency);

    const breakdown = openSession
      ? this.cash.buildBreakdown(
          openSession.openingAmount,
          // El reparto de propinas necesita leer los pedidos cobrados.
          await this.cash.withTips(companyId, openSession.movements),
        )
      : null;

    return {
      generatedAt: new Date(),
      today: {
        sales: todaySales,
        collected: todayCollected,
        orders: todayOrderCount,
        expenses: todayExpenseTotal,
        profit: money.sub(todaySales, todayExpenseTotal),
        ticketAverage:
          todayOrderCount > 0 ? money.div(todaySales, todayOrderCount) : 0,
      },
      month: {
        sales: monthSales,
        orders: monthOrders._count._all,
        expenses: monthExpenseTotal,
        profit: money.sub(monthSales, monthExpenseTotal),
        growth:
          prevMonthSales > 0
            ? money.div(
                money.mul(money.sub(monthSales, prevMonthSales), 100),
                prevMonthSales,
              )
            : 0,
      },
      cash: openSession
        ? {
            id: openSession.id,
            code: openSession.code,
            openedAt: openSession.openedAt,
            openedBy: openSession.openedBy,
            openingAmount: toMoney(openSession.openingAmount),
            expectedCash: breakdown?.expectedCash ?? 0,
            cashIn: breakdown?.cashIn ?? 0,
            cashOut: breakdown?.cashOut ?? 0,
            /** Ventas del turno sin propinas. */
            salesTotal: breakdown?.salesTotal ?? 0,
            /** Propinas cobradas en el turno (van dentro de los cobros). */
            tipsTotal: breakdown?.tipsTotal ?? 0,
            movementCount: breakdown?.movementCount ?? 0,
            /** Desglose del efectivo por moneda (montos originales + USD). */
            byCurrency: breakdown?.byCurrency ?? [],
          }
        : null,
      activeOrders,
      lowStock: { count: lowStock.length, items: lowStock },
      accounts: {
        payable: payableBalance,
        receivable: receivableBalance,
        net: money.sub(receivableBalance, payableBalance),
      },
      catalog: {
        products: productCount,
        customers: customerCount,
        suppliers: supplierCount,
      },
      paymentsToday: paymentsToday.map((row) => ({
        method: row.method,
        amount: toMoney(row._sum.baseAmount ?? 0),
        count: row._count._all,
      })),
      paymentsTodayByCurrency: paymentsTodayByCurrency.map((row) => ({
        currency: row.currency || BASE_CURRENCY_CODE,
        amount: toMoney(row._sum.amount ?? 0),
        baseAmount: toMoney(row._sum.baseAmount ?? 0),
        count: row._count._all,
      })),
      /**
       * Movimiento del dia por moneda: en que moneda entro o salio el dinero y
       * su equivalente en USD. Los totales van en moneda base (USD) para que el
       * panel pueda mostrar una sola cifra comparable.
       */
      currencies: {
        sales: salesByCurrency,
        expenses: expensesByCurrency,
        totals: {
          sales: todaySales,
          collected: todayCollected,
          expenses: todayExpenseTotal,
          profit: money.sub(todaySales, todayExpenseTotal),
          receivable: receivableBalance,
          payable: payableBalance,
          net: money.sub(receivableBalance, payableBalance),
        },
      },
    };
  }
}

