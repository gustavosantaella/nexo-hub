import {
  boxUnitsOf,
  inputQuantity,
  inputUnits,
  isBoxPack,
  packParts,
  packText,
  stockQuantity,
  unitFactor,
} from './packaging.util';

/** Caja de 24 unidades (lo que el POS vende suelto). */
const CAJA = { unit: 'CAJA', unitsPerBox: 24 };
/** Producto suelto, sin presentacion. */
const UND = { unit: 'UND', unitsPerBox: 1 };
/** Carne que se controla en kilos (las recetas consumen 0.1 = 100 g). */
const KG = { unit: 'KG', unitsPerBox: 1 };
/** Bebida medida en litros. */
const LT = { unit: 'LT', unitsPerBox: 1 };

describe('packaging.util', () => {
  describe('inputUnits', () => {
    it('ofrece cajas y unidades sueltas en los productos por presentacion', () => {
      expect(inputUnits(CAJA)).toEqual([
        { value: 'UND', label: 'unidades sueltas', factor: 1 },
        { value: 'CAJA', label: 'cajas', factor: 24 },
      ]);
    });

    it('ofrece kilogramos y gramos (o litros y mililitros) en los medibles', () => {
      expect(inputUnits(KG).map((option) => option.value)).toEqual(['KG', 'G']);
      expect(inputUnits(LT).map((option) => option.value)).toEqual(['LT', 'ML']);
    });

    it('ofrece una sola unidad cuando el producto se vende suelto', () => {
      expect(inputUnits(UND)).toEqual([
        { value: 'UND', label: 'unidades', factor: 1 },
      ]);
    });

    it('etiqueta los paquetes como paquetes', () => {
      const paquete = { unit: 'PAQUETE', unitsPerBox: 12 };
      expect(inputUnits(paquete)[1]).toEqual({
        value: 'PAQUETE',
        label: 'paquetes',
        factor: 12,
      });
    });
  });

  describe('conversion a la unidad de stock', () => {
    it('convierte cajas a unidades individuales', () => {
      expect(unitFactor('CAJA', CAJA)).toBe(24);
      expect(stockQuantity(2, 'CAJA', CAJA)).toBe(48);
      expect(stockQuantity(1.5, 'CAJA', CAJA)).toBe(36);
    });

    it('convierte gramos/mililitros a kilos/litros', () => {
      expect(stockQuantity(750, 'G', KG)).toBe(0.75);
      expect(stockQuantity(250, 'ML', LT)).toBe(0.25);
      expect(stockQuantity(1.25, 'KG', KG)).toBe(1.25);
    });

    it('trata una unidad desconocida como la unidad base', () => {
      expect(unitFactor('TON', KG)).toBe(1);
      expect(unitFactor('', CAJA)).toBe(1);
    });

    it('es reversible (stock -> unidad escrita)', () => {
      expect(inputQuantity(48, 'CAJA', CAJA)).toBe(2);
      expect(inputQuantity(0.75, 'G', KG)).toBe(750);
    });
  });

  describe('packParts / packText', () => {
    it('desglosa las cajas completas y las unidades sueltas', () => {
      expect(packParts(29, CAJA)).toMatchObject({ boxes: 1, loose: 5 });
      expect(packText(29, CAJA)).toBe('1 caja + 5 unidades');
      expect(packText(48, CAJA)).toBe('2 cajas');
      expect(packText(5, CAJA)).toBe('5 unidades');
    });

    it('desglosa kilos y gramos', () => {
      expect(packText(2.25, KG)).toBe('2 kg 250 g');
      expect(packText(3, KG)).toBe('3 kg');
      expect(packText(0.5, LT)).toBe('500 ml');
      expect(packText(1.5, LT)).toBe('1 L 500 ml');
    });

    it('describe los productos sueltos', () => {
      expect(packText(1, UND)).toBe('1 unidad');
      expect(packText(12, UND)).toBe('12 unidades');
    });

    it('reconoce la presentacion por la unidad o por las unidades por caja', () => {
      expect(isBoxPack(CAJA)).toBe(true);
      expect(isBoxPack({ unit: 'CAJA', unitsPerBox: 1 })).toBe(true);
      expect(isBoxPack(UND)).toBe(false);
      expect(boxUnitsOf({ unitsPerBox: 0 })).toBe(1);
    });
  });
});
