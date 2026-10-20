import {
  COMPACT_FROM,
  bsCompact,
  compact,
  divMoney,
  isCompact,
  money,
  moneyCompact,
  moneyInCompact,
  moneyLoaded,
  moneyLoadedCompact,
  number,
  setDisplayCurrency,
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

  describe('moneda base de visualizacion', () => {
    afterEach(() => setDisplayCurrency(null));

    it('formatea en dolares mientras el sistema no elija otra moneda', () => {
      expect(money(1234.5)).toBe('$ 1,234.50');
      expect(moneyCompact(1_250_000)).toBe('$ 1.3m');
    });

    it('expresa el monto en la moneda base elegida', () => {
      setDisplayCurrency({
        code: 'VES',
        label: 'Bolívares',
        symbol: 'Bs',
        decimals: 2,
        bsPerUnit: 1,
        bsPerUsd: 876.7976,
      });

      // 10 USD * 876.7976 = 8 767,976 Bs.
      expect(money(10)).toBe('Bs 8,767.98');
      expect(moneyCompact(1_250_000)).toBe('Bs 1.1b');
    });

    it('redondea el monto base antes de convertirlo a la moneda visible', () => {
      setDisplayCurrency({
        code: 'VES',
        label: 'Bolívares',
        symbol: 'Bs',
        decimals: 2,
        bsPerUnit: 1,
        bsPerUsd: 881.87,
      });

      // El total guardado trae decimales ocultos (9,3494 USD): el cajero lee
      // USD 9,35 y el total en Bs tiene que corresponder a esos 9,35.
      expect(money(9.3494)).toBe('Bs 8,245.48');
    });

    it('convierte con la tasa de la moneda elegida (no solo cambia el simbolo)', () => {
      setDisplayCurrency({
        code: 'EUR',
        label: 'Euros',
        symbol: '€',
        decimals: 2,
        bsPerUnit: 982.00454402,
        bsPerUsd: 876.7976,
      });

      // 10 USD = 8 767,976 Bs / 982,00454402 = 8,928...
      expect(money(10)).toBe('€ 8.93');
    });

    it('vuelve al dolar cuando la moneda elegida todavia no tiene tasa', () => {
      setDisplayCurrency({
        code: 'COP',
        label: 'Pesos colombianos',
        symbol: 'COL$',
        decimals: 2,
        bsPerUnit: null,
        bsPerUsd: 876.7976,
      });

      expect(money(10)).toBe('$ 10.00');
    });
  });

  /**
   * Montos cargados a mano (`*Entered` + `*Currency`): el sistema guarda en USD
   * redondeado a centavos, asi que Bs 350,00 a 970 Bs por dolar son $ 0,36 y al
   * volver a bolivares darian 349,20. Con el contexto de moneda la pantalla
   * recupera el monto escrito.
   */
  describe('monto tal como se cargo (moneyLoaded)', () => {
    /** Moneda de visualizacion en bolivares a 970 Bs por dolar. */
    const BOLIVARES = {
      code: 'VES',
      label: 'Bolívares',
      symbol: 'Bs',
      decimals: 2,
      bsPerUnit: 1,
      bsPerUsd: 970,
    };

    afterEach(() => setDisplayCurrency(null));

    it('no aplica mientras el sistema muestra los montos en dolares', () => {
      expect(moneyLoaded(350, 'VES')).toBeNull();
      expect(moneyLoadedCompact(350, 'VES')).toBeNull();
    });

    it('no aplica sin monto cargado, en 0 o en la moneda base', () => {
      setDisplayCurrency(BOLIVARES);

      expect(moneyLoaded(null, 'VES')).toBeNull();
      expect(moneyLoaded(undefined, 'VES')).toBeNull();
      expect(moneyLoaded(0, 'VES')).toBeNull();
      // Se cargo en dolares: no hay nada que recuperar.
      expect(moneyLoaded(10, 'USD')).toBeNull();
      expect(moneyLoaded(10, null)).toBeNull();
    });

    it('imprime el monto escrito en vez del redondeo a centavos de dolar', () => {
      setDisplayCurrency(BOLIVARES);

      // 0,36 USD * 970 = 349,20 Bs: el redondeo que veia el operador.
      expect(money(0.36)).toBe('Bs 349.20');
      expect(moneyLoaded(350, 'VES')).toBe('Bs 350.00');
      expect(moneyLoaded(350, 'ves')).toBe('Bs 350.00');
    });

    it('abrevia el monto cargado con su valor exacto disponible', () => {
      setDisplayCurrency(BOLIVARES);

      expect(moneyLoadedCompact(3500, 'VES')).toBe('Bs 3.5k');
      expect(moneyLoaded(3500, 'VES')).toBe('Bs 3,500.00');
    });

    it('formatea el monto cargado en su moneda cuando hay varias tasas', () => {
      setDisplayCurrency({
        code: 'EUR',
        label: 'Euros',
        symbol: '€',
        decimals: 2,
        bsPerUnit: 982.00454402,
        bsPerUsd: 876.7976,
      });

      // Cargado en EUR: se imprime tal cual (no se convierte a dolares).
      expect(moneyLoaded(120, 'EUR')).toBe('€ 120.00');
      // Cargado en bolivares mientras se muestra en euros: manda el guardado.
      expect(moneyLoaded(350, 'VES')).toBeNull();
    });
  });
});
