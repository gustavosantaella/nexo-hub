import {
  menuStockHint,
  menuStockLabel,
  menuTitle,
  menuUnavailableReason,
} from './menu-availability';

/** Menu disponible con 5 porciones por inventario. */
const DISPONIBLE = {
  name: 'Parrilla',
  available: true,
  maxServings: 5,
  inactiveIngredients: [],
};

/** Plato agotado: sin stock, pero la receta esta sana. */
const AGOTADO = {
  name: 'Plato agotado',
  available: false,
  maxServings: 0,
  inactiveIngredients: [],
};

/** Menu con stock, pero con un ingrediente desactivado en la receta. */
const RECETA_ROTA = {
  name: 'Combo',
  available: false,
  maxServings: 12,
  inactiveIngredients: [
    { id: 'p9', name: 'Insumo viejo' },
    { id: 'p8', name: 'Salsa retirada' },
  ],
};

describe('menu-availability', () => {
  describe('menuUnavailableReason', () => {
    it('no hay motivo cuando el menu se puede vender', () => {
      expect(menuUnavailableReason(DISPONIBLE)).toBeNull();
    });

    it('distingue un plato agotado de una receta con insumo inactivo', () => {
      expect(menuUnavailableReason(AGOTADO)).toBe('Agotado');
      expect(menuUnavailableReason(RECETA_ROTA)).toBe(
        'No disponible: ingrediente inactivo (Insumo viejo, Salsa retirada)',
      );
    });
  });

  describe('menuStockLabel', () => {
    it('rotula las porciones, el tope ilimitado y la falta de stock', () => {
      expect(menuStockLabel(DISPONIBLE)).toBe('5 disp.');
      expect(menuStockLabel({ ...DISPONIBLE, maxServings: null })).toBe(
        'Ilimitado',
      );
      expect(menuStockLabel(AGOTADO)).toBe('Agotado');
    });

    it('prioriza el ingrediente inactivo sobre las porciones disponibles', () => {
      expect(menuStockLabel(RECETA_ROTA)).toBe('Inactivo');
    });
  });

  describe('menuStockHint', () => {
    it('explica el motivo cuando esta bloqueado y el tope cuando no', () => {
      expect(menuStockHint(RECETA_ROTA)).toContain('ingrediente inactivo');
      expect(menuStockHint(DISPONIBLE)).toBe('5 porciones disponibles');
      expect(menuStockHint({ ...DISPONIBLE, maxServings: null })).toBe(
        'Sin tope de inventario',
      );
    });
  });

  describe('menuTitle', () => {
    it('agrega el motivo al nombre solo cuando no se puede vender', () => {
      expect(menuTitle(DISPONIBLE)).toBe('Parrilla');
      expect(menuTitle(AGOTADO)).toBe('Plato agotado — Agotado');
    });
  });
});
