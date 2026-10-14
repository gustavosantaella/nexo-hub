import {
  boxUnitsOf,
  isBoxProduct,
  soldUnitLabel,
  unitPriceOf,
} from './product-pricing';

/** Precio por unidad cuando el producto se compra por presentacion. */
describe('product-pricing (venta por caja o suelta)', () => {
  /** Caja de 24 unidades a $ 24: la unidad suelta se vende a $ 1. */
  const box = { price: 24, unit: 'CAJA', unitsPerBox: 24 };
  /** Producto suelto: precio y unidad no cambian. */
  const loose = { price: 1.5, unit: 'UND', unitsPerBox: 1 };

  describe('boxUnitsOf', () => {
    it('devuelve las unidades de la presentacion', () => {
      expect(boxUnitsOf(box)).toBe(24);
    });

    it('trata los valores vacios, invalidos o menores a 2 como producto suelto', () => {
      expect(boxUnitsOf({})).toBe(1);
      expect(boxUnitsOf({ unitsPerBox: null })).toBe(1);
      expect(boxUnitsOf({ unitsPerBox: 0 })).toBe(1);
      expect(boxUnitsOf({ unitsPerBox: -5 })).toBe(1);
      expect(boxUnitsOf({ unitsPerBox: 1.9 })).toBe(1);
      expect(boxUnitsOf({ unitsPerBox: Number.NaN })).toBe(1);
    });
  });

  describe('isBoxProduct', () => {
    it('distingue el producto por caja del suelto', () => {
      expect(isBoxProduct(box)).toBe(true);
      expect(isBoxProduct(loose)).toBe(false);
      expect(isBoxProduct({})).toBe(false);
    });
  });

  describe('unitPriceOf', () => {
    it('reparte el precio de la caja entre sus unidades', () => {
      expect(unitPriceOf(box)).toBe(1);
      expect(unitPriceOf({ price: 10, unit: 'CAJA', unitsPerBox: 4 })).toBe(2.5);
    });

    it('redondea a centavos cuando la division no es exacta', () => {
      expect(unitPriceOf({ price: 10, unit: 'CAJA', unitsPerBox: 3 })).toBe(3.33);
    });

    it('no toca el precio del producto suelto', () => {
      expect(unitPriceOf(loose)).toBe(1.5);
      expect(unitPriceOf({ price: 8.75, unit: 'KG' })).toBe(8.75);
    });

    it('trata la presentacion sin unidades declaradas como producto suelto', () => {
      expect(unitPriceOf({ price: 10, unit: 'CAJA', unitsPerBox: 0 })).toBe(10);
    });
  });

  describe('soldUnitLabel', () => {
    it('cobra unidades sueltas en los productos por caja', () => {
      expect(soldUnitLabel(box)).toBe('UND');
    });

    it('conserva la unidad del producto suelto', () => {
      expect(soldUnitLabel(loose)).toBe('UND');
      expect(soldUnitLabel({ unit: 'KG', unitsPerBox: 1 })).toBe('KG');
    });
  });
});
