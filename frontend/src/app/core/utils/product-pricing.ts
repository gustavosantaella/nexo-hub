import { BASE_CURRENCY_CODE } from '../constants/currency';
import { divMoney } from './format';

/**
 * Precio de venta de los productos que se compran por presentacion (caja,
 * paquete, six-pack).
 *
 * El inventario guarda TRES datos del producto: `price` (lo que cuesta la
 * presentacion completa), `unitPrice` (el precio de venta de UNA unidad suelta,
 * `0` = sin definir) y `unitsPerBox` (cuantas unidades individuales trae). El
 * stock, en cambio, se lleva SIEMPRE en unidades individuales, de modo que el POS
 * puede vender la caja completa o las unidades sueltas que queden.
 *
 * Por eso el precio que cobra el POS por la unidad suelta es `unitPrice` y, si el
 * operador no lo definio, `price / unitsPerBox`: una caja de $ 24 con 24 unidades
 * se vende suelta a $ 1. Con `unitsPerBox = 1` (producto suelto) el precio no
 * cambia.
 */

/** Tipo minimo que necesitan las ayudas (sirve para `Product` y `ProductOption`). */
interface Presentation {
  price: number;
  unit: string;
  unitsPerBox?: number | null;
  /** Precio de venta de una unidad suelta; 0 o ausente = repartir `price`. */
  unitPrice?: number | null;
}

/** Presentacion con el contexto de moneda del precio unitario (opcional). */
interface UnitPriceDetail extends Presentation {
  priceEntered?: number | null;
  priceCurrency?: string | null;
  priceRateKey?: string | null;
  unitPriceEntered?: number | null;
  unitPriceCurrency?: string | null;
  unitPriceRateKey?: string | null;
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

/**
 * Precio de venta de UNA unidad individual.
 *
 * Si el operador fijo un precio unitario (`unitPrice > 0`) se cobra ese; si no,
 * se reparte el precio de la presentacion entre sus unidades (`price /
 * unitsPerBox`). En un producto suelto (sin presentacion) el precio es el suyo.
 */
export function unitPriceOf(product: Presentation): number {
  if (boxUnitsOf(product) > 1) {
    const explicit = Number(product.unitPrice ?? 0);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
  }
  return divMoney(product.price, boxUnitsOf(product));
}

/** Monto exacto cargado a mano en el catalogo, con su moneda. */
export interface EnteredPrice {
  amount: number;
  currency: string;
}

/**
 * Precio de la presentacion completa TAL COMO se escribio en el catalogo.
 *
 * El monto guardado en USD pierde los decimales que no llegan a un centavo
 * (Bs 15.520,00 al BCV 887,30 son $ 17,49); con este contexto el POS conserva
 * los Bs 15.520,00 exactos para el ticket y el cobro.
 *
 * `null` cuando el catalogo no guardo el monto escrito (precio cargado en USD o
 * registro anterior a `priceEntered`): en ese caso el USD guardado es el exacto.
 */
export function enteredBoxPriceOf(product: UnitPriceDetail): EnteredPrice | null {
  const amount = Number(product.priceEntered ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const currency = String(product.priceCurrency ?? BASE_CURRENCY_CODE).toUpperCase();
  if (currency === BASE_CURRENCY_CODE) return null;
  return { amount, currency };
}

/**
 * Precio de UNA unidad suelta tal como se escribio en el catalogo.
 *
 * Usa `unitPriceEntered` cuando el operador definio un precio unitario propio;
 * si no, reparte el precio escrito de la presentacion entre sus unidades. En un
 * producto suelto equivale al precio de la presentacion.
 */
export function enteredUnitPriceOf(product: UnitPriceDetail): EnteredPrice | null {
  const units = boxUnitsOf(product);
  if (units > 1) {
    const explicit = Number(product.unitPrice ?? 0);
    const entered = Number(product.unitPriceEntered ?? 0);
    if (Number.isFinite(explicit) && explicit > 0) {
      if (!Number.isFinite(entered) || entered <= 0) return null;
      const currency = String(
        product.unitPriceCurrency ?? product.priceCurrency ?? BASE_CURRENCY_CODE,
      ).toUpperCase();
      if (currency === BASE_CURRENCY_CODE) return null;
      return { amount: entered, currency };
    }
  }

  const box = enteredBoxPriceOf(product);
  if (!box) return null;
  return { amount: divMoney(box.amount, units), currency: box.currency };
}

/**
 * Unidad que se cobra en el POS: en los productos por caja siempre es la unidad
 * suelta (`UND`), porque el stock y el precio ya estan por unidad.
 */
export function soldUnitLabel(product: Pick<Presentation, 'unit' | 'unitsPerBox'>): string {
  return isBoxProduct(product) ? 'UND' : product.unit;
}

/**
 * Precio de la unidad suelta TAL COMO lo escribio el operador, cuando es el que
 * la venta cobra (`unitPriceOf` usa el precio unitario explicito).
 *
 * Las pantallas muestran los montos guardados en USD convertidos a la moneda de
 * visualizacion, con precision de centavos: Bs 350,00 a 970 Bs por dolar son
 * $ 0,36 y al volver a bolivares darian 349,20. Con este contexto la lista
 * recupera el monto escrito (`moneyLoaded`).
 *
 * `null` cuando no aplica: producto que se vende entero, precio unitario sin
 * definir (se reparte `price`, y el monto cargado no es el que se cobra) o
 * monto no numerico.
 */
export function loadedUnitPrice(product: UnitPriceDetail): {
  amount: number;
  currency: string;
  rateKey: string | null;
} | null {
  if (boxUnitsOf(product) <= 1) return null;
  const explicit = Number(product.unitPrice ?? 0);
  const entered = Number(product.unitPriceEntered ?? 0);
  if (!Number.isFinite(explicit) || explicit <= 0) return null;
  if (!Number.isFinite(entered) || entered <= 0) return null;
  return {
    amount: entered,
    currency: product.unitPriceCurrency ?? BASE_CURRENCY_CODE,
    rateKey: product.unitPriceRateKey ?? null,
  };
}
