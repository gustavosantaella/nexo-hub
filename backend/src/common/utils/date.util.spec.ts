import { buildDateRange, parseDateBoundary } from './date.util';

/**
 * El bug original: `new Date('2026-10-13')` es medianoche UTC, que en zonas
 * al oeste de UTC cae en el dia anterior. Estos tests fijan que una fecha sin
 * hora se interprete como fecha local (el dia que ve el usuario).
 */
describe('date.util', () => {
  describe('parseDateBoundary', () => {
    it('interpreta una fecha sin hora como inicio del dia local', () => {
      const result = parseDateBoundary('2026-10-13', 'start');

      expect(result.getFullYear()).toBe(2026);
      expect(result.getMonth()).toBe(9); // octubre (0-indexado)
      expect(result.getDate()).toBe(13);
      expect(result.getHours()).toBe(0);
      expect(result.getMinutes()).toBe(0);
      expect(result.getSeconds()).toBe(0);
      expect(result.getMilliseconds()).toBe(0);
    });

    it('interpreta una fecha sin hora como fin del dia local', () => {
      const result = parseDateBoundary('2026-10-13', 'end');

      expect(result.getDate()).toBe(13);
      expect(result.getHours()).toBe(23);
      expect(result.getMinutes()).toBe(59);
      expect(result.getSeconds()).toBe(59);
      expect(result.getMilliseconds()).toBe(999);
    });

    it('respeta un ISO con hora tal cual', () => {
      const result = parseDateBoundary('2026-10-13T10:30:00.000Z', 'start');

      expect(result.toISOString()).toBe('2026-10-13T10:30:00.000Z');
    });
  });

  describe('buildDateRange', () => {
    it('cubre el dia completo en hora local (mismo inicio y fin de dia)', () => {
      const range = buildDateRange('2026-10-13', '2026-10-13');

      expect(range.gte?.getDate()).toBe(13);
      expect(range.gte?.getHours()).toBe(0);
      expect(range.lte?.getDate()).toBe(13);
      expect(range.lte?.getHours()).toBe(23);

      // Un pedido creado hoy a media manana cae dentro del rango.
      const midday = new Date(2026, 9, 13, 10, 0, 0, 0);
      expect(midday.getTime()).toBeGreaterThanOrEqual(range.gte!.getTime());
      expect(midday.getTime()).toBeLessThanOrEqual(range.lte!.getTime());
    });

    it('omite los limites no enviados', () => {
      expect(buildDateRange(undefined, undefined)).toEqual({});
      expect(buildDateRange('2026-10-13')).toEqual({
        gte: parseDateBoundary('2026-10-13', 'start'),
      });
      expect(buildDateRange(null, '2026-10-13')).toEqual({
        lte: parseDateBoundary('2026-10-13', 'end'),
      });
    });
  });
});
