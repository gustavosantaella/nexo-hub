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
 * una columna de dinero (o una tasa, o una cantidad) que no este declarada aqui.
 *
 * Las CANTIDADES (`Float` con 3 decimales: existencias y movimientos de stock)
 * se declaran en `QUANTITY_COLUMNS` y no pasan por ningun codec: el motor de
 * inventario las redondea al escribir. Los PORCENTAJES (`Float` que no son
 * dinero: la propina sugerida) se declaran en `PERCENT_COLUMNS`.
 *
 * El nombre del modelo es el de Prisma en PascalCase (tal como lo entrega
 * `Prisma.dmmf` y los hooks de las extensiones).
 */
export const MONEY_COLUMNS = {
  Product: [
    'price',
    'cost',
    'priceEntered',
    'costEntered',
    'unitCost',
    'unitCostEntered',
    'unitPrice',
    'unitPriceEntered',
  ],
  StockMovement: ['unitCost', 'unitCostEntered'],
  Menu: ['price', 'cost', 'priceEntered'],
  Order: [
    'subtotal',
    'discount',
    'tax',
    'tip',
    'deliveryFee',
    'deliveryFeeEntered',
    'total',
    'paidAmount',
  ],
  OrderItem: ['unitPrice', 'unitPriceEntered', 'total'],
  OrderPayment: ['amount', 'baseAmount', 'changeBaseAmount'],
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
  Product: ['priceRate', 'costRate', 'unitCostRate', 'unitPriceRate'],
  StockMovement: ['unitCostRate'],
  Menu: ['priceRate'],
  Order: ['deliveryFeeRate', 'priceRate'],
  OrderPayment: ['exchangeRate'],
  Expense: ['exchangeRate'],
  AccountPayable: ['exchangeRate'],
  PayablePayment: ['exchangeRate'],
  AccountReceivable: ['exchangeRate'],
  ReceivablePayment: ['exchangeRate'],
  CashMovement: ['exchangeRate', 'baseRate'],
  CashSession: ['openingRate', 'countedRate'],
} as const;

/**
 * Columnas `Float` que NO son dinero, tasas ni cantidades: son PORCENTAJES
 * (ej. la propina sugerida del punto de venta). No se suman ni representan
 * dinero, asi que se guardan como decimal y no pasan por ningun codec.
 */
export const PERCENT_COLUMNS = {
  CompanyPreference: ['tipPercent'],
} as const;

/** Columnas `Int` que no son dinero (conteos, existencias y orden). */
export const NON_MONEY_INT_COLUMNS = {
  Product: ['unitsPerBox'],
  OrderItem: ['quantity'],
  MenuCategory: ['sortOrder'],
  Menu: ['preparationMinutes'],
  MenuIngredient: ['sortOrder'],
} as const;

/**
 * Columnas `Float` que NO son dinero ni tasas: son EXISTENCIAS/CANTIDADES en la
 * unidad del producto. Se guardan con 3 decimales porque las recetas consumen
 * fracciones (100 g de un producto controlado en kilos = 0.1). El redondeo lo
 * aplica el motor de inventario, unico punto autorizado para variar el stock.
 */
export const QUANTITY_COLUMNS = {
  Product: ['stock', 'minStock'],
  StockMovement: ['quantity', 'stockBefore', 'stockAfter', 'inputQuantity'],
  MenuIngredient: ['quantity'],
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
