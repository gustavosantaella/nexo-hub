import { divMoney } from './format';

/**
 * Precio de venta de los productos que se compran por presentacion (caja,
 * paquete, six-pack).
 *
 * El inventario guarda DOS datos del producto: `price` (lo que cuesta la
 * presentacion completa) y `unitsPerBox` (cuantas unidades individuales trae).
 * El stock, en cambio, se lleva SIEMPRE en unidades individuales, de modo que
 * el POS puede vender la caja completa o las unidades sueltas que queden.
 *
 * Por eso el precio que cobra el POS es `price / unitsPerBox`: una caja de
 * $ 24 con 24 unidades se vende suelta a $ 1. Con `unitsPerBox = 1` (producto
 * suelto) el precio no cambia.
 */

/** Tipo minimo que necesitan las ayudas (sirve para `Product` y `ProductOption`). */
interface Presentation {
  price: number;
  unit: string;
  unitsPerBox?: number | null;
}

/** Unidades individuales de la presentacion: entero >= 1 (1 = se vende suelto). */
export function boxUnitsOf(product: { unitsPerBox?: number | null }): number {
  const units = Math.floor(Number(product.unitsPerBox ?? 1));
  return units > 1 ? units : 1;
}

/** `true` cuando el producto se vende fraccionado (precio por caja, stock por unidad). */
export function isBoxProduct(product: { unitsPerBox?: number | null }): boolean {
  return boxUnitsOf(product) > 1;
}

/** Precio de UNA unidad individual: el de la presentacion repartido entre sus unidades. */
export function unitPriceOf(product: Presentation): number {
  return divMoney(product.price, boxUnitsOf(product));
}

/**
 * Unidad que se cobra en el POS: en los productos por caja siempre es la unidad
 * suelta (`UND`), porque el stock y el precio ya estan por unidad.
 */
export function soldUnitLabel(product: Pick<Presentation, 'unit' | 'unitsPerBox'>): string {
  return isBoxProduct(product) ? 'UND' : product.unit;
}
