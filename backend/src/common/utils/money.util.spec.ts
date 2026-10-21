import {
  compareMoney,
  fitToBalance,
  fromCents,
  isZero,
  money,
  moneyFieldsFromCents,
  moneyFieldsToCents,
  round2,
  toCents,
  toMoney,
} from './money.util';

describe('money.util', () => {
  describe('toCents / fromCents', () => {
    it('convierte un monto a centavos enteros', () => {
      expect(toCents(194.34)).toBe(19434);
      expect(toCents('194.34')).toBe(19434);
      expect(toCents(0.01)).toBe(1);
      expect(toCents(0)).toBe(0);
    });

    it('tolera valores vacios o invalidos (devuelve 0)', () => {
      expect(toCents(null)).toBe(0);
      expect(toCents(undefined)).toBe(0);
      expect(toCents('')).toBe(0);
      expect(toCents('no-es-un-numero')).toBe(0);
      expect(toCents(Number.NaN)).toBe(0);
      expect(toCents(Number.POSITIVE_INFINITY)).toBe(0);
    });

    it('normaliza el cero negativo a 0', () => {
      expect(Object.is(toCents(-0), 0)).toBe(true);
      expect(Object.is(round2(-0.0001), 0)).toBe(true);
    });

    it('recorta a centavos sin redondear (nunca hacia arriba)', () => {
      expect(toCents(1.005)).toBe(100);
      expect(toCents(1.009)).toBe(100);
      expect(toCents(1.004)).toBe(100);
      expect(toCents(17.5685)).toBe(1756);
      // El ruido del punto flotante no resta un centavo.
      expect(toCents(17.56)).toBe(1756);
      expect(toCents(0.07)).toBe(7);
      // Las tasas si se redondean (`round2`), porque no son dinero.
      expect(round2(1.005)).toBe(1.01);
      expect(round2(1.004)).toBe(1);
    });

    it('round2 sigue redondeando a 2 decimales (solo para tasas)', () => {
      for (const value of [0.1, 0.3, 0.105, 194.34, 7.999, 1234.567]) {
        expect(round2(value)).toBe(Math.round(value * 100) / 100);
      }
    });
  });

  describe('toMoney', () => {
    it('normaliza cualquier entrada a un monto de 2 decimales, recortando', () => {
      expect(toMoney('12.345')).toBe(12.34);
      expect(toMoney(null)).toBe(0);
      expect(toMoney(Number.NaN)).toBe(0);
    });
  });

  describe('aritmetica exacta', () => {
    it('suma sin el error de punto flotante clasico', () => {
      expect(money.add(0.1, 0.2)).toBe(0.3);
      expect(money.sum([0.1, 0.2])).toBe(0.3);
    });

    it('suma 30 montos de 0.1 sin deriva', () => {
      const values = Array.from({ length: 30 }, () => 0.1);
      expect(money.sum(values)).toBe(3);
      expect(money.sum(values)).toBe(3);
    });

    it('resta, multiplica y divide redondeando a centavos', () => {
      expect(money.sub(0.3, 0.1)).toBe(0.2);
      expect(money.mul(3, 1.1)).toBe(3.3);
      expect(money.mul(194.34, 2, 1)).toBe(388.68);
      expect(money.div(10, 3)).toBe(3.33);
      expect(money.div(10, 0)).toBe(0);
    });

    it('reparte un total en 3 sin desviarse de la suma', () => {
      const third = money.div(100, 3); // 33.33
      expect(third).toBe(33.33);
      expect(money.sum([third, third, third])).toBe(99.99);
    });

    it('acumula en un bucle sin perder centavos', () => {
      let total = 0;
      for (let i = 0; i < 100; i++) total = money.add(total, 0.07);
      expect(total).toBe(7);
    });
  });

  describe('isZero / compareMoney', () => {
    it('considera cero un monto que no llega al centavo', () => {
      expect(isZero(0)).toBe(true);
      expect(isZero(0.004)).toBe(true);
      expect(isZero(0.01)).toBe(false);
    });

    it('compara montos de forma exacta (a precision de centavo)', () => {
      // 1.005 se recorta a 1.00 (nunca hacia arriba), asi que queda por debajo
      // de 1.01; el centavo se cobra y se compara tal cual se lee.
      expect(compareMoney(1.005, 1.01)).toBe(-1);
      expect(compareMoney(1.009, 1.01)).toBe(-1);
      expect(compareMoney(1.004, 1.01)).toBe(-1);
      expect(compareMoney(1.01, 1.01)).toBe(0);
      expect(compareMoney(1.02, 1.01)).toBe(1);
      expect(compareMoney(0.3, 0.1 + 0.2)).toBe(0);
    });
  });

  describe('fitToBalance', () => {
    it('deja pasar un monto igual o menor al saldo', () => {
      expect(fitToBalance(1.4, 1.5)).toBe(1.4);
      expect(fitToBalance(1.5, 1.5)).toBe(1.5);
    });

    it('iguala al saldo cuando el exceso es solo redondeo (<= 0.02)', () => {
      expect(fitToBalance(1.52, 1.5)).toBe(1.5);
      expect(fitToBalance(1.5, 1.48)).toBe(1.48);
    });

    it('rechaza el cobro cuando el exceso es real', () => {
      expect(fitToBalance(1.53, 1.5)).toBeNull();
      expect(fitToBalance(2, 1.5)).toBeNull();
    });
  });

  describe('moneyFieldsToCents / moneyFieldsFromCents', () => {
    const LINES = [
      { currency: 'USD', amount: 100, rate: 900, baseAmount: 100 },
      { currency: 'EUR', amount: 50, rate: 982.00454402, baseAmount: 54.25 },
    ];
    const FIELDS = ['amount', 'baseAmount'];

    it('convierte solo los campos de dinero y deja la tasa intacta', () => {
      expect(moneyFieldsToCents(LINES, FIELDS)).toEqual([
        { currency: 'USD', amount: 10000, rate: 900, baseAmount: 10000 },
        { currency: 'EUR', amount: 5000, rate: 982.00454402, baseAmount: 5425 },
      ]);
    });

    it('devuelve la lista original al volver a decimales', () => {
      const cents = moneyFieldsToCents(LINES, FIELDS);
      expect(moneyFieldsFromCents(cents, FIELDS)).toEqual(LINES);
    });

    it('no muta la entrada', () => {
      const original = structuredClone(LINES);
      moneyFieldsToCents(LINES, FIELDS);
      expect(LINES).toEqual(original);
    });

    it('tolera valores nulos o corruptos', () => {
      expect(
        moneyFieldsFromCents([{ amount: null, baseAmount: 'x' }], FIELDS),
      ).toEqual([{ amount: null, baseAmount: 0 }]);
    });
  });
});
