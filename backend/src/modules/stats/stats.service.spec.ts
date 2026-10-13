import type { PrismaService } from '../../prisma/prisma.service';
import type { CashService } from '../cash/cash.service';
import type { PayablesService } from '../payables/payables.service';
import type { ReceivablesService } from '../receivables/receivables.service';
import { StatsQueryDto } from './dto/stats-query.dto';
import { StatsService } from './stats.service';

const COMPANY_ID = 'company-1';

/** Fila cruda de un `groupBy` por moneda (mismo formato que devuelve Prisma). */
function groupRow(
  currency: string,
  amount: number,
  baseAmount: number,
  count = 1,
) {
  return { currency, _sum: { amount, baseAmount }, _count: { _all: count } };
}

/**
 * Prisma simulado para `dashboard()`: el orden de las respuestas replica el
 * orden de las promesas del `Promise.all` (hoy, mes, mes anterior, ...).
 */
function createService(options: { session?: unknown } = {}) {
  const prisma = {
    order: {
      aggregate: jest
        .fn()
        // Hoy: 5 pedidos por $100 con $40 cobrados.
        .mockResolvedValueOnce({
          _sum: { total: 100, paidAmount: 40 },
          _count: { _all: 5 },
        })
        // Mes en curso.
        .mockResolvedValueOnce({
          _sum: { total: 900, paidAmount: 500 },
          _count: { _all: 21 },
        })
        // Mes anterior.
        .mockResolvedValueOnce({ _sum: { total: 800 } }),
      count: jest.fn().mockResolvedValue(2),
    },
    expense: {
      // Gastos de hoy / del mes (siempre en equivalente USD).
      aggregate: jest
        .fn()
        .mockResolvedValueOnce({ _sum: { baseAmount: 15 } })
        .mockResolvedValueOnce({ _sum: { baseAmount: 200 } }),
      // Gastos de hoy por moneda: 10 USD pagados en bolívares + 5 USD.
      groupBy: jest
        .fn()
        .mockResolvedValueOnce([
          groupRow('VES', 9000, 10, 2),
          groupRow('USD', 5, 5, 1),
        ]),
    },
    cashSession: {
      findFirst: jest.fn().mockResolvedValue(options.session ?? null),
    },
    product: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(12),
    },
    customer: { count: jest.fn().mockResolvedValue(4) },
    supplier: { count: jest.fn().mockResolvedValue(3) },
    orderPayment: {
      // Cobros de hoy por método y por moneda.
      groupBy: jest
        .fn()
        .mockResolvedValueOnce([
          { method: 'CASH', _sum: { baseAmount: 40 }, _count: { _all: 3 } },
        ])
        .mockResolvedValueOnce([
          groupRow('VES', 8767.98, 10, 1),
          groupRow('USD', 30, 30, 2),
          groupRow('EUR', 10, 9.18, 1),
          groupRow('', 12, 12, 1),
        ]),
    },
  };

  const cash = { buildBreakdown: jest.fn() } as unknown as CashService;
  const payables = {
    outstandingBalance: jest.fn().mockResolvedValue(50),
  } as unknown as PayablesService;
  const receivables = {
    outstandingBalance: jest.fn().mockResolvedValue(120),
  } as unknown as ReceivablesService;

  return {
    service: new StatsService(
      prisma as unknown as PrismaService,
      cash,
      payables,
      receivables,
    ),
    prisma,
  };
}

describe('StatsService (panel)', () => {
  describe('dashboard', () => {
    it('filtra los agregados por la empresa activa', async () => {
      const { service, prisma } = createService();

      await service.dashboard(COMPANY_ID);

      expect(prisma.order.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ companyId: COMPANY_ID }),
        }),
      );
    });


    it('expone los totales del día en moneda base y su utilidad', async () => {
      const { service } = createService();

      const result = await service.dashboard(COMPANY_ID);

      expect(result.today).toEqual({
        sales: 100,
        collected: 40,
        orders: 5,
        expenses: 15,
        profit: 85,
        ticketAverage: 20,
      });
      expect(result.month).toMatchObject({
        sales: 900,
        expenses: 200,
        profit: 700,
      });
      expect(result.accounts).toEqual({ payable: 50, receivable: 120, net: 70 });
      expect(result.catalog).toEqual({
        products: 12,
        customers: 4,
        suppliers: 3,
      });
    });

    it('resume el día por moneda con los totales en USD', async () => {
      const { service } = createService();

      const { currencies } = await service.dashboard(COMPANY_ID);

      expect(currencies.totals).toEqual({
        sales: 100,
        collected: 40,
        expenses: 15,
        profit: 85,
        receivable: 120,
        payable: 50,
        net: 70,
      });
      // Los cobros por moneda se ordenan por su equivalente en USD.
      expect(currencies.sales.map((row) => row.baseAmount)).toEqual([
        30, 12, 10, 9.18,
      ]);
      expect(currencies.sales[2]).toEqual({
        currency: 'VES',
        amount: 8767.98,
        baseAmount: 10,
        count: 1,
      });
      // Una fila sin moneda registrada cae en la moneda base.
      expect(currencies.sales[1]).toEqual({
        currency: 'USD',
        amount: 12,
        baseAmount: 12,
        count: 1,
      });
      expect(currencies.expenses).toEqual([
        { currency: 'VES', amount: 9000, baseAmount: 10, count: 2 },
        { currency: 'USD', amount: 5, baseAmount: 5, count: 1 },
      ]);
    });

    it('mantiene el cobro del día por moneda por compatibilidad', async () => {
      const { service } = createService();

      const { paymentsTodayByCurrency, paymentsToday } =
        await service.dashboard(COMPANY_ID);

      expect(paymentsToday).toEqual([{ method: 'CASH', amount: 40, count: 3 }]);
      expect(paymentsTodayByCurrency).toHaveLength(4);
      expect(paymentsTodayByCurrency[0]).toMatchObject({ currency: 'VES' });
    });

    it('no falla cuando no hay sesión de caja abierta', async () => {
      const { service } = createService();

      const result = await service.dashboard(COMPANY_ID);

      expect(result.cash).toBeNull();
    });
  });

  describe('salesSeries', () => {
    it('suma los gastos por su equivalente en USD (conversión multimoneda)', async () => {
      const prisma = {
        $transaction: (operations: unknown[]) => Promise.all(operations),
        order: {
          findMany: jest.fn().mockResolvedValue([
            {
              total: 100,
              paidAmount: 40,
              createdAt: new Date('2026-10-13T10:00:00'),
            },
          ]),
        },
        expense: {
          findMany: jest.fn().mockResolvedValue([
            // 9.000 Bs pagados = 10 USD.
            {
              amount: 9000,
              baseAmount: 10,
              date: new Date('2026-10-13T11:00:00'),
            },
            // Registro anterior al multimoneda (sin `baseAmount`): se usa `amount`.
            { amount: 4, baseAmount: 0, date: new Date('2026-10-13T12:00:00') },
          ]),
        },
      };
      const service = new StatsService(
        prisma as unknown as PrismaService,
        {} as CashService,
        {} as PayablesService,
        {} as ReceivablesService,
      );

      const query = new StatsQueryDto();
      query.from = '2026-10-13';
      query.to = '2026-10-13';

      const result = await service.salesSeries(COMPANY_ID, query);

      expect(result.totals).toEqual({
        orders: 1,
        sales: 100,
        collected: 40,
        expenses: 14,
        profit: 86,
        ticketAverage: 100,
      });
    });
  });

  describe('resolveRange (filtro de fechas)', () => {
    function buildService() {
      return new StatsService(
        {} as PrismaService,
        {} as CashService,
        {} as PayablesService,
        {} as ReceivablesService,
      );
    }

    it('cubre el dia local completo cuando from y to son el mismo dia', () => {
      const service = buildService();
      const query = new StatsQueryDto();
      query.from = '2026-10-13';
      query.to = '2026-10-13';

      const range = service.resolveRange(query);

      // Fecha local, no la medianoche UTC (que en zonas al oeste de UTC cae en
      // el dia anterior y excluia los pedidos del dia solicitado).
      expect(range.from.getFullYear()).toBe(2026);
      expect(range.from.getMonth()).toBe(9); // octubre (0-indexado)
      expect(range.from.getDate()).toBe(13);
      expect(range.from.getHours()).toBe(0);
      expect(range.to.getDate()).toBe(13);
      expect(range.to.getHours()).toBe(23);
      expect(range.to.getMinutes()).toBe(59);
    });

    it('incluye un pedido creado hoy a media manana en el reporte de hoy', () => {
      const service = buildService();
      const query = new StatsQueryDto();
      query.from = '2026-10-13';
      query.to = '2026-10-13';

      const range = service.resolveRange(query);
      const orderToday = new Date(2026, 9, 13, 9, 30, 0, 0);

      expect(orderToday.getTime()).toBeGreaterThanOrEqual(range.from.getTime());
      expect(orderToday.getTime()).toBeLessThanOrEqual(range.to.getTime());
    });

    it('deriva el rango de los ultimos N dias en hora local', () => {
      const service = buildService();
      const query = new StatsQueryDto();
      query.days = 7;

      const range = service.resolveRange(query);

      expect(range.from.getHours()).toBe(0);
      expect(range.to.getHours()).toBe(23);
      // 7 dias inclusivos: mismo numero de dias calendario entre los limites.
      const fromDay = new Date(
        range.from.getFullYear(),
        range.from.getMonth(),
        range.from.getDate(),
      );
      const toDay = new Date(
        range.to.getFullYear(),
        range.to.getMonth(),
        range.to.getDate(),
      );
      const dayCount =
        Math.round((toDay.getTime() - fromDay.getTime()) / 86_400_000) + 1;
      expect(dayCount).toBe(7);
    });
  });
});

