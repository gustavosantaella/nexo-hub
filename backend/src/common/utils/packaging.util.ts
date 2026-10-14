/**
 * Unidades de inventario: conversion entre la unidad de STOCK del producto y la
 * unidad con la que el operador PIENSA el movimiento.
 *
 * El stock de un producto vive SIEMPRE en su unidad base (`Product.unit`):
 *
 *   - `UND` ................ unidad suelta (1 = 1 item).
 *   - `KG` / `LT` .......... kilos o litros, con 3 decimales (0.1 = 100 g).
 *   - `CAJA` / `PAQUETE` ... una presentacion con `unitsPerBox` unidades
 *                            individuales; el stock se lleva en unidades sueltas
 *                            (una caja de 24 deja 24 en el inventario).
 *
 * El operador, en cambio, escribe el movimiento como lo piensa: "salieron 2
 * cajas", "entraron 750 g", "vendimos 1.5 L". Estas ayudas convierten esa
 * cantidad a la unidad de stock (y al reves) para que el motor de inventario
 * -que es el unico autorizado a variar el stock- reciba siempre lo mismo, y para
 * poder avisar cuanto queda en el idioma del negocio ("3 cajas + 5 unidades").
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

/**
 * Unidades con las que un operador puede escribir un movimiento de inventario.
 * Las sub-unidades (`G`, `ML`) solo existen como entrada: nunca son la unidad
 * declarada de un producto.
 */
export const INPUT_UNIT_CODES: readonly string[] = [
  'UND',
  'CAJA',
  'PAQUETE',
  'KG',
  'G',
  'LT',
  'ML',
];

/** Definicion minima de la presentacion de un producto. */
export interface PackDefinition {
  unit: string;
  /** Unidades individuales de la presentacion (1 = se vende suelto). */
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

/** Unidades individuales de la presentacion: entero >= 1 (1 = suelto). */
export function boxUnitsOf(pack: { unitsPerBox?: number | null }): number {
  const units = Math.floor(Number(pack.unitsPerBox ?? 1));
  return units > 1 ? units : 1;
}

/** `true` cuando el producto se maneja por presentacion (cajas/paquetes). */
export function isBoxPack(pack: PackDefinition): boolean {
  return boxUnitsOf(pack) > 1 || BOX_UNITS.includes(normalizeUnit(pack.unit));
}

/** Etiqueta de la caja segun la unidad declarada del producto. */
function boxLabel(pack: PackDefinition): string {
  return normalizeUnit(pack.unit) === 'PAQUETE' ? 'paquetes' : 'cajas';
}

/**
 * Unidades con las que el operador puede escribir un movimiento de este
 * producto: cajas y unidades sueltas, kg y gramos, litros y mililitros, o la
 * unidad suelta cuando no hay presentacion.
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

/**
 * Cuantas unidades de STOCK representa 1 unidad de entrada. Una unidad vacia o
 * que no pertenezca al producto se interpreta como la unidad base (factor 1).
 */
export function unitFactor(inputUnit: unknown, pack: PackDefinition): number {
  const unit = normalizeUnit(inputUnit);
  const found = inputUnits(pack).find((option) => option.value === unit);
  return found ? found.factor : 1;
}

/** Convierte una cantidad escrita en `inputUnit` a la unidad de stock. */
export function stockQuantity(
  quantity: number,
  inputUnit: unknown,
  pack: PackDefinition,
): number {
  const value = Number(quantity);
  if (!Number.isFinite(value)) return 0;
  return roundQty(value * unitFactor(inputUnit, pack));
}

/** Convierte una cantidad de la unidad de stock a `inputUnit` (inverso). */
export function inputQuantity(
  stock: number,
  inputUnit: unknown,
  pack: PackDefinition,
): number {
  const value = Number(stock);
  if (!Number.isFinite(value)) return 0;
  const factor = unitFactor(inputUnit, pack);
  return roundQty(factor ? value / factor : 0);
}

/** Redondea a 3 decimales (misma precision que el motor de inventario). */
function roundQty(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

/**
 * Desglose de las existencias tal como las lee el negocio:
 *   - cajas completas y unidades sueltas (`{ boxes, loose }`).
 *   - kilos/litros enteros y su resto en gramos/mililitros.
 * `remainderUnit` viene vacio cuando la unidad no tiene sub-unidad decimal.
 */
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
export function packParts(stock: number, pack: PackDefinition): PackParts {
  const value = Math.max(roundQty(Number(stock) || 0), 0);
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
    const fraction = Math.round((value - whole) * decimal.perBase);
    return {
      boxes: 0,
      loose: whole,
      looseUnit: normalizeUnit(pack.unit),
      remainder: fraction,
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
export function packText(stock: number, pack: PackDefinition): string {
  const parts = packParts(stock, pack);

  if (isBoxPack(pack)) {
    const boxName = normalizeUnit(pack.unit) === 'PAQUETE' ? 'paquete' : 'caja';
    const chunks: string[] = [];
    if (parts.boxes > 0) {
      chunks.push(`${parts.boxes} ${boxName}${parts.boxes === 1 ? '' : 's'}`);
    }
    if (parts.loose > 0 || chunks.length === 0) {
      chunks.push(
        `${text(parts.loose)} unidad${parts.loose === 1 ? '' : 'es'}`,
      );
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