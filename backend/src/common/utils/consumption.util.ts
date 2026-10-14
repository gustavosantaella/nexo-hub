/**
 * CONSUMO DE INVENTARIO CONGELADO de una linea de pedido (snapshot).
 *
 * Una linea vende un producto suelto o un menu (receta). Lo que esa linea
 * descuenta del inventario se calcula al vender con la receta VIGENTE en ese
 * momento y se guarda en `OrderItem.consumption` como JSON. Asi, cuando el
 * pedido se cancela, se corrige la cantidad o se quita la linea, la devolucion
 * usa lo que realmente se desconto y no la receta actual (que pudo cambiar).
 *
 * Formato en la base: `String` con `[{"productId":"...","quantity":0.1}]` porque
 * SQLite no tiene un tipo JSON nativo (mismo criterio que los enums del
 * esquema, que viven como `String`). Las cantidades se normalizan a 3 decimales
 * con las utilidades de cantidad antes de serializarse.
 */

import { mulQty, sumQty, toQty } from './quantity.util';

/** Parte del consumo: cuanto de un producto consume UNA unidad de la linea. */
export interface ConsumptionPart {
  productId: string;
  quantity: number;
}

/**
 * Serializa el consumo para guardarlo. Devuelve `null` cuando no hay nada que
 * guardar (producto suelto o receta vacia): asi la columna queda vacia y el
 * llamador sabe que debe resolver la receta vigente.
 */
export function serializeConsumption(
  parts: ConsumptionPart[] | null | undefined,
): string | null {
  const clean = normalizeParts(parts ?? []);
  if (clean.length === 0) return null;
  return JSON.stringify(clean);
}

/**
 * Lee el consumo guardado. Devuelve `null` si la columna esta vacia o el JSON
 * no es utilizable: el llamador cae entonces a la receta vigente (pedidos
 * anteriores a esta columna).
 */
export function parseConsumption(
  value: string | null | undefined,
): ConsumptionPart[] | null {
  if (!value) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const parts: ConsumptionPart[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const { productId, quantity } = entry as Partial<ConsumptionPart>;
    if (typeof productId !== 'string' || !productId) continue;
    const qty = toQty(quantity);
    if (qty <= 0) continue;
    parts.push({ productId, quantity: qty });
  }

  const clean = normalizeParts(parts);
  return clean.length > 0 ? clean : null;
}

/**
 * Mezcla el consumo congelado de una linea con el de la cantidad que se le
 * agrega, ponderando por las unidades de cada tramo.
 *
 * Una linea del pedido agrupa la misma referencia al mismo precio: si el menu se
 * agrega de nuevo despues de que su receta cambio, lo vendido antes consumio la
 * receta vieja y lo agregado consume la nueva. El promedio ponderado por unidad
 * (`(2 x 0.1 + 3 x 0.2) / 5 = 0.16`) mantiene EXACTO el total devuelto cuando la
 * linea se multiplique por su cantidad final.
 *
 * Cuando la linea no tenia consumo guardado (pedido anterior a la columna) se
 * usa el de la cantidad agregada para toda la linea: es la mejor aproximacion
 * disponible, igual que la receta vigente.
 */
export function blendConsumption(input: {
  /** Consumo por unidad que la linea ya tenia (`null` si no hay snapshot). */
  existing: ConsumptionPart[] | null;
  /** Cantidad que la linea tenia guardada. */
  existingQuantity: number;
  /** Consumo por unidad de lo que se agrega. */
  added: ConsumptionPart[] | null;
  /** Cantidad agregada. */
  addedQuantity: number;
}): ConsumptionPart[] | null {
  const existing = normalizeParts(input.existing ?? []);
  const added = normalizeParts(input.added ?? []);

  if (existing.length === 0) return added.length > 0 ? added : null;
  if (added.length === 0 || input.addedQuantity <= 0) return existing;

  const existingQuantity = Math.max(toQty(input.existingQuantity), 0);
  const total = existingQuantity + input.addedQuantity;
  if (total <= 0) return added.length > 0 ? added : null;

  // Total real consumido por producto = tramo viejo + tramo nuevo.
  const totals = new Map<string, number>();
  for (const part of existing) {
    accumulate(totals, part.productId, mulQty(part.quantity, existingQuantity));
  }
  for (const part of added) {
    accumulate(totals, part.productId, mulQty(part.quantity, input.addedQuantity));
  }

  return normalizeParts(
    [...totals].map(([productId, quantity]) => ({
      productId,
      quantity: toQty(quantity / total),
    })),
  );
}

/** Descarta partes invalidas o sin cantidad y ordena por producto. */
function normalizeParts(parts: ConsumptionPart[]): ConsumptionPart[] {
  const totals = new Map<string, number>();
  for (const part of parts) {
    if (!part?.productId) continue;
    const quantity = toQty(part.quantity);
    if (quantity <= 0) continue;
    accumulate(totals, part.productId, quantity);
  }
  return [...totals]
    .map(([productId, quantity]) => ({ productId, quantity: toQty(quantity) }))
    .sort((a, b) => a.productId.localeCompare(b.productId));
}

function accumulate(
  totals: Map<string, number>,
  productId: string,
  quantity: number,
): void {
  if (quantity <= 0) return;
  totals.set(productId, sumQty([totals.get(productId) ?? 0, quantity]));
}
