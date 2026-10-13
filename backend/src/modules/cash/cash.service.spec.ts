import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { convertToBase } from '../../common/utils/currency.util';
import type { PrismaService } from '../../prisma/prisma.service';
import type { RatesService } from '../rates/rates.service';
import { CashService, type MovementLike } from './cash.service';

/** Tasa del dolar usada en las pruebas (Bs por USD). */
const BS_PER_USD = 900;

/**
 * `RatesService` simulado: convierte con 900 Bs por USD, 1 Bs por VES,
 * 990 Bs por EUR y 0.22 Bs por COP (el resto de monedas no tiene tasa).
 */
const rates = {
  resolvePayment: async (amount: number, currency?: string | null) => {
    const code = String(currency ?? 'USD').toUpperCase();
    const bsPerCurrency =
      code === 'VES'
        ? 1
        : code === 'EUR'
          ? 990
          : code === 'COP'
            ? 0.22
            : code === 'USD'
              ? BS_PER_USD
              : null;
    const converted = convertToBase(amount, code, {
      bsPerUsd: BS_PER_USD,
      bsPerCurrency,
    });
    if (!converted) {
      throw new BadRequestException(`Falta la tasa de ${code}`);
    }
    return converted;
  },
} as unknown as RatesService;

const config = {
  get: jest.fn(() => true),
} as unknown as ConfigService;

function movement(partial: Partial<MovementLike> = {}): MovementLike {
  return {
    type: 'IN',
    category: 'SALE',
    paymentMethod: 'CASH',
    amount: 0,
    currency: 'USD',
    baseAmount: 0,
    ...partial,
  };
}

describe('CashService (arqueo multimoneda)', () => {
  describe('buildBreakdown', () => {
    it('suma en la moneda base y conserva el desglose por moneda', () => {
      const service = new CashService({} as PrismaService, config, rates);

      const breakdown = service.buildBreakdown(10, [
        // 900 Bs cobrados como efectivo = 1 USD
        movement({ amount: 900, currency: 'VES', baseAmount: 1 }),
        movement({ amount: 33, currency: 'USD', baseAmount: 33 }),
        // egreso de 1000 COP = 0.24 USD (1000 * 0.22 = 220 Bs)
        movement({
          type: 'OUT',
          category: 'EXPENSE',
          amount: 1000,
          currency: 'COP',
          baseAmount: 0.24,
        }),
      ]);

      expect(breakdown.cashIn).toBe(34);
      expect(breakdown.cashOut).toBe(0.24);
      expect(breakdown.expectedCash).toBe(43.76);
      expect(breakdown.totalIn).toBe(34);
      expect(breakdown.byCurrency).toEqual([
        {
          currency: 'VES',
          in: 900,
          out: 0,
          net: 900,
          baseIn: 1,
          baseOut: 0,
          baseNet: 1,
        },
        {
          currency: 'USD',
          in: 33,
          out: 0,
          net: 33,
          baseIn: 33,
          baseOut: 0,
          baseNet: 33,
        },
        {
          currency: 'COP',
          in: 0,
          out: 1000,
          net: -1000,
          baseIn: 0,
          baseOut: 0.24,
          baseNet: -0.24,
        },
      ]);
    });

    it('trata los movimientos sin equivalente como montos en dólares', () => {
      const service = new CashService({} as PrismaService, config, rates);

      const breakdown = service.buildBreakdown(0, [
        // Registro anterior al soporte multimoneda (sin baseAmount).
        movement({ amount: 25, currency: 'USD', baseAmount: 0 }),
      ]);

      expect(breakdown.cashIn).toBe(25);
      expect(breakdown.salesTotal).toBe(25);
    });

    it('desglosa el fondo inicial contado en varias monedas', () => {
      const service = new CashService({} as PrismaService, config, rates);

      // Fondo: 100 USD + 5.000 Bs + 50 EUR = 100 + 5.56 + 55 = 160.56 USD.
      // El JSON vive en la base en centavos, como el resto del dinero.
      const breakdown = service.buildBreakdown(
        160.56,
        [],
        JSON.stringify([
          { currency: 'USD', amount: 10000, rate: 900, baseAmount: 10000 },
          { currency: 'VES', amount: 500000, rate: 1, baseAmount: 556 },
          { currency: 'EUR', amount: 5000, rate: 990, baseAmount: 5500 },
        ]),
      );

      expect(breakdown.expectedCash).toBe(160.56);
      expect(breakdown.openingMixed).toBe(true);
      expect(breakdown.openingByCurrency).toEqual([
        { currency: 'USD', amount: 100, rate: 900, baseAmount: 100 },
        { currency: 'VES', amount: 5000, rate: 1, baseAmount: 5.56 },
        { currency: 'EUR', amount: 50, rate: 990, baseAmount: 55 },
      ]);
      // El efectivo esperado por moneda sigue saliendo de los movimientos.
      expect(breakdown.byCurrency).toEqual([]);
    });

    it('deja el desglose del fondo vacio en aperturas de una sola moneda', () => {
      const service = new CashService({} as PrismaService, config, rates);

      const breakdown = service.buildBreakdown(20, [], null);

      expect(breakdown.openingByCurrency).toEqual([]);
      expect(breakdown.openingMixed).toBe(false);
    });
  });

  describe('registerMovement', () => {
    function build(created: unknown[]) {
      const tx = {
        cashSession: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: 's1', code: 'CAJ-1', status: 'OPEN' }),
          findUnique: jest
            .fn()
            .mockResolvedValue({ id: 's1', code: 'CAJ-1', status: 'OPEN' }),
        },
        cashMovement: {
          create: jest.fn(async (input: { data: unknown }) => {
            created.push(input.data);
            return input.data;
          }),
        },
      };

      return {
        service: new CashService({} as PrismaService, config, rates),
        tx,
      };
    }

    it('guarda el monto en su moneda y el equivalente en USD', async () => {
      const created: unknown[] = [];
      const { service, tx } = build(created);

      await service.registerMovement(
        { category: 'SALE', amount: 1800, currency: 'VES' },
        tx as never,
      );

      expect(created[0]).toMatchObject({
        amount: 1800,
        currency: 'VES',
        exchangeRate: 1,
        baseAmount: 2,
      });
    });

    it('convierte monedas con tasa propia (COP a 0.22 Bs)', async () => {
      const created: unknown[] = [];
      const { service, tx } = build(created);

      await service.registerMovement(
        { type: 'IN', category: 'DEPOSIT', amount: 1000, currency: 'COP' },
        tx as never,
      );

      expect(created[0]).toMatchObject({
        amount: 1000,
        currency: 'COP',
        exchangeRate: 0.22,
        baseAmount: 0.24,
      });
    });

    it('usa la moneda base cuando no se indica moneda', async () => {
      const created: unknown[] = [];
      const { service, tx } = build(created);

      await service.registerMovement(
        { category: 'SALE', amount: 15 },
        tx as never,
      );

      expect(created[0]).toMatchObject({
        amount: 15,
        currency: 'USD',
        exchangeRate: 900,
        baseAmount: 15,
      });
    });

    it('rechaza montos no positivos', async () => {
      const { service, tx } = build([]);

      await expect(
        service.registerMovement({ category: 'SALE', amount: 0 }, tx as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('openSession', () => {
    /**
     * Servicio con la transaccion simulada de Prisma: guarda los datos del
     * `create` y devuelve la sesion tal como la veria el cliente.
     */
    function build() {
      const created: Record<string, unknown>[] = [];
      const tx = {
        cashSession: {
          findFirst: jest.fn().mockResolvedValue(null),
          count: jest.fn().mockResolvedValue(0),
          create: jest.fn(async (input: { data: Record<string, unknown> }) => {
            created.push(input.data);
            return {
              ...input.data,
              openedBy: null,
              closedBy: null,
              movements: [],
            };
          }),
        },
      };
      const prisma = {
        $transaction: (fn: (client: unknown) => unknown) => fn(tx),
      } as unknown as PrismaService;

      return { service: new CashService(prisma, config, rates), created };
    }

    it('expresa el fondo en USD y recuerda la moneda contada', async () => {
      const created: Record<string, unknown>[] = [];
      const tx = {
        cashSession: {
          findFirst: jest.fn().mockResolvedValue(null),
          count: jest.fn().mockResolvedValue(0),
          create: jest.fn(async (input: { data: Record<string, unknown> }) => {
            created.push(input.data);
            return {
              ...input.data,
              openedBy: null,
              closedBy: null,
              movements: [],
            };
          }),
        },
      };
      const prisma = {
        $transaction: (fn: (client: unknown) => unknown) => fn(tx),
      } as unknown as PrismaService;

      const service = new CashService(prisma, config, rates);
      await service.openSession(
        { openingAmount: 1800, openingCurrency: 'VES' },
        'user-1',
      );

      expect(created[0]).toMatchObject({
        openingAmount: 2,
        openingCurrency: 'VES',
        openingRate: 1,
      });
    });

    it('suma en USD un fondo contado en varias monedas', async () => {
      const { service, created } = build();

      const session = await service.openSession(
        {
          openingLines: [
            { currency: 'USD', amount: 100 },
            { currency: 'VES', amount: 5000 },
            { currency: 'EUR', amount: 50 },
          ],
        },
        'user-1',
      );

      // 100 USD + 5.000 Bs (5.56) + 50 EUR (55) = 160.56 USD
      expect(created[0]).toMatchObject({
        openingAmount: 160.56,
        openingCurrency: 'MIX',
        openingRate: null,
      });
      // El JSON guardado en la base lleva los montos en centavos (la tasa no).
      expect(JSON.parse(String(created[0].openingLines))).toEqual([
        { currency: 'USD', amount: 10000, rate: 900, baseAmount: 10000 },
        { currency: 'VES', amount: 500000, rate: 1, baseAmount: 556 },
        { currency: 'EUR', amount: 5000, rate: 990, baseAmount: 5500 },
      ]);

      // El arqueo de la sesion recien abierta ya trae el desglose del fondo.
      expect(session.openingMixed).toBe(true);
      expect(session.openingLines).toHaveLength(3);
      expect(session.summary.openingByCurrency).toHaveLength(3);
      expect(session.summary.expectedCash).toBe(160.56);
    });

    it('une las lineas repetidas de una misma moneda', async () => {
      const { service, created } = build();

      await service.openSession(
        {
          openingLines: [
            { currency: 'usd', amount: 100 },
            { currency: 'USD', amount: 50 },
          ],
        },
        'user-1',
      );

      expect(created[0]).toMatchObject({
        openingAmount: 150,
        openingCurrency: 'USD',
        openingRate: 900,
      });
      expect(JSON.parse(String(created[0].openingLines))).toEqual([
        { currency: 'USD', amount: 15000, rate: 900, baseAmount: 15000 },
      ]);
    });

    it('ignora las lineas del fondo sin monto', async () => {
      const { service, created } = build();

      await service.openSession(
        { openingLines: [{ currency: 'USD', amount: 0 }] },
        'user-1',
      );

      // Sin monto no hay nada que convertir: la caja abre sin fondo.
      expect(created[0]).toMatchObject({
        openingAmount: 0,
        openingCurrency: 'USD',
        openingRate: null,
      });
      expect(created[0].openingLines).toBeUndefined();
    });

    it('exige un fondo (una moneda o varias lineas)', async () => {
      const { service } = build();

      await expect(service.openSession({}, 'user-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('listSessions', () => {
    it('devuelve el desglose del fondo parseado (JSON guardado en texto)', async () => {
      const row = {
        id: 's1',
        code: 'CJ-20261013-0009',
        status: 'CLOSED',
        openingAmount: 159.77,
        openingCurrency: 'MIX',
        openingRate: null,
        openingLines: JSON.stringify([
          { currency: 'USD', amount: 10000, rate: 905, baseAmount: 10000 },
          { currency: 'VES', amount: 500000, rate: 1, baseAmount: 552 },
          { currency: 'EUR', amount: 5000, rate: 982.00454402, baseAmount: 5425 },
        ]),
        openedAt: new Date('2026-10-13T08:00:00.000Z'),
        closedAt: new Date('2026-10-13T20:00:00.000Z'),
        openedBy: null,
        closedBy: null,
        _count: { movements: 0, orders: 0 },
      };
      const prisma = {
        cashSession: {
          findMany: jest.fn().mockResolvedValue([row]),
          count: jest.fn().mockResolvedValue(1),
        },
        $transaction: (operations: unknown[]) => Promise.all(operations),
      } as unknown as PrismaService;
      const service = new CashService(prisma, config, rates);

      const result = await service.listSessions({
        page: 1,
        limit: 10,
        toOrderBy: () => ({ openedAt: 'desc' }),
      } as never);

      expect(result.items[0].openingLines).toHaveLength(3);
      expect(result.items[0].openingMixed).toBe(true);
      expect(result.items[0].openingLines?.[1]).toMatchObject({
        currency: 'VES',
        amount: 5000,
        baseAmount: 5.52,
      });
    });
  });

  describe('closeSession', () => {
    it('convierte el efectivo contado y añade la moneda del conteo', async () => {
      const updates: Record<string, unknown>[] = [];
      const session = {
        id: 's1',
        code: 'CAJ-1',
        status: 'OPEN',
        openedById: 'user-1',
        openedAt: new Date('2026-10-13T08:00:00.000Z'),
        openingAmount: 1,
        openingCurrency: 'USD',
        openingRate: 900,
        openingNotes: null,
        closedById: null,
        closedAt: null,
        countedAmount: null,
        countedCurrency: null,
        countedRate: null,
        expectedAmount: null,
        difference: null,
        closingNotes: null,
        createdAt: new Date('2026-10-13T08:00:00.000Z'),
        updatedAt: new Date('2026-10-13T08:00:00.000Z'),
        movements: [movement({ amount: 900, currency: 'VES', baseAmount: 1 })],
      };

      const tx = {
        cashSession: {
          findFirst: jest.fn().mockResolvedValue(session),
          updateMany: jest.fn(
            async (input: { data: Record<string, unknown> }) => {
              updates.push(input.data);
              return { count: 1 };
            },
          ),
          // Simula la sesion ya cerrada con los datos que se persistieron.
          findUniqueOrThrow: jest.fn(async () => ({
            ...session,
            ...(updates[0] ?? {}),
            openedBy: null,
            closedBy: null,
          })),
        },
      };
      const prisma = {
        $transaction: (fn: (client: unknown) => unknown) => fn(tx),
      } as unknown as PrismaService;

      const service = new CashService(prisma, config, rates);
      const closed = await service.closeSession(
        { countedAmount: 1800, countedCurrency: 'VES' },
        'user-1',
      );

      // Fondo 1 USD + venta 1 USD = 2 USD esperados; se contaron 1800 Bs = 2 USD.
      expect(updates[0]).toMatchObject({
        countedAmount: 2,
        countedCurrency: 'VES',
        countedRate: 1,
        expectedAmount: 2,
        difference: 0,
      });
      expect(closed.reconciliation).toMatchObject({
        result: 'BALANCED',
        countedCurrency: 'VES',
      });
      expect(closed.baseCurrency).toBe('USD');
    });
  });
});
