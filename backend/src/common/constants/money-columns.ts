/**
 * Inventario de las columnas que guardan DINERO.
 *
 * En la base de datos el dinero vive SIEMPRE en centavos (entero), nunca como
 * decimal: asi no existe deriva de punto flotante al sumar, agrupar ni comparar.
 * La conversion decimal <-> centavos ocurre en la frontera de Prisma
 * (`src/common/utils/money-codec.ts`), de modo que los servicios, los DTOs, la
 * API y el frontend siguen trabajando con decimales (`194.34`).
 *
 * Esta lista es la UNICA fuente de verdad: el codec la usa para convertir
 * escrituras y lecturas, y `money-columns.spec.ts` falla si el esquema agrega
 * una columna de dinero (o una tasa) que no este declarada aqui.
 *
 * El nombre del modelo es el de Prisma en PascalCase (tal como lo entrega
 * `Prisma.dmmf` y los hooks de las extensiones).
 */
export const MONEY_COLUMNS = {
  Product: ['price', 'cost'],
  StockMovement: ['unitCost'],
  Order: ['subtotal', 'discount', 'tax', 'tip', 'total', 'paidAmount'],
  OrderItem: ['unitPrice', 'total'],
  OrderPayment: ['amount', 'baseAmount'],
  Expense: ['amount', 'baseAmount'],
  AccountPayable: ['amount', 'baseAmount', 'paidAmount'],
  PayablePayment: ['amount', 'baseAmount'],
  AccountReceivable: ['amount', 'baseAmount', 'paidAmount'],
  ReceivablePayment: ['amount', 'baseAmount'],
  CashSession: ['openingAmount', 'countedAmount', 'expectedAmount', 'difference'],
  CashMovement: ['amount', 'baseAmount'],
} as const;

/**
 * Columnas `Float` que NO son dinero: son tasas (bolivares por 1 unidad de una
 * moneda). Una tasa no se redondea a centavos porque no es un monto.
 */
export const RATE_COLUMNS = {
  OrderPayment: ['exchangeRate'],
  Expense: ['exchangeRate'],
  AccountPayable: ['exchangeRate'],
  PayablePayment: ['exchangeRate'],
  AccountReceivable: ['exchangeRate'],
  ReceivablePayment: ['exchangeRate'],
  CashMovement: ['exchangeRate'],
  CashSession: ['openingRate', 'countedRate'],
} as const;

/** Columnas `Int` que no son dinero (conteos y existencias). */
export const NON_MONEY_INT_COLUMNS = {
  Product: ['stock', 'minStock', 'unitsPerBox'],
  StockMovement: ['quantity', 'stockBefore', 'stockAfter'],
  OrderItem: ['quantity'],
} as const;

/**
 * Campos de dinero del desglose del fondo que se guarda como JSON de texto en
 * `CashSession.openingLines` (los otros campos son la moneda y la tasa). Se
 * guardan en centavos, como el resto del dinero, y se leen a decimales con
 * `moneyFieldsFromCents`.
 */
export const OPENING_LINE_MONEY_FIELDS = ['amount', 'baseAmount'] as const;

/** Modelo de Prisma (PascalCase) que tiene al menos una columna de dinero. */
export type MoneyModel = keyof typeof MONEY_COLUMNS;

/** Campos de dinero de un modelo (vacio si el modelo no guarda dinero). */
export function moneyFieldsOf(model: string): readonly string[] {
  return (MONEY_COLUMNS as Record<string, readonly string[]>)[model] ?? [];
}

/** `true` cuando el campo guarda dinero en centavos. */
export function isMoneyField(model: string, field: string): boolean {
  return moneyFieldsOf(model).includes(field);
}

/** Clave del modelo en el cliente de Prisma (`StockMovement` -> `stockMovement`). */
export function clientKeyOf(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}
