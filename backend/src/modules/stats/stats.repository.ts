import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { CashSessionStatus, OrderStatus } from '../../common/constants/enums';
import { tenantWhere } from '../../common/utils/tenant.util';
import { PrismaService } from '../../prisma/prisma.service';

/** Ventana de fechas ya resuelta con la que se consultan los reportes. */
export interface DateWindow {
  from: Date;
  to: Date;
}

/** Limites de los periodos que compara el panel principal. */
export interface DashboardWindows {
  todayFrom: Date;
  todayTo: Date;
  monthFrom: Date;
  prevMonthFrom: Date;
  prevMonthTo: Date;
}

/** Estados de pedido que cuentan como venta efectiva. */
const SALE_STATUSES = [OrderStatus.COMPLETED];

/** Estados de pedido que siguen abiertos en el tablero operativo. */
const ACTIVE_ORDER_STATUSES = [
  OrderStatus.PENDING,
  OrderStatus.CONFIRMED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
];

/** Columnas de un producto con stock bajo (el minimo se compara en memoria). */
const LOW_STOCK_SELECT = {
  id: true,
  sku: true,
  name: true,
  stock: true,
  minStock: true,
  unit: true,
} satisfies Prisma.ProductSelect;

/**
 * Acceso a datos de los reportes y del panel principal. Toda consulta de
 * Prisma del modulo vive aqui: el servicio conserva el calculo de los totales,
 * la agrupacion por periodo y las reglas de negocio, pero no conoce el cliente
 * de base de datos.
 */
@Injectable()
export class StatsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ===================== Filtros compartidos ================================

  /** Pedidos que cuentan como venta dentro del rango. */
  private salesWhere(
    companyId: string,
    window: DateWindow,
  ): Prisma.OrderWhereInput {
    return {
      ...tenantWhere(companyId),
      status: { in: SALE_STATUSES },
      createdAt: { gte: window.from, lte: window.to },
    };
  }

  /** Lineas de pedido vendidas dentro del rango. */
  private soldItemsWhere(
    companyId: string,
    window: DateWindow,
  ): Prisma.OrderItemWhereInput {
    return {
      ...tenantWhere(companyId),
      order: {
        status: { in: SALE_STATUSES },
        createdAt: { gte: window.from, lte: window.to },
      },
    };
  }

  // ============================ Ventas =====================================

  /** Pedidos vendidos y gastos del rango, en una sola transaccion. */
  findSalesSeriesRows(companyId: string, window: DateWindow) {
    return this.prisma.$transaction([
      this.prisma.order.findMany({
        where: this.salesWhere(companyId, window),
        select: { total: true, paidAmount: true, createdAt: true },
      }),
      this.prisma.expense.findMany({
        where: {
          date: { gte: window.from, lte: window.to },
          ...tenantWhere(companyId),
        },
        select: { amount: true, baseAmount: true, date: true },
      }),
    ]);
  }

  /**
   * Cantidad y monto vendidos por producto dentro del rango. Con `take` se pide
   * el ranking (los mas vendidos primero) para la lista de mas vendidos.
   */
  findSoldByProduct(companyId: string, window: DateWindow, take?: number) {
    return this.prisma.orderItem.groupBy({
      by: ['productId'],
      where: {
        ...this.soldItemsWhere(companyId, window),
        productId: { not: null },
      },
      ...(take ? { orderBy: { _sum: { total: 'desc' as const } }, take } : {}),
      _sum: { quantity: true, total: true },
    });
  }

  /** Cantidad y monto vendidos por menu dentro del rango. */
  findSoldByMenu(companyId: string, window: DateWindow, take?: number) {
    return this.prisma.orderItem.groupBy({
      by: ['menuId'],
      where: {
        ...this.soldItemsWhere(companyId, window),
        menuId: { not: null },
      },
      ...(take ? { orderBy: { _sum: { total: 'desc' as const } }, take } : {}),
      _sum: { quantity: true, total: true },
    });
  }

  /** Categoria (id + nombre) de los productos vendidos. */
  findProductCategories(companyId: string, productIds: string[]) {
    if (productIds.length === 0) {
      return Promise.resolve(
        [] as { id: string; category: { id: string; name: string } | null }[],
      );
    }
    return this.prisma.product.findMany({
      where: { id: { in: productIds }, ...tenantWhere(companyId) },
      select: { id: true, category: { select: { id: true, name: true } } },
    });
  }

  /** Categoria (id + nombre) de los menus vendidos. */
  findMenuCategories(companyId: string, menuIds: string[]) {
    if (menuIds.length === 0) {
      return Promise.resolve(
        [] as { id: string; category: { id: string; name: string } | null }[],
      );
    }
    return this.prisma.menu.findMany({
      where: { id: { in: menuIds }, ...tenantWhere(companyId) },
      select: { id: true, category: { select: { id: true, name: true } } },
    });
  }

  /** Nombre, SKU y costo actual de los productos vendidos. */
  findProductCosts(companyId: string, productIds: string[]) {
    if (productIds.length === 0) {
      return Promise.resolve(
        [] as { id: string; name: string; sku: string; cost: number }[],
      );
    }
    return this.prisma.product.findMany({
      where: { id: { in: productIds }, ...tenantWhere(companyId) },
      select: { id: true, name: true, sku: true, cost: true },
    });
  }

  /** Nombre, codigo y costo actual de los menus vendidos. */
  findMenuCosts(companyId: string, menuIds: string[]) {
    if (menuIds.length === 0) {
      return Promise.resolve(
        [] as { id: string; name: string; code: string; cost: number }[],
      );
    }
    return this.prisma.menu.findMany({
      where: { id: { in: menuIds }, ...tenantWhere(companyId) },
      select: { id: true, name: true, code: true, cost: true },
    });
  }

  // ============================= Cobros ====================================

  /**
   * Cobros agrupados por metodo de pago en moneda base (USD): es la unica cifra
   * comparable entre cobros hechos en distintas monedas.
   */
  groupPaymentsByMethod(
    companyId: string,
    filter: { createdAt: { gte: Date; lte: Date } },
  ) {
    return this.prisma.orderPayment.groupBy({
      by: ['method'],
      where: { ...filter, ...tenantWhere(companyId) },
      orderBy: { method: 'asc' },
      _sum: { baseAmount: true },
      _count: { _all: true },
    });
  }

  /** Cobros agrupados por moneda: monto original y su equivalente en USD. */
  groupPaymentsByCurrency(
    companyId: string,
    filter: { createdAt: { gte: Date; lte: Date } },
  ) {
    return this.prisma.orderPayment.groupBy({
      by: ['currency'],
      where: { ...filter, ...tenantWhere(companyId) },
      orderBy: { currency: 'asc' },
      _sum: { amount: true, baseAmount: true },
      _count: { _all: true },
    });
  }

  /** Gastos agrupados por moneda: monto original y su equivalente en USD. */
  groupExpensesByCurrency(
    companyId: string,
    filter: { date: { gte: Date; lte: Date } },
  ) {
    return this.prisma.expense.groupBy({
      by: ['currency'],
      where: { ...filter, ...tenantWhere(companyId) },
      orderBy: { currency: 'asc' },
      _sum: { amount: true, baseAmount: true },
      _count: { _all: true },
    });
  }

  // ============================ Inventario =================================

  /**
   * Productos con control de stock activos. SQLite no permite comparar dos
   * columnas en un `where` de Prisma, por eso el minimo se compara despues.
   */
  findLowStockCandidates(companyId: string) {
    return this.prisma.product.findMany({
      where: { active: true, trackStock: true, ...tenantWhere(companyId) },
      select: LOW_STOCK_SELECT,
      orderBy: { stock: 'asc' },
    });
  }

  // ============================== Panel ====================================

  /**
   * Consultas del panel principal. Van en un solo `Promise.all` para que la
   * pantalla de inicio se resuelva en un unico round-trip.
   */
  async dashboardSnapshot(companyId: string, windows: DashboardWindows) {
    const [
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
    ] = await Promise.all([
      this.prisma.order.aggregate({
        where: this.salesWhere(companyId, {
          from: windows.todayFrom,
          to: windows.todayTo,
        }),
        _sum: { total: true, paidAmount: true },
        _count: { _all: true },
      }),
      this.prisma.order.aggregate({
        where: this.salesWhere(companyId, {
          from: windows.monthFrom,
          to: windows.todayTo,
        }),
        _sum: { total: true, paidAmount: true },
        _count: { _all: true },
      }),
      this.prisma.order.aggregate({
        where: this.salesWhere(companyId, {
          from: windows.prevMonthFrom,
          to: windows.prevMonthTo,
        }),
        _sum: { total: true },
      }),
      this.prisma.expense.aggregate({
        where: {
          date: { gte: windows.todayFrom, lte: windows.todayTo },
          ...tenantWhere(companyId),
        },
        _sum: { baseAmount: true },
      }),
      this.prisma.expense.aggregate({
        where: {
          date: { gte: windows.monthFrom, lte: windows.todayTo },
          ...tenantWhere(companyId),
        },
        _sum: { baseAmount: true },
      }),
      this.prisma.cashSession.findFirst({
        where: { status: CashSessionStatus.OPEN, ...tenantWhere(companyId) },
        orderBy: { openedAt: 'desc' },
        select: {
          id: true,
          code: true,
          openedAt: true,
          openingAmount: true,
          openedBy: { select: { id: true, name: true } },
          movements: { orderBy: { createdAt: 'desc' } },
        },
      }),
      this.prisma.order.count({
        where: {
          ...tenantWhere(companyId),
          status: { in: ACTIVE_ORDER_STATUSES },
        },
      }),
      this.prisma.product.count({
        where: { active: true, ...tenantWhere(companyId) },
      }),
      this.prisma.customer.count({
        where: { active: true, ...tenantWhere(companyId) },
      }),
      this.prisma.supplier.count({
        where: { active: true, ...tenantWhere(companyId) },
      }),
      this.groupPaymentsByMethod(companyId, {
        createdAt: { gte: windows.todayFrom, lte: windows.todayTo },
      }),
      this.groupPaymentsByCurrency(companyId, {
        createdAt: { gte: windows.todayFrom, lte: windows.todayTo },
      }),
      this.groupExpensesByCurrency(companyId, {
        date: { gte: windows.todayFrom, lte: windows.todayTo },
      }),
    ]);

    return {
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
    };
  }
}
