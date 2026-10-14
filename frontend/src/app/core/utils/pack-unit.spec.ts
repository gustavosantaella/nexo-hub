import {
  inputQuantity,
  inputUnits,
  isBoxPack,
  isPackUnit,
  packDetail,
  packParts,
  packText,
  stockQuantity,
  stockUnitLabel,
  unitFactor,
} from './pack-unit';

/** Caja de 24 unidades (lo que el POS vende suelto). */
const CAJA = { unit: 'CAJA', unitsPerBox: 24 };
/** Producto suelto, sin presentacion. */
const UND = { unit: 'UND', unitsPerBox: 1 };
/** Carne que se controla en kilos (las recetas consumen 0.1 = 100 g). */
const KG = { unit: 'KG', unitsPerBox: 1 };
/** Bebida medida en litros (botellas). */
const LT = { unit: 'LT', unitsPerBox: 1 };

describe('pack-unit (unidades del inventario)', () => {
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
  });

  describe('conversion a la unidad de stock', () => {
    it('convierte cajas a unidades individuales y al reves', () => {
      expect(unitFactor('CAJA', CAJA)).toBe(24);
      expect(stockQuantity(2, 'CAJA', CAJA)).toBe(48);
      expect(inputQuantity(48, 'CAJA', CAJA)).toBe(2);
    });

    it('convierte gramos y mililitros (botellas) a kilos y litros', () => {
      expect(stockQuantity(750, 'G', KG)).toBe(0.75);
      expect(stockQuantity(250, 'ML', LT)).toBe(0.25);
      expect(inputQuantity(0.75, 'G', KG)).toBe(750);
    });

    it('trata una unidad desconocida o vacia como la unidad base', () => {
      expect(unitFactor('TON', KG)).toBe(1);
      expect(unitFactor('', CAJA)).toBe(1);
      expect(stockQuantity(3, undefined, UND)).toBe(3);
    });
  });

  describe('descripcion de las existencias', () => {
    it('desglosa las cajas completas y las unidades sueltas', () => {
      const parts = packParts(29, CAJA);
      expect(parts.boxes).toBe(1);
      expect(parts.loose).toBe(5);
      expect(packText(29, CAJA)).toBe('1 caja + 5 unidades');
      expect(packText(48, CAJA)).toBe('2 cajas');
      expect(packText(5, CAJA)).toBe('5 unidades');
      expect(packDetail(29, CAJA)).toBe('29 UND');
    });

    it('desglosa kilos, gramos y mililitros', () => {
      expect(packText(2.25, KG)).toBe('2 kg 250 g');
      expect(packText(0.5, LT)).toBe('500 ml');
      expect(packDetail(2.25, KG)).toBe('2.25 KG');
    });

    it('describe los productos sueltos sin detalle extra', () => {
      expect(packText(12, UND)).toBe('12 unidades');
      expect(packDetail(12, UND)).toBeNull();
      expect(stockUnitLabel(CAJA)).toBe('UND');
      expect(stockUnitLabel(KG)).toBe('KG');
      expect(isBoxPack({ unit: 'CAJA', unitsPerBox: 1 })).toBe(true);
      expect(isBoxPack(UND)).toBe(false);
    });

    it('reconoce la unidad de la presentacion (caja o paquete)', () => {
      expect(isPackUnit('CAJA')).toBe(true);
      expect(isPackUnit(' paquete ')).toBe(true);
      expect(isPackUnit('UND')).toBe(false);
      expect(isPackUnit('KG')).toBe(false);
      expect(isPackUnit(null)).toBe(false);
    });
  });
});
