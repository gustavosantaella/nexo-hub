import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { convertToBase } from '../../common/utils/currency.util';
import type { PrismaService } from '../../prisma/prisma.service';
import type { RatesService } from '../rates/rates.service';
import { CashRepository } from './cash.repository';
import { CashService, type MovementLike } from './cash.service';

const COMPANY_ID = 'company-1';

/** Tasa del dolar usada en las pruebas (Bs por USD). */
const BS_PER_USD = 900;

/**
 * `RatesService` simulado: convierte con 900 Bs por USD, 1 Bs por VES,
 * 990 Bs por EUR y 0.22 Bs por COP (el resto de monedas no tiene tasa).
 */
const rates = {
  resolvePayment: async (
    _companyId: string,
    amount: number,
    currency?: string | null,
  ) => {
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
      const service = new CashService(new CashRepository({} as PrismaService), config, rates);

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
      expect(breakdown.byCurrency).toMatchObject([
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

    it('agrega cada moneda con sus totales de caja, venta y metodo', () => {
      const service = new CashService(new CashRepository({} as PrismaService), config, rates);

      // Bs 15.520,00 cobrados en efectivo al BCV: el equivalente en USD se
      // guarda redondeado ($ 17,57), pero el efectivo que entro al cajon son
      // los bolivares exactos.
      const breakdown = service.buildBreakdown(0, [
        movement({ amount: 15520, currency: 'VES', baseAmount: 17.57 }),
      ]);

      expect(breakdown.byCurrency).toEqual([
        {
          currency: 'VES',
          in: 15520,
          out: 0,
          net: 15520,
          baseIn: 17.57,
          baseOut: 0,
          baseNet: 17.57,
          cashIn: 15520,
          cashOut: 0,
          baseCashIn: 17.57,
          baseCashOut: 0,
          sales: 15520,
          tips: 0,
          change: 0,
          baseSales: 17.57,
          baseTips: 0,
          baseChange: 0,
          methods: [
            {
              method: 'CASH',
              in: 15520,
              out: 0,
              net: 15520,
              baseIn: 17.57,
              baseOut: 0,
              baseNet: 17.57,
            },
          ],
        },
      ]);
    });

    it('cierra el turno con el total recortado, no con la suma del redondeo por movimiento', () => {
      const service = new CashService(new CashRepository({} as PrismaService), config, rates);

      // Tres cobros en bolivares al BCV (883,3963 Bs por USD). Cada equivalente
      // guardado se redondeo a centavos al registrar el cobro (6,59 + 17,57 +
      // 17,56 = 41,72), pero el turno vale 41,7140 USD: el arqueo suma cada
      // movimiento con su tasa exacta y recorta una sola vez (41,71), que es el
      // mismo numero que pinta la pantalla. Asi el cajero cierra sin diferencia.
      const bcv = 883.3963;
      const breakdown = service.buildBreakdown(0, [
        movement({ amount: 5820, currency: 'VES', baseAmount: 6.59, baseRate: bcv }),
        movement({ amount: 15520, currency: 'VES', baseAmount: 17.57, baseRate: bcv }),
        movement({ amount: 15510, currency: 'VES', baseAmount: 17.56, baseRate: bcv }),
      ]);

      expect(breakdown.cashIn).toBe(41.71);
      expect(breakdown.expectedCash).toBe(41.71);
      expect(breakdown.totalIn).toBe(41.71);
      expect(breakdown.byMethod[0]).toEqual({ method: 'CASH', in: 41.71, out: 0, net: 41.71 });
      // El equivalente por moneda tambien se recorta una sola vez.
      expect(breakdown.byCurrency[0].baseIn).toBe(41.71);
      expect(breakdown.byCurrency[0].baseNet).toBe(41.71);
    });

    it('valora cada cobro con su tasa aunque el equivalente se haya recortado al saldo', () => {
      const service = new CashService(new CashRepository({} as PrismaService), config, rates);

      // Los cobros reales: dos ventas de Bs 15.520,00 y una de $ 6,59 al BCV
      // 883,3963. El equivalente guardado en cada movimiento es el precio del
      // pedido ya recortado a centavos (17,56 y 6,58), pero lo que entro al
      // cajon vale 17,5686 + 17,5686 + 6,59 = 41,7271 USD. El arqueo tiene que
      // usar la tasa (41,72), no la suma de los precios (41,70): si no, el cierre
      // sobra dos centavos que el cajero si tiene en la mano.
      const bcv = 883.3963;
      const breakdown = service.buildBreakdown(0, [
        movement({ amount: 15520, currency: 'VES', baseAmount: 17.56, baseRate: bcv }),
        movement({ amount: 15520, currency: 'VES', baseAmount: 17.56, baseRate: bcv }),
        movement({ amount: 6.59, currency: 'USD', baseAmount: 6.58, baseRate: 1 }),
      ]);

      expect(breakdown.cashIn).toBe(41.72);
      expect(breakdown.expectedCash).toBe(41.72);
      expect(breakdown.totalIn).toBe(41.72);
      expect(breakdown.byMethod[0]).toEqual({ method: 'CASH', in: 41.72, out: 0, net: 41.72 });
      // El desglose por moneda recorta una vez por moneda: 35,13 + 6,59 = 41,72,
      // el mismo numero que la tarjeta del efectivo.
      expect(breakdown.byCurrency.map((row) => [row.currency, row.baseNet])).toEqual([
        ['VES', 35.13],
        ['USD', 6.59],
      ]);
    });

    it('reparte la propina y los vueltos en la moneda en que se cobraron', () => {
      const service = new CashService(new CashRepository({} as PrismaService), config, rates);

      const breakdown = service.buildBreakdown(0, [
        // 900 Bs = 1 USD, con 0.10 USD de propina dentro del cobro.
        movement({ amount: 900, currency: 'VES', baseAmount: 1, tipAmount: 0.1 }),
        movement({
          type: 'OUT',
          category: 'CHANGE',
          amount: 100,
          currency: 'VES',
          baseAmount: 0.11,
        }),
      ]);

      expect(breakdown.byCurrency[0]).toMatchObject({
        sales: 900,
        tips: 90,
        change: 100,
        baseSales: 1,
        baseTips: 0.1,
        baseChange: 0.11,
      });
    });

    it('trata los movimientos sin equivalente como montos en dólares', () => {
      const service = new CashService(new CashRepository({} as PrismaService), config, rates);

      const breakdown = service.buildBreakdown(0, [
        // Registro anterior al soporte multimoneda (sin baseAmount).
        movement({ amount: 25, currency: 'USD', baseAmount: 0 }),
      ]);

      expect(breakdown.cashIn).toBe(25);
      expect(breakdown.salesTotal).toBe(25);
    });

    it('separa las propinas de las ventas del turno', () => {
      const service = new CashService(new CashRepository({} as PrismaService), config, rates);

      const breakdown = service.buildBreakdown(0, [
        // Cobro de 110 USD: 100 de consumo + 10 de propina.
        movement({ amount: 110, baseAmount: 110, tipAmount: 10 }),
        // Movimiento manual de venta: no lleva propina dentro.
        movement({ amount: 25, baseAmount: 25 }),
      ]);

      // El efectivo no cambia: la propina entro junto con el cobro del pedido.
      expect(breakdown.cashIn).toBe(135);
      expect(breakdown.expectedCash).toBe(135);
      // Ventas + propinas = lo que se cobro por ventas.
      expect(breakdown.salesTotal).toBe(125);
      expect(breakdown.tipsTotal).toBe(10);
    });

    it('descuenta el vuelto del total de ventas y del efectivo esperado', () => {
      const service = new CashService(new CashRepository({} as PrismaService), config, rates);

      const breakdown = service.buildBreakdown(0, [
        // El cliente entrego 10.000 Bs por una venta de 8.245,48 y recibio
        // 1.754,52 Bs de vuelto. Ambos son movimientos reales de la caja.
        movement({
          type: 'IN',
          category: 'SALE',
          amount: 10000,
          currency: 'VES',
          baseAmount: 11.34,
        }),
        movement({
          type: 'OUT',
          category: 'CHANGE',
          amount: 1754.52,
          currency: 'VES',
          baseAmount: 1.99,
        }),
      ]);

      expect(breakdown.cashIn).toBe(11.34);
      expect(breakdown.cashOut).toBe(1.99);
      expect(breakdown.expectedCash).toBe(9.35);
      expect(breakdown.salesTotal).toBe(9.35);
    });

    it('no deja que la propina supere el monto cobrado', () => {
      const service = new CashService(new CashRepository({} as PrismaService), config, rates);

      const breakdown = service.buildBreakdown(0, [
        movement({ amount: 50, baseAmount: 50, tipAmount: 80 }),
      ]);

      expect(breakdown.salesTotal).toBe(0);
      expect(breakdown.tipsTotal).toBe(50);
    });

    it('desglosa el fondo inicial contado en varias monedas', () => {
      const service = new CashService(new CashRepository({} as PrismaService), config, rates);

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
        { currency: 'USD', amount: 100, rate: 900, baseRate: null, baseAmount: 100 },
        { currency: 'VES', amount: 5000, rate: 1, baseRate: null, baseAmount: 5.56 },
        { currency: 'EUR', amount: 50, rate: 990, baseRate: null, baseAmount: 55 },
      ]);
      // El efectivo esperado por moneda sigue saliendo de los movimientos.
      expect(breakdown.byCurrency).toEqual([]);
    });

    it('deja el desglose del fondo vacio en aperturas de una sola moneda', () => {
      const service = new CashService(new CashRepository({} as PrismaService), config, rates);

      const breakdown = service.buildBreakdown(20, [], null);

      expect(breakdown.openingByCurrency).toEqual([]);
      expect(breakdown.openingMixed).toBe(false);
    });
  });

  describe('propinas del turno', () => {
    it('no adelanta propina en un abono parcial', () => {
      const service = new CashService(new CashRepository({} as PrismaService), config, rates);

      // Pedido de 110 (100 de consumo + 10 de propina) con un abono de 100.
      const portions = service.tipPortionsOfOrder(110, 10, [
        { id: 'p1', baseAmount: 100 },
      ]);

      expect(portions.get('p1')).toBe(0);
    });

    it('cobra la propina con el pago que completa el consumo', () => {
      const service = new CashService(new CashRepository({} as PrismaService), config, rates);

      const portions = service.tipPortionsOfOrder(110, 10, [
        { id: 'p1', baseAmount: 60 },
        { id: 'p2', baseAmount: 50 },
      ]);

      expect(portions.get('p1')).toBe(0);
      expect(portions.get('p2')).toBe(10);
    });

    it('reparte la propina cuando el primer pago ya cubre el consumo', () => {
      const service = new CashService(new CashRepository({} as PrismaService), config, rates);

      // 105 = 100 de consumo + 5 de propina; quedan 5 de propina para el resto.
      const portions = service.tipPortionsOfOrder(110, 10, [
        { id: 'p1', baseAmount: 105 },
        { id: 'p2', baseAmount: 5 },
      ]);

      expect(portions.get('p1')).toBe(5);
      expect(portions.get('p2')).toBe(5);
    });

    it('usa el monto original en cobros sin equivalente en USD', () => {
      const service = new CashService(new CashRepository({} as PrismaService), config, rates);

      const portions = service.tipPortionsOfOrder(110, 10, [
        { id: 'p1', amount: 110, baseAmount: 0 },
      ]);

      expect(portions.get('p1')).toBe(10);
    });

    it('asigna a cada movimiento la propina de su cobro', async () => {
      const prisma = {
        order: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'o1',
              total: 110,
              tip: 10,
              payments: [
                { id: 'p1', amount: 110, baseAmount: 110, cashMovementId: 'm1' },
              ],
            },
          ]),
        },
      } as unknown as PrismaService;
      const service = new CashService(new CashRepository(prisma), config, rates);

      const movements = await service.withTips(COMPANY_ID, [
        movement({
          id: 'm1',
          amount: 110,
          baseAmount: 110,
          referenceType: 'ORDER',
          referenceId: 'o1',
        }),
        // Movimiento manual: no es el cobro de un pedido.
        movement({ id: 'm2', amount: 25, baseAmount: 25 }),
      ]);

      expect(movements[0].tipAmount).toBe(10);
      expect(movements[1].tipAmount).toBe(0);
      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: ['o1'] },
            companyId: COMPANY_ID,
          }),
        }),
      );
    });

    it('no consulta la base cuando ningun movimiento es un cobro de pedido', async () => {
      const prisma = {
        order: { findMany: jest.fn() },
      } as unknown as PrismaService;
      const service = new CashService(new CashRepository(prisma), config, rates);

      await service.withTips(COMPANY_ID, [movement({ id: 'm1', amount: 25 })]);

      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });

    it('deja las ventas netas y las propinas aparte en el arqueo', async () => {
      const prisma = {
        cashSession: {
          findFirst: jest.fn().mockResolvedValue({
            id: 's1',
            companyId: COMPANY_ID,
            code: 'CJ-1',
            status: 'OPEN',
            openedAt: new Date('2026-10-13T08:00:00.000Z'),
            openingAmount: 0,
            openingCurrency: 'USD',
            openingRate: null,
            openingLines: null,
            movements: [
              movement({
                id: 'm1',
                amount: 110,
                baseAmount: 110,
                referenceType: 'ORDER',
                referenceId: 'o1',
              }),
            ],
          }),
        },
        order: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'o1',
              total: 110,
              tip: 10,
              payments: [
                { id: 'p1', amount: 110, baseAmount: 110, cashMovementId: 'm1' },
              ],
            },
          ]),
        },
      } as unknown as PrismaService;
      const service = new CashService(new CashRepository(prisma), config, rates);

      const { summary } = await service.getCurrentSession(COMPANY_ID);

      expect(summary?.cashIn).toBe(110);
      expect(summary?.salesTotal).toBe(100);
      expect(summary?.tipsTotal).toBe(10);
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
        service: new CashService(new CashRepository({} as PrismaService), config, rates),
        tx,
      };
    }

    it('filtra la sesion de caja por la empresa activa', async () => {
      const { service, tx } = build([]);

      await service.registerMovement(
        COMPANY_ID,
        { category: 'SALE', amount: 15 },
        tx as never,
      );

      expect(tx.cashSession.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ companyId: COMPANY_ID }),
        }),
      );
    });

    it('guarda el monto en su moneda y el equivalente en USD', async () => {
      const created: unknown[] = [];
      const { service, tx } = build(created);

      await service.registerMovement(
        COMPANY_ID,
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
        COMPANY_ID,
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

    it('guarda la tasa aunque el equivalente se ajuste al saldo del pedido', async () => {
      const created: unknown[] = [];
      const { service, tx } = build(created);

      // 900 VES = 1 USD, pero el cobro se aplica al saldo del pedido (0,99): el
      // arqueo igual valora el billete con su tasa, no con el precio recortado.
      await service.registerMovement(
        COMPANY_ID,
        { category: 'SALE', amount: 900, currency: 'VES', baseAmount: 0.99 },
        tx as never,
      );

      expect(created[0]).toMatchObject({
        amount: 900,
        currency: 'VES',
        baseAmount: 0.99,
        baseRate: 900,
      });
    });

    it('usa la moneda base cuando no se indica moneda', async () => {
      const created: unknown[] = [];
      const { service, tx } = build(created);

      await service.registerMovement(
        COMPANY_ID,
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

    it('guarda la referencia y la foto del comprobante bancario', async () => {
      const created: unknown[] = [];
      const { service, tx } = build(created);
      const photo = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

      await service.registerMovement(
        COMPANY_ID,
        {
          type: 'IN',
          category: 'SALE',
          paymentMethod: 'TRANSFER',
          amount: 1000,
          currency: 'VES',
          paymentReference: '123456',
          paymentPhotoUrl: photo,
        },
        tx as never,
      );

      expect(created[0]).toMatchObject({
        paymentMethod: 'TRANSFER',
        paymentReference: '123456',
        paymentPhotoUrl: photo,
      });
    });

    it('rechaza montos no positivos', async () => {
      const { service, tx } = build([]);

      await expect(
        service.registerMovement(COMPANY_ID, { category: 'SALE', amount: 0 }, tx as never),
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

      return { service: new CashService(new CashRepository(prisma), config, rates), created };
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

      const service = new CashService(new CashRepository(prisma), config, rates);
      await service.openSession(
        COMPANY_ID,
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
        COMPANY_ID,
        {
          openingLines: [
            { currency: 'USD', amount: 100 },
            { currency: 'VES', amount: 5000 },
            { currency: 'EUR', amount: 50 },
          ],
        },
        'user-1',
      );

      // 100 USD + 5.000 Bs (5.56) + 50 EUR (55) = 160.5555... -> 160.55 USD: el
      // fondo se valora con la tasa de cada linea y se recorta UNA sola vez.
      expect(created[0]).toMatchObject({
        openingAmount: 160.55,
        openingCurrency: 'MIX',
        openingRate: null,
      });
      // El JSON guardado en la base lleva los montos en centavos (las tasas no).
      expect(JSON.parse(String(created[0].openingLines))).toEqual([
        { currency: 'USD', amount: 10000, rate: 900, baseRate: 1, baseAmount: 10000 },
        { currency: 'VES', amount: 500000, rate: 1, baseRate: 900, baseAmount: 555 },
        {
          currency: 'EUR',
          amount: 5000,
          rate: 990,
          baseRate: 900 / 990,
          baseAmount: 5500,
        },
      ]);

      // El arqueo de la sesion recien abierta ya trae el desglose del fondo.
      expect(session.openingMixed).toBe(true);
      expect(session.openingLines).toHaveLength(3);
      expect(session.summary.openingByCurrency).toHaveLength(3);
      // El fondo se valora con la tasa de cada linea y se recorta una sola vez:
      // 100 + 5.000 Bs (5,5555…) + 50 EUR (55) = 160,5555 -> 160,55. El total
      // guardado en la sesion usa la misma regla (recorta, nunca redondea).
      expect(session.summary.openingCash).toBe(160.55);
      expect(session.summary.expectedCash).toBe(160.55);
    });

    it('une las lineas repetidas de una misma moneda', async () => {
      const { service, created } = build();

      await service.openSession(
        COMPANY_ID,
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
        { currency: 'USD', amount: 15000, rate: 900, baseRate: 1, baseAmount: 15000 },
      ]);
    });

    it('ignora las lineas del fondo sin monto', async () => {
      const { service, created } = build();

      await service.openSession(
        COMPANY_ID,
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

      await expect(service.openSession(COMPANY_ID, {}, 'user-1')).rejects.toBeInstanceOf(
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
      const service = new CashService(new CashRepository(prisma), config, rates);

      const result = await service.listSessions(COMPANY_ID, {
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

      const service = new CashService(new CashRepository(prisma), config, rates);
      const closed = await service.closeSession(
        COMPANY_ID,
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
    it('recorta el conteo igual que el arqueo y cierra sin diferencia', async () => {
      const updates: Record<string, unknown>[] = [];
      // 1.355 Bs al BCV (900) son 1,5055 USD: el arqueo lo recorta a 1,50
      // (centavos sin redondear) y el conteo tiene que dar lo mismo; redondearlo
      // a 1,51 dejaba un sobrante de un centavo en el cierre.
      const session = {
        id: 's1',
        code: 'CAJ-1',
        status: 'OPEN',
        openedById: 'user-1',
        openedAt: new Date('2026-10-13T08:00:00.000Z'),
        openingAmount: 0,
        openingCurrency: 'USD',
        openingRate: null,
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
        openingLines: null,
        movements: [
          movement({ amount: 1355, currency: 'VES', baseAmount: 1.51, baseRate: 900 }),
        ],
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

      const service = new CashService(new CashRepository(prisma), config, rates);

      // El cajero cuenta exactamente lo mismo: 1.355 Bs.
      await service.closeSession(
        COMPANY_ID,
        { countedAmount: 1355, countedCurrency: 'VES' },
        'user-1',
      );

      expect(updates[0]).toMatchObject({
        countedAmount: 1.5,
        expectedAmount: 1.5,
        difference: 0,
      });
    });
  });
});

