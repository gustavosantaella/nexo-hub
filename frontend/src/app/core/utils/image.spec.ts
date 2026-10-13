import { fitSize, LOGO_MAX_SIZE } from './image';

/** Pruebas del ajuste de tamaño del logo (Configuración → Empresa). */
describe('fitSize (logo de la empresa)', () => {
  it('reduce conservando la proporción cuando el lado mayor supera el tope', () => {
    expect(fitSize(1600, 900)).toEqual({ width: 400, height: 225 });
    expect(fitSize(900, 1600)).toEqual({ width: 225, height: 400 });
    expect(fitSize(2000, 2000, 100)).toEqual({ width: 100, height: 100 });
  });

  it('deja igual las imágenes que ya caben (nunca amplía)', () => {
    expect(fitSize(120, 80)).toEqual({ width: 120, height: 80 });
    expect(fitSize(LOGO_MAX_SIZE, LOGO_MAX_SIZE)).toEqual({
      width: LOGO_MAX_SIZE,
      height: LOGO_MAX_SIZE,
    });
  });

  it('nunca devuelve un lado en cero (una imagen 1x1 cabe)', () => {
    expect(fitSize(1, 1)).toEqual({ width: 1, height: 1 });
    expect(fitSize(10000, 10000, 3)).toEqual({ width: 3, height: 3 });
    expect(fitSize(3000, 1, 100)).toEqual({ width: 100, height: 1 });
  });

  it('ignora los valores inválidos', () => {
    expect(fitSize(0, 0)).toEqual({ width: 0, height: 0 });
    expect(fitSize(Number.NaN, 500)).toEqual({ width: 0, height: 0 });
    expect(fitSize(-10, -10)).toEqual({ width: 0, height: 0 });
  });
});
