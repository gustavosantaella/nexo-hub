/**
 * Utilidades de CANTIDAD (existencias y consumos de inventario).
 *
 * A diferencia del dinero (que se guarda en centavos enteros con su codec en la
 * frontera de Prisma), las cantidades viven en la base como `Float` con 3
 * decimales: las recetas consumen fracciones (100 g de un producto que se
 * controla en kilos son 0.1) y redondear a enteros descuadraria el inventario.
 *
 * La regla es la misma que con el dinero: TODO valor se normaliza a 3 decimales
 * antes de guardarse o compararse, y quien normaliza es el motor de inventario
 * (`InventoryService.applyMovement`), unico autorizado para variar el stock.
 * El redondeo a 3 cifras elimina la deriva de punto flotante (0.1 + 0.2).
 */

/** Decimales de las cantidades (3) y su factor de escala. */
export const QTY_DECIMALS = 3;
export const QTY_SCALE = 1000;

/** Cantidad -> milesimas enteras (evita la deriva de punto flotante). */
export function toQtyMilli(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : (value as number);
  if (!Number.isFinite(parsed)) return 0;
  const milli = Math.round((parsed as number + Number.EPSILON) * QTY_SCALE);
  return milli === 0 ? 0 : milli; // normaliza "-0"
}

/** Milesimas enteras -> cantidad (decimal con 3 cifras). */
export function fromQtyMilli(milli: number): number {
  return milli / QTY_SCALE;
}

/** Normaliza cualquier entrada (string, null, undefined) a una cantidad valida. */
export function toQty(value: unknown): number {
  return fromQtyMilli(toQtyMilli(value));
}

/** Redondea una cantidad a 3 decimales de forma segura. */
export function roundQty(value: number): number {
  return toQty(value);
}

/** Suma cantidades redondeando una sola vez el resultado. */
export function sumQty(values: number[]): number {
  return fromQtyMilli(values.reduce((acc, value) => acc + toQtyMilli(value), 0));
}

/** Multiplica una cantidad por un factor (ej. receta x unidades vendidas). */
export function mulQty(quantity: number, factor: number): number {
  if (!Number.isFinite(factor)) return 0;
  return fromQtyMilli(Math.round(toQtyMilli(quantity) * factor));
}

/** Compara cantidades: -1 si a<b, 0 si son iguales, 1 si a>b (exacto). */
export function compareQty(a: number, b: number): number {
  const diff = toQtyMilli(a) - toQtyMilli(b);
  if (diff === 0) return 0;
  return diff > 0 ? 1 : -1;
}

/** `true` cuando la cantidad es efectivamente cero (no llega a una milesima). */
export function isZeroQty(value: number): boolean {
  return toQtyMilli(value) === 0;
}
