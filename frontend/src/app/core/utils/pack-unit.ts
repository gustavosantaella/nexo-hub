import { boxUnitsOf, isBoxProduct } from './product-pricing';

/**
 * Unidades del inventario (espejo de `backend/src/common/utils/packaging.util.ts`).
 *
 * El stock de un producto vive SIEMPRE en su unidad base (`unit`):
 *
 *   - `UND` ................ unidad suelta (1 = 1 item).
 *   - `KG` / `LT` .......... kilos o litros, con 3 decimales (0.1 = 100 g).
 *   - `CAJA` / `PAQUETE` ... presentacion con `unitsPerBox` unidades sueltas.
 *
 * El operador escribe el movimiento como lo piensa ("2 cajas", "750 g", "1.5 L")
 * y estas ayudas convierten a la unidad de stock (el backend vuelve a convertir
 * lo que le llega, asi que ambos lados coinciden) y describen lo que queda en el
 * idioma del negocio ("3 cajas + 5 unidades").
 */

/** Unidades base que usan una sub-unidad decimal (kg -> g, lt -> ml). */
export const DECIMAL_SUB_UNITS: Record<
  string,
  { unit: string; label: string; perBase: number }
> = {
  KG: { unit: 'G', label: 'g', perBase: 1000 },
  LT: { unit: 'ML', label: 'ml', perBase: 1000 },
};

/** Unidades que representan una presentacion completa (caja, paquete). */
export const BOX_UNITS: readonly string[] = ['CAJA', 'PAQUETE'];

/** Definicion minima de la presentacion de un producto. */
export interface PackDefinition {
  unit: string;
  unitsPerBox?: number | null;
}

/** Una unidad con la que el operador puede escribir una cantidad. */
export interface InputUnit {
  /** Valor que viaja al API (`inputUnit`). */
  value: string;
  /** Etiqueta para el formulario ("cajas", "gramos (g)", ...). */
  label: string;
  /** Cuantas unidades de STOCK representa 1 de esta unidad. */
  factor: number;
}

/** Normaliza el codigo de una unidad (`caja ` -> `CAJA`). */
export function normalizeUnit(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toUpperCase();
}

/**
 * `true` cuando la unidad declarada es una presentacion completa (caja o
 * paquete): son las unicas unidades que tienen "unidades por caja".
 */
export function isPackUnit(unit: unknown): boolean {
  return BOX_UNITS.includes(normalizeUnit(unit));
}

/** `true` cuando el producto se maneja por presentacion (cajas/paquetes). */
export function isBoxPack(pack: PackDefinition): boolean {
  return isBoxProduct(pack) || isPackUnit(pack.unit);
}

/** Etiqueta de la caja segun la unidad declarada del producto. */
function boxLabel(pack: PackDefinition): string {
  return normalizeUnit(pack.unit) === 'PAQUETE' ? 'paquetes' : 'cajas';
}

/**
 * Unidades con las que el operador puede escribir un movimiento: cajas y
 * unidades sueltas, kg y gramos, litros y mililitros, o la unidad suelta.
 */
export function inputUnits(pack: PackDefinition): InputUnit[] {
  const unit = normalizeUnit(pack.unit);
  const decimal = DECIMAL_SUB_UNITS[unit];
  if (decimal) {
    return [
      {
        value: unit,
        label: unit === 'KG' ? 'kilogramos (kg)' : 'litros (L)',
        factor: 1,
      },
      {
        value: decimal.unit,
        label: unit === 'KG' ? 'gramos (g)' : 'mililitros (ml)',
        factor: 1 / decimal.perBase,
      },
    ];
  }
  if (isBoxPack(pack)) {
    return [
      { value: 'UND', label: 'unidades sueltas', factor: 1 },
      {
        value: unit === 'PAQUETE' ? 'PAQUETE' : 'CAJA',
        label: boxLabel(pack),
        factor: boxUnitsOf(pack),
      },
    ];
  }
  return [{ value: unit || 'UND', label: 'unidades', factor: 1 }];
}

/** Factor de una unidad de entrada respecto a la unidad de stock. */
export function unitFactor(inputUnit: unknown, pack: PackDefinition): number {
  const unit = normalizeUnit(inputUnit);
  const found = inputUnits(pack).find((option) => option.value === unit);
  return found ? found.factor : 1;
}

/** Redondea a 3 decimales (misma precision que el inventario). */
function roundQty(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

/** Unidad en la que se lleva el stock (las presentaciones se llevan sueltas). */
export function stockUnitLabel(pack: PackDefinition): string {
  return isBoxPack(pack) ? 'UND' : normalizeUnit(pack.unit) || 'UND';
}

/**
 * Total en la unidad de stock cuando hay algo mas que contar
 * (`"49 UND"`, `"2.25 KG"`); `null` cuando el texto corto ya lo dice todo.
 */
export function packDetail(
  stock: number | null | undefined,
  pack: PackDefinition,
): string | null {
  const hasDetail =
    isBoxPack(pack) || !!DECIMAL_SUB_UNITS[normalizeUnit(pack.unit)];
  if (!hasDetail) return null;
  return `${text(Number(stock ?? 0))} ${stockUnitLabel(pack)}`;
}

/** Desglose de las existencias en el idioma del negocio. */
export interface PackParts {
  /** Presentaciones completas (cajas, paquetes). 0 si no aplica. */
  boxes: number;
  /** Unidades que no completan una presentacion (o enteros de kg/L). */
  loose: number;
  /** Unidad de la que estan expresadas `loose`/`remainder`. */
  looseUnit: string;
  /** Resto en la sub-unidad decimal (gramos, mililitros). 0 si no aplica. */
  remainder: number;
  /** `G`, `ML` o cadena vacia cuando la unidad no tiene sub-unidad. */
  remainderUnit: string;
}

/** Desglose de una cantidad de stock en cajas/unidades o kg+gramos. */
export function packParts(
  stock: number | null | undefined,
  pack: PackDefinition,
): PackParts {
  const value = Math.max(roundQty(Number(stock ?? 0)), 0);
  if (isBoxPack(pack)) {
    const units = boxUnitsOf(pack);
    const boxes = Math.floor(value / units);
    return {
      boxes,
      loose: roundQty(value - boxes * units),
      looseUnit: 'UND',
      remainder: 0,
      remainderUnit: '',
    };
  }

  const decimal = DECIMAL_SUB_UNITS[normalizeUnit(pack.unit)];
  if (decimal) {
    const whole = Math.floor(value);
    return {
      boxes: 0,
      loose: whole,
      looseUnit: normalizeUnit(pack.unit),
      remainder: Math.round((value - whole) * decimal.perBase),
      remainderUnit: decimal.unit,
    };
  }

  return {
    boxes: 0,
    loose: value,
    looseUnit: normalizeUnit(pack.unit) || 'UND',
    remainder: 0,
    remainderUnit: '',
  };
}

/** Numero con hasta 3 decimales y sin ceros de relleno. */
function text(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/**
 * Texto corto de una cantidad en el idioma del negocio:
 * "3 cajas + 5 unidades", "12 unidades", "2 kg 250 g", "1.5 L".
 */
export function packText(
  stock: number | null | undefined,
  pack: PackDefinition,
): string {
  const parts = packParts(stock, pack);

  if (isBoxPack(pack)) {
    const boxName = normalizeUnit(pack.unit) === 'PAQUETE' ? 'paquete' : 'caja';
    const chunks: string[] = [];
    if (parts.boxes > 0) {
      chunks.push(`${parts.boxes} ${boxName}${parts.boxes === 1 ? '' : 's'}`);
    }
    if (parts.loose > 0 || chunks.length === 0) {
      chunks.push(`${text(parts.loose)} unidad${parts.loose === 1 ? '' : 'es'}`);
    }
    return chunks.join(' + ');
  }

  if (parts.remainderUnit) {
    const base = normalizeUnit(pack.unit) === 'KG' ? 'kg' : 'L';
    const sub = parts.remainderUnit === 'G' ? 'g' : 'ml';
    if (parts.remainder === 0) return `${text(parts.loose)} ${base}`;
    if (parts.loose === 0) return `${text(parts.remainder)} ${sub}`;
    return `${text(parts.loose)} ${base} ${text(parts.remainder)} ${sub}`;
  }

  const unit = parts.looseUnit;
  if (unit === 'UND') {
    return `${text(parts.loose)} unidad${parts.loose === 1 ? '' : 'es'}`;
  }
  return `${text(parts.loose)} ${unit}`;
}

/** Convierte una cantidad escrita en `inputUnit` a la unidad de stock. */
export function stockQuantity(
  quantity: number | null | undefined,
  inputUnit: unknown,
  pack: PackDefinition,
): number {
  const value = Number(quantity ?? 0);
  if (!Number.isFinite(value)) return 0;
  return roundQty(value * unitFactor(inputUnit, pack));
}

/** Convierte una cantidad de la unidad de stock a `inputUnit` (inverso). */
export function inputQuantity(
  stock: number | null | undefined,
  inputUnit: unknown,
  pack: PackDefinition,
): number {
  const value = Number(stock ?? 0);
  if (!Number.isFinite(value)) return 0;
  const factor = unitFactor(inputUnit, pack);
  return roundQty(factor ? value / factor : 0);
}
