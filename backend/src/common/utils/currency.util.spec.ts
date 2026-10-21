import {
  canConvert,
  convertFromBase,
  convertToBase,
  exchangeRateOf,
} from './currency.util';

/** Tasas de referencia: 876.7976 Bs por USD y 0.22 Bs por COP. */
const RATES = { bsPerUsd: 876.7976, bsPerCurrency: 876.7976 };
const COP_RATES = { bsPerUsd: 876.7976, bsPerCurrency: 0.22 };

describe('currency.util', () => {
  describe('convertToBase', () => {
    it('deja intacto el monto cuando la moneda ya es la base (USD)', () => {
      expect(convertToBase(50, 'USD', RATES)).toEqual({
        currency: 'USD',
        exchangeRate: 876.7976,
        baseAmount: 50,
        unitsPerBase: 1,
      });
    });

    it('convierte bolivares a dolares con la tasa por USD', () => {
      const result = convertToBase(876.7976, 'VES', RATES);

      expect(result?.currency).toBe('VES');
      expect(result?.exchangeRate).toBe(1);
      expect(result?.baseAmount).toBe(1);
      // Unidades de bolivares por 1 USD: con ella el arqueo suma sin redondear.
      expect(result?.unitsPerBase).toBe(876.7976);
    });

    it('convierte una moneda con tasa propia pasando por el bolivar', () => {
      // 1000 COP * 0.22 Bs = 220 Bs; 220 / 876.7976 = 0.25 USD
      const result = convertToBase(1000, 'COP', COP_RATES);

      expect(result?.currency).toBe('COP');
      expect(result?.exchangeRate).toBe(0.22);
      expect(result?.baseAmount).toBe(0.25);
      // 1 USD = 876.7976 / 0.22 = 3985.44 COP.
      expect(result?.unitsPerBase).toBeCloseTo(876.7976 / 0.22, 6);
    });

    it('normaliza el codigo de la moneda y redondea a 2 decimales', () => {
      expect(convertToBase(10, ' cop ', COP_RATES)?.currency).toBe('COP');
      expect(convertToBase(3, 'VES', RATES)?.baseAmount).toBe(0);
    });

    it('devuelve null cuando falta la tasa de la moneda', () => {
      expect(convertToBase(100, 'COP', { bsPerUsd: 876.7976, bsPerCurrency: null }))
        .toBeNull();
    });

    it('devuelve null cuando falta la tasa del dolar (necesaria como puente)', () => {
      expect(convertToBase(100, 'VES', { bsPerUsd: null, bsPerCurrency: null }))
        .toBeNull();
      expect(convertToBase(100, 'COP', { bsPerUsd: null, bsPerCurrency: 0.22 }))
        .toBeNull();
    });
  });

  describe('convertFromBase', () => {
    it('devuelve el mismo monto para la moneda base', () => {
      expect(convertFromBase(12.5, 'USD', RATES)).toBe(12.5);
    });

    it('expresa un monto en dolares como bolivares', () => {
      // 2 * 876.7976 = 1753.5952 Bs: se recorta (nunca se redondea hacia arriba)
      // porque es el monto que se lee y se cobra en caja.
      expect(convertFromBase(2, 'VES', RATES)).toBe(1753.59);
    });

    it('expresa un monto en dolares en otra moneda configurada', () => {
      // 5 USD * 876.7976 = 4383.99 Bs; / 0.22 = 19927.2181... -> 19927.21 COP
      expect(convertFromBase(5, 'COP', COP_RATES)).toBe(19927.21);
    });

    it('devuelve null cuando falta la tasa', () => {
      expect(convertFromBase(5, 'COP', { bsPerUsd: 876.7976, bsPerCurrency: null }))
        .toBeNull();
    });
  });

  describe('exchangeRateOf', () => {
    it('usa la tasa del dolar para USD', () => {
      expect(exchangeRateOf('USD', RATES)).toBe(876.7976);
    });

    it('usa 1 para el bolivar', () => {
      expect(exchangeRateOf('VES', RATES)).toBe(1);
    });

    it('usa la tasa configurada para otras monedas', () => {
      expect(exchangeRateOf('COP', COP_RATES)).toBe(0.22);
      expect(exchangeRateOf('COP', RATES)).toBe(876.7976);
    });
  });

  describe('canConvert', () => {
    it('solo aprueba las monedas convertibles', () => {
      expect(canConvert('USD', { bsPerUsd: null, bsPerCurrency: null })).toBe(
        true,
      );
      expect(canConvert('VES', RATES)).toBe(true);
      expect(canConvert('COP', COP_RATES)).toBe(true);
      expect(canConvert('COP', { bsPerUsd: 876.7976, bsPerCurrency: null })).toBe(
        false,
      );
    });
  });
});
