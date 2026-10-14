import {
  COMPACT_FROM,
  bsCompact,
  compact,
  divMoney,
  isCompact,
  money,
  moneyCompact,
  moneyInCompact,
  number,
} from './format';

/** Numeros abreviados: escala (k, m, b), redondeo y tooltips exactos. */
describe('format (valores abreviados)', () => {
  describe('compact', () => {
    it('abrevia miles, millones y miles de millones', () => {
      expect(compact(1_500)).toBe('1.5k');
      expect(compact(3_000)).toBe('3k');
      expect(compact(12_500)).toBe('12.5k');
      expect(compact(1_000_000)).toBe('1m');
      expect(compact(1_250_000)).toBe('1.3m');
      expect(compact(2_500_000_000)).toBe('2.5b');
    });

    it('sube de escala en vez de pintar "1000k"', () => {
      expect(compact(999_999)).toBe('1m');
      expect(compact(999_950_000)).toBe('1b');
    });

    it('conserva el signo y deja intactos los numeros pequenos', () => {
      expect(compact(-1_500)).toBe('-1.5k');
      expect(compact(-1_250_000)).toBe('-1.3m');
      expect(compact(0)).toBe('0');
      expect(compact(999)).toBe('999');
      expect(compact(12.5)).toBe('12.5');
    });

    it('trata los valores no numericos como cero', () => {
      expect(compact(Number.NaN)).toBe('0');
      expect(compact(null)).toBe('0');
      expect(compact(undefined)).toBe('0');
    });

    it('respeta los decimales pedidos', () => {
      expect(compact(1_234_567, 2)).toBe('1.23m');
      expect(compact(1_250, 0)).toBe('1k');
    });
  });

  describe('isCompact', () => {
    it('abrevia a partir de la magnitud por defecto', () => {
      expect(COMPACT_FROM).toBe(10_000);
      expect(isCompact(9_999)).toBe(false);
      expect(isCompact(-9_999)).toBe(false);
      expect(isCompact(10_000)).toBe(true);
      expect(isCompact(-10_000)).toBe(true);
    });

    it('acepta una magnitud propia para los espacios mas estrechos', () => {
      expect(isCompact(1_500)).toBe(false);
      expect(isCompact(1_500, 1_000)).toBe(true);
    });
  });

  describe('montos abreviados', () => {
    it('antepone el simbolo de cada moneda', () => {
      expect(moneyCompact(1_250_000)).toBe('$ 1.3m');
      expect(moneyInCompact(3_200, 'VES')).toBe('Bs 3.2k');
      expect(moneyInCompact(1_500, 'COP')).toBe('COL$ 1.5k');
      expect(bsCompact(1_052_110.66)).toBe('Bs 1.1m');
    });

    it('mantiene el monto exacto disponible para el tooltip', () => {
      expect(money(1_250_000)).toBe('$ 1,250,000.00');
      expect(number(1_250_000)).toBe('1,250,000');
    });
  });

  describe('aritmetica de montos', () => {
    it('divide redondeando a centavos (0 cuando el divisor es 0)', () => {
      expect(divMoney(24, 24)).toBe(1);
      expect(divMoney(10, 4)).toBe(2.5);
      expect(divMoney(10, 3)).toBe(3.33);
      expect(divMoney(10, 0)).toBe(0);
    });
  });
});
