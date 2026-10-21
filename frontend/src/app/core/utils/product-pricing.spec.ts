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

    it('reparte sin redondear cuando la division no es exacta', () => {
      // 10 / 3 = 3,333...: el precio unitario conserva la precision completa y
      // solo se recorta a 2 decimales al pintarlo.
      expect(unitPriceOf({ price: 10, unit: 'CAJA', unitsPerBox: 3 })).toBe(10 / 3);
    });

    it('no toca el precio del producto suelto', () => {
      expect(unitPriceOf(loose)).toBe(1.5);
      expect(unitPriceOf({ price: 8.75, unit: 'KG' })).toBe(8.75);
    });

    it('trata la presentacion sin unidades declaradas como producto suelto', () => {
      expect(unitPriceOf({ price: 10, unit: 'CAJA', unitsPerBox: 0 })).toBe(10);
    });

    it('cobra el precio unitario cuando el catalogo lo define', () => {
      // La caja vale $ 24 y la unidad suelta $ 3.50: la caja se sigue cobrando a
      // su precio y la unidad suelta al suyo.
      expect(unitPriceOf({ ...box, unitPrice: 3.5 })).toBe(3.5);
      expect(unitPriceOf({ price: 10, unit: 'CAJA', unitsPerBox: 4, unitPrice: 3 })).toBe(3);
    });

    it('ignora el precio unitario vacio, cero o invalido', () => {
      expect(unitPriceOf({ ...box, unitPrice: 0 })).toBe(1);
      expect(unitPriceOf({ ...box, unitPrice: null })).toBe(1);
      expect(unitPriceOf({ ...box, unitPrice: -2 })).toBe(1);
      expect(unitPriceOf({ ...box, unitPrice: Number.NaN })).toBe(1);
    });

    it('no cambia el precio de un producto suelto que declare precio unitario', () => {
      // Sin presentacion no hay reparto: manda el precio del producto.
      expect(unitPriceOf({ price: 1.5, unit: 'UND', unitsPerBox: 1, unitPrice: 2 })).toBe(1.5);
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
