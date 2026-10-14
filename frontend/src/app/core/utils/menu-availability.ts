import type { InactiveIngredientRef } from '../models/api.model';

/**
 * Datos minimos de un menu para explicar su disponibilidad. Los consumen la
 * carta del POS, el buscador de pedidos y el listado de menus.
 */
export interface MenuAvailabilityInfo {
  available: boolean;
  /** Porciones que permite el inventario (`null` = sin tope). */
  maxServings: number | null;
  /** Ingredientes desactivados que bloquean la venta. */
  inactiveIngredients?: InactiveIngredientRef[] | null;
}

/**
 * Motivo por el que un menu NO se puede vender (`null` cuando si se puede).
 *
 * Hay dos causas distintas y el cajero debe distinguirlas: un plato sin stock
 * ("Agotado") se resuelve reponiendo inventario, mientras que un ingrediente
 * desactivado exige corregir la receta del menu.
 */
export function menuUnavailableReason(
  menu: MenuAvailabilityInfo,
): string | null {
  if (menu.available) return null;

  const inactive = menu.inactiveIngredients ?? [];
  if (inactive.length > 0) {
    return `No disponible: ingrediente inactivo (${inactive
      .map((ingredient) => ingredient.name)
      .join(', ')})`;
  }
  return 'Agotado';
}

/**
 * Etiqueta de existencias del menu para el POS y los pedidos. Un menu bloqueado
 * por un ingrediente inactivo se rotula como tal aunque el stock alcance.
 */
export function menuStockLabel(menu: MenuAvailabilityInfo): string {
  if ((menu.inactiveIngredients?.length ?? 0) > 0) return 'Inactivo';
  if (menu.maxServings === null) return 'Ilimitado';
  if (menu.maxServings > 0) return `${menu.maxServings} disp.`;
  return 'Agotado';
}

/** Texto del globito de disponibilidad: el motivo o las porciones que quedan. */
export function menuStockHint(menu: MenuAvailabilityInfo): string {
  const reason = menuUnavailableReason(menu);
  if (reason) return reason;
  return menu.maxServings === null
    ? 'Sin tope de inventario'
    : `${menu.maxServings} porciones disponibles`;
}

/** Nombre de un menu con el motivo de su indisponibilidad (`title` del POS). */
export function menuTitle(
  menu: MenuAvailabilityInfo & { name: string },
): string {
  const reason = menuUnavailableReason(menu);
  return reason ? `${menu.name} — ${reason}` : menu.name;
}
