import {
  convertArgs,
  convertData,
  convertHaving,
  convertWhere,
  decodeAggregates,
} from './money-codec';

describe('money-codec', () => {
  describe('convertData (entrada: decimales -> centavos)', () => {
    it('convierte un pedido completo con items y pagos anidados', () => {
      const data = {
        code: 'PED-1',
        subtotal: 10,
        discount: 1.5,
        tax: 1.7,
        total: 10.2,
        paidAmount: 6.6,
        items: {
          create: [
            { productId: 'p1', name: 'Cafe', quantity: 2, unitPrice: 5, total: 10 },
          ],
        },
        payments: {
          create: [
            { amount: 6.6, currency: 'USD', exchangeRate: 900, baseAmount: 6.6 },
          ],
        },
      };

      expect(convertData('Order', data)).toEqual({
        code: 'PED-1',
        subtotal: 1000,
        discount: 150,
        tax: 170,
        total: 1020,
        paidAmount: 660,
        items: {
          create: [
            { productId: 'p1', name: 'Cafe', quantity: 2, unitPrice: 500, total: 1000 },
          ],
        },
        payments: {
          create: [
            { amount: 660, currency: 'USD', exchangeRate: 900, baseAmount: 660 },
          ],
        },
      });
    });

    it('no muta los argumentos del llamador', () => {
      const data = { total: 10.2, items: { create: [{ total: 5 }] } };
      convertData('Order', data);

      expect(data).toEqual({ total: 10.2, items: { create: [{ total: 5 }] } });
    });

    it('convierte actualizaciones atomicas y respeta los campos que no son dinero', () => {
      expect(
        convertData('Product', {
          price: 1.5,
          cost: 0.75,
          stock: { increment: 3 },
          name: 'Cafe',
        }),
      ).toEqual({
        price: 150,
        cost: 75,
        stock: { increment: 3 },
        name: 'Cafe',
      });
    });

    it('convierte el arqueo de una sesion de caja', () => {
      expect(
        convertData('CashSession', {
          openingAmount: 100,
          openingRate: 900,
          countedAmount: 95.55,
          expectedAmount: 100,
          difference: -4.45,
        }),
      ).toEqual({
        openingAmount: 10000,
        openingRate: 900,
        countedAmount: 9555,
        expectedAmount: 10000,
        difference: -445,
      });
    });

    it('deja intacto un modelo sin dinero', () => {
      expect(convertData('User', { name: 'Ana', role: 'ADMIN' })).toEqual({
        name: 'Ana',
        role: 'ADMIN',
      });
    });

    it('convierte escrituras anidadas de varios tipos', () => {
      expect(
        convertData('AccountReceivable', {
          amount: 10,
          payments: {
            createMany: { data: [{ amount: 4.5, baseAmount: 4.5 }] },
            updateMany: [{ where: { id: 'p1' }, data: { amount: 2 } }],
            upsert: [
              { where: { id: 'p2' }, create: { amount: 1 }, update: { amount: 3 } },
            ],
          },
        }),
      ).toEqual({
        amount: 1000,
        payments: {
          createMany: { data: [{ amount: 450, baseAmount: 450 }] },
          updateMany: [{ where: { id: 'p1' }, data: { amount: 200 } }],
          upsert: [
            { where: { id: 'p2' }, create: { amount: 100 }, update: { amount: 300 } },
          ],
        },
      });
    });
  });

  describe('convertWhere (filtros en centavos)', () => {
    it('convierte un filtro escalar y uno con operadores', () => {
      expect(convertWhere('Order', { subtotal: 20, total: { gte: 10.5 } })).toEqual({
        subtotal: 2000,
        total: { gte: 1050 },
      });
    });

    it('convierte listas, negaciones y operadores logicos', () => {
      expect(
        convertWhere('CashMovement', {
          amount: { in: [1, 2], notIn: [3], not: 4 },
          OR: [{ baseAmount: { lt: 5 } }],
          AND: [{ amount: { equals: 6 } }],
          NOT: { amount: 7 },
        }),
      ).toEqual({
        amount: { in: [100, 200], notIn: [300], not: 400 },
        OR: [{ baseAmount: { lt: 500 } }],
        AND: [{ amount: { equals: 600 } }],
        NOT: { amount: 700 },
      });
    });

    it('convierte los filtros anidados por relacion', () => {
      expect(
        convertWhere('Order', {
          code: 'PED-1',
          payments: { some: { baseAmount: { gt: 1 } } },
          items: { every: { total: 2 } },
        }),
      ).toEqual({
        code: 'PED-1',
        payments: { some: { baseAmount: { gt: 100 } } },
        items: { every: { total: 200 } },
      });
    });

    it('no toca los campos que no son dinero ni los nulos', () => {
      const where = {
        status: 'PENDING',
        createdAt: { gte: new Date(0) },
        notes: null,
      };
      expect(convertWhere('Order', where)).toEqual(where);
    });

    it('no muta el filtro del llamador (se puede reutilizar)', () => {
      const where = { total: { gte: 10 } };
      convertWhere('Order', where);
      convertWhere('Order', where);

      expect(where).toEqual({ total: { gte: 10 } });
    });
  });

  describe('convertHaving', () => {
    it('convierte las dos formas de `having` de Prisma', () => {
      expect(convertHaving('Order', { total: { _sum: { gt: 10 } } })).toEqual({
        total: { _sum: { gt: 1000 } },
      });
      expect(convertHaving('Order', { _sum: { total: { gt: 10 } } })).toEqual({
        _sum: { total: { gt: 1000 } },
      });
    });

    it('deja `_count` intacto', () => {
      expect(convertHaving('Order', { _count: { id: { gt: 2 } } })).toEqual({
        _count: { id: { gt: 2 } },
      });
    });
  });

  describe('convertArgs', () => {
    it('convierte where y data de una misma operacion', () => {
      expect(
        convertArgs('OrderPayment', {
          where: { baseAmount: { gte: 5 } },
          data: { amount: 5, baseAmount: 5 },
        }),
      ).toEqual({
        where: { baseAmount: { gte: 500 } },
        data: { amount: 500, baseAmount: 500 },
      });
    });

    it('convierte create y update de un upsert sin tocar textos', () => {
      expect(
        convertArgs('AccountPayable', {
          where: { id: 'a1' },
          create: { description: 'Compra', amount: 1 },
          update: { paidAmount: 2 },
        }),
      ).toEqual({
        where: { id: 'a1' },
        create: { description: 'Compra', amount: 100 },
        update: { paidAmount: 200 },
      });
    });
  });

  describe('decodeAggregates (salida: centavos -> decimales)', () => {
    it('decodifica un aggregate con sumas, promedios y extremos', () => {
      expect(
        decodeAggregates('Order', {
          _sum: { total: 19434, paidAmount: null },
          _avg: { total: 9717 },
          _min: { total: 500 },
          _max: { total: 5000 },
          _count: { _all: 4 },
        }),
      ).toEqual({
        _sum: { total: 194.34, paidAmount: null },
        _avg: { total: 97.17 },
        _min: { total: 5 },
        _max: { total: 50 },
        _count: { _all: 4 },
      });
    });

    it('decodifica cada fila de un groupBy por moneda', () => {
      expect(
        decodeAggregates('CashMovement', [
          {
            currency: 'USD',
            _sum: { amount: 1000, baseAmount: 1000 },
            _count: { _all: 2 },
          },
          {
            currency: 'VES',
            _sum: { amount: 500000, baseAmount: 552 },
            _count: { _all: 1 },
          },
        ]),
      ).toEqual([
        { currency: 'USD', _sum: { amount: 10, baseAmount: 10 }, _count: { _all: 2 } },
        { currency: 'VES', _sum: { amount: 5000, baseAmount: 5.52 }, _count: { _all: 1 } },
      ]);
    });

    it('deja intactas las respuestas que no son agregados', () => {
      const rows = [{ id: 'o1', total: 10.2 }];
      expect(decodeAggregates('Order', rows)).toEqual(rows);
      expect(decodeAggregates('Order', 3)).toBe(3);
    });

    it('no decodifica columnas que no son dinero', () => {
      expect(decodeAggregates('Product', { _sum: { stock: 25 } })).toEqual({
        _sum: { stock: 25 },
      });
    });
  });
});
