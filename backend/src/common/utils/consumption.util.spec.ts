import {
  blendConsumption,
  parseConsumption,
  serializeConsumption,
} from './consumption.util';

/** Receta de ejemplo: medio cafe (0.5) y un postre (1). */
const RECETA = [
  { productId: 'p1', quantity: 0.5 },
  { productId: 'p2', quantity: 1 },
];

describe('consumption.util (consumo congelado de una linea de pedido)', () => {
  describe('serializeConsumption', () => {
    it('guarda el consumo por unidad como JSON', () => {
      expect(serializeConsumption(RECETA)).toBe(
        '[{"productId":"p1","quantity":0.5},{"productId":"p2","quantity":1}]',
      );
    });

    it('devuelve null cuando no hay nada que guardar', () => {
      expect(serializeConsumption([])).toBeNull();
      expect(serializeConsumption(null)).toBeNull();
      expect(serializeConsumption(undefined)).toBeNull();
    });

    it('descarta las cantidades cero y suma los productos repetidos', () => {
      expect(
        serializeConsumption([
          { productId: 'p1', quantity: 0 },
          { productId: 'p1', quantity: 0.25 },
          { productId: 'p1', quantity: 0.25 },
        ]),
      ).toBe('[{"productId":"p1","quantity":0.5}]');
    });
  });

  describe('parseConsumption', () => {
    it('reconstruye el consumo guardado', () => {
      expect(parseConsumption(serializeConsumption(RECETA))).toEqual(RECETA);
    });

    it('normaliza las cantidades a 3 decimales', () => {
      expect(
        parseConsumption('[{"productId":"p1","quantity":0.33333}]'),
      ).toEqual([{ productId: 'p1', quantity: 0.333 }]);
    });

    it('devuelve null cuando la columna esta vacia', () => {
      expect(parseConsumption(null)).toBeNull();
      expect(parseConsumption(undefined)).toBeNull();
      expect(parseConsumption('')).toBeNull();
    });

    it('devuelve null (y cae a la receta vigente) si el JSON es invalido', () => {
      expect(parseConsumption('no-es-json')).toBeNull();
      expect(parseConsumption('{"productId":"p1"}')).toBeNull();
      expect(parseConsumption('[]')).toBeNull();
      expect(parseConsumption('[{"quantity":1}]')).toBeNull();
    });
  });

  describe('blendConsumption (promedio ponderado por unidades)', () => {
    it('devuelve el consumo agregado cuando la linea no tenia snapshot', () => {
      expect(
        blendConsumption({
          existing: null,
          existingQuantity: 2,
          added: RECETA,
          addedQuantity: 1,
        }),
      ).toEqual(RECETA);
    });

    it('pondera el tramo viejo y el nuevo al agregar cantidad a la linea', () => {
      // 2 unidades al 0.1 de la receta vieja + 3 al 0.2 de la nueva = 0.8 en 5.
      const blended = blendConsumption({
        existing: [{ productId: 'p1', quantity: 0.1 }],
        existingQuantity: 2,
        added: [{ productId: 'p1', quantity: 0.2 }],
        addedQuantity: 3,
      });
      expect(blended).toEqual([{ productId: 'p1', quantity: 0.16 }]);
      // El total devuelto sigue siendo el real: 0.16 x 5 = 0.8.
      expect(0.16 * 5).toBeCloseTo(0.8, 10);
    });

    it('mantiene el consumo viejo cuando solo crece la cantidad', () => {
      expect(
        blendConsumption({
          existing: RECETA,
          existingQuantity: 1,
          added: RECETA,
          addedQuantity: 4,
        }),
      ).toEqual(RECETA);
    });

    it('conserva el consumo congelado si no llega receta nueva', () => {
      expect(
        blendConsumption({
          existing: RECETA,
          existingQuantity: 2,
          added: [],
          addedQuantity: 0,
        }),
      ).toEqual(RECETA);
    });
  });
});
