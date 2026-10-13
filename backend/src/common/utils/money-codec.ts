/**
 * Codec de dinero: decimales <-> centavos en la frontera con Prisma.
 *
 * El dinero se guarda en la base de datos como ENTERO de centavos y la API
 * trabaja con decimales (`194.34`). Este modulo es el unico punto donde se
 * cruza esa frontera, a traves de una extension de Prisma (`$extends`) que se
 * aplica en `PrismaService`, en el seed y en el auditor contable:
 *
 *   ENTRADA (decimal -> centavos)
 *     - `data` / `create` / `update` de los modelos con dinero, incluidas las
 *       escrituras anidadas (items y pagos de un pedido, movimientos de caja,
 *       pagos de una cuenta por cobrar/pagar, ...).
 *     - Filtros `where` y `having` sobre columnas de dinero.
 *
 *   SALIDA (centavos -> decimal)
 *     - Filas de cualquier lectura, incluidas las relaciones anidadas (Prisma
 *       resuelve el recorrido con la `result` extension).
 *     - Agregados `_sum` / `_avg` / `_min` / `_max` de `aggregate`, `groupBy`
 *       y `findMany`: a esos Prisma NO les aplica `result`, por eso el hook
 *       `query` los decodifica a mano.
 *
 * Los `args` NUNCA se mutan (se devuelven copias): el llamador puede reutilizar
 * el mismo objeto de filtros en varias consultas y convertirlo dos veces seria
 * un bug silencioso de x100.
 *
 * Las columnas con dinero estan declaradas en `common/constants/money-columns.ts`.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import {
  MONEY_COLUMNS,
  clientKeyOf,
  isMoneyField,
} from '../constants/money-columns';
import { fromCents, toCents } from './money.util';

/** Claves de un agregado de Prisma que devuelven montos. */
const AGGREGATE_KEYS = ['_sum', '_avg', '_min', '_max'] as const;

/** Operadores escalares de un filtro que aceptan un monto. */
const SCALAR_FILTERS = ['equals', 'lt', 'lte', 'gt', 'gte'] as const;

/** Operadores de filtro que aceptan una lista de montos. */
const LIST_FILTERS = ['in', 'notIn'] as const;

/** Actualizaciones atomicas que aceptan un monto (`multiply`/`divide` no). */
const ATOMIC_UPDATE_OPS = ['set', 'increment', 'decrement'] as const;

/** Filtros por relacion (uno o varios registros del modelo relacionado). */
const RELATION_FILTERS = ['is', 'isNot', 'some', 'every', 'none'] as const;

/** Escrituras anidadas que pueden contener montos. */
const NESTED_WRITE_OPS = [
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'connectOrCreate',
] as const;
type NestedWriteOp = (typeof NESTED_WRITE_OPS)[number];

type Plain = Record<string, unknown>;

/** Campo del modelo segun el DMMF generado por Prisma. */
interface CatalogField {
  kind: string;
  type: string;
  isList: boolean;
}
interface CatalogModel {
  fields: Map<string, CatalogField>;
}

interface DmmfField {
  name: string;
  kind: string;
  type: string;
  isList: boolean;
}

const isPlainObject = (value: unknown): value is Plain =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Modelos del esquema (nombre -> campos), tomados del DMMF generado. */
const CATALOG: Map<string, CatalogModel> = buildCatalog();

function buildCatalog(): Map<string, CatalogModel> {
  const dmmf = (
    Prisma as unknown as {
      dmmf?: { datamodel?: { models?: { name: string; fields: DmmfField[] }[] } };
    }
  ).dmmf?.datamodel?.models;

  if (!dmmf?.length) {
    throw new Error(
      'El DMMF de Prisma no esta disponible: ejecuta "npm run prisma:generate". ' +
        'El codec de dinero lo necesita para convertir escrituras anidadas.',
    );
  }

  const catalog = new Map<string, CatalogModel>();
  for (const model of dmmf) {
    catalog.set(model.name, {
      fields: new Map(
        model.fields.map((field) => [
          field.name,
          { kind: field.kind, type: field.type, isList: field.isList },
        ]),
      ),
    });
  }
  return catalog;
}

/**
 * Comprueba el inventario contra el esquema generado. Si alguien renombra una
 * columna de dinero (o declara una que no existe), la aplicacion falla al
 * arrancar en vez de guardar montos sin convertir.
 */
function validateManifest(): void {
  for (const [model, fields] of Object.entries(MONEY_COLUMNS)) {
    const entry = CATALOG.get(model);
    if (!entry) {
      throw new Error(`MONEY_COLUMNS: el modelo "${model}" no existe en el esquema.`);
    }
    for (const field of fields) {
      if (!entry.fields.has(field)) {
        throw new Error(`MONEY_COLUMNS: "${model}.${field}" no existe en el esquema.`);
      }
    }
  }
}
validateManifest();

/** Convierte un valor de filtro (escalar u objeto de operadores) a centavos. */
function convertFilterValue(value: unknown): unknown {
  if (typeof value === 'number' || typeof value === 'string') {
    return toCents(value);
  }
  if (!isPlainObject(value)) return value;

  const out: Plain = { ...value };
  for (const op of SCALAR_FILTERS) {
    if (out[op] != null) out[op] = toCents(out[op]);
  }
  for (const op of LIST_FILTERS) {
    const list = out[op];
    if (Array.isArray(list)) {
      out[op] = list.map((item) => (item == null ? item : toCents(item)));
    }
  }
  if (out.not != null) out.not = convertFilterValue(out.not);
  return out;
}

/** Convierte a centavos los montos de un `where` (recursivo, sin mutar). */
export function convertWhere(model: string, where: unknown): unknown {
  if (!isPlainObject(where)) return where;
  const meta = CATALOG.get(model);
  if (!meta) return where;

  const out: Plain = { ...where };
  for (const key of Object.keys(where)) {
    const value = where[key];
    if (value == null) continue;

    if (key === 'AND' || key === 'OR' || key === 'NOT') {
      out[key] = Array.isArray(value)
        ? value.map((item) => convertWhere(model, item))
        : convertWhere(model, value);
      continue;
    }

    const field = meta.fields.get(key);
    if (!field) continue;

    if (field.kind !== 'object') {
      if (isMoneyField(model, key)) out[key] = convertFilterValue(value);
      continue;
    }

    if (isPlainObject(value)) {
      const nested: Plain = { ...value };
      for (const op of RELATION_FILTERS) {
        if (nested[op] != null) nested[op] = convertWhere(field.type, nested[op]);
      }
      out[key] = nested;
    }
  }
  return out;
}

/**
 * Convierte a centavos los montos de un `having` de `groupBy`, que admite las
 * dos formas de Prisma: `{ total: { _sum: { gt: 5 } } }` y
 * `{ _sum: { total: { gt: 5 } } }`.
 */
export function convertHaving(model: string, having: unknown): unknown {
  if (!isPlainObject(having)) return having;

  const out: Plain = { ...having };
  for (const key of Object.keys(having)) {
    const value = having[key];
    if (!isPlainObject(value)) continue;

    const block: Plain = { ...value };
    if ((AGGREGATE_KEYS as readonly string[]).includes(key)) {
      for (const field of Object.keys(block)) {
        if (field !== '_count' && isMoneyField(model, field)) {
          block[field] = convertFilterValue(block[field]);
        }
      }
      out[key] = block;
      continue;
    }

    if (isMoneyField(model, key)) {
      for (const agg of Object.keys(block)) {
        if (agg !== '_count') block[agg] = convertFilterValue(block[agg]);
      }
      out[key] = block;
    }
  }
  return out;
}

/** Aplica `convertData` a una escritura anidada (`create`, `upsert`, ...). */
function convertNestedWrite(
  childModel: string,
  op: NestedWriteOp,
  value: unknown,
): unknown {
  const one = (item: unknown): unknown => {
    if (!isPlainObject(item)) return item;
    switch (op) {
      case 'create':
        return convertData(childModel, item);
      case 'createMany':
      case 'update':
      case 'updateMany':
        return item.data === undefined
          ? item
          : { ...item, data: convertData(childModel, item.data) };
      case 'upsert':
        return {
          ...item,
          ...(isPlainObject(item.create)
            ? { create: convertData(childModel, item.create) }
            : {}),
          ...(isPlainObject(item.update)
            ? { update: convertData(childModel, item.update) }
            : {}),
        };
      case 'connectOrCreate':
        return isPlainObject(item.create)
          ? { ...item, create: convertData(childModel, item.create) }
          : item;
      default:
        return item;
    }
  };

  return Array.isArray(value) ? value.map(one) : one(value);
}

/**
 * Convierte a centavos los montos de un `data` de escritura, incluidos los
 * anidados (`items: { create: [...] }`, `payments: { create: [...] }`).
 * No muta la entrada: cada nivel recorrido se devuelve como copia.
 */
export function convertData(model: string, data: unknown): unknown {
  if (Array.isArray(data)) return data.map((item) => convertData(model, item));
  if (!isPlainObject(data)) return data;

  const meta = CATALOG.get(model);
  if (!meta) return data;

  const out: Plain = { ...data };
  for (const key of Object.keys(data)) {
    const value = data[key];
    if (value == null) continue;

    const field = meta.fields.get(key);
    if (!field) continue;

    if (field.kind === 'object') {
      if (isPlainObject(value)) {
        const nested: Plain = { ...value };
        for (const op of NESTED_WRITE_OPS) {
          if (nested[op] != null) {
            nested[op] = convertNestedWrite(field.type, op, nested[op]);
          }
        }
        out[key] = nested;
      }
      continue;
    }

    if (!isMoneyField(model, key)) continue;

    if (typeof value === 'number' || typeof value === 'string') {
      out[key] = toCents(value);
    } else if (isPlainObject(value)) {
      const atomic: Plain = { ...value };
      for (const op of ATOMIC_UPDATE_OPS) {
        if (atomic[op] != null) atomic[op] = toCents(atomic[op]);
      }
      out[key] = atomic;
    }
  }
  return out;
}

/** Convierte a centavos los montos de los `args` de una operacion de Prisma. */
export function convertArgs(model: string, args: unknown): unknown {
  if (!isPlainObject(args)) return args;

  const out: Plain = { ...args };
  if (out.where !== undefined) out.where = convertWhere(model, out.where);
  if (out.having !== undefined) out.having = convertHaving(model, out.having);
  if (out.data !== undefined) out.data = convertData(model, out.data);
  if (out.create !== undefined) out.create = convertData(model, out.create);
  if (out.update !== undefined) out.update = convertData(model, out.update);
  return out;
}

/**
 * Decodifica los agregados de una respuesta: `aggregate` y `groupBy` devuelven
 * `_sum`/`_avg`/`_min`/`_max` en centavos y Prisma no les aplica `result`.
 * Cualquier otra respuesta (filas ya decodificadas) pasa intacta.
 */
export function decodeAggregates(model: string, result: unknown): unknown {
  const decodeOne = (item: unknown): unknown => {
    if (!isPlainObject(item)) return item;

    let out: Plain | null = null;
    for (const key of AGGREGATE_KEYS) {
      const block = item[key];
      if (!isPlainObject(block)) continue;

      const decoded: Plain = { ...block };
      let changed = false;
      for (const [field, value] of Object.entries(block)) {
        if (typeof value === 'number' && isMoneyField(model, field)) {
          decoded[field] = fromCents(value);
          changed = true;
        }
      }
      if (changed) {
        out = out ?? { ...item };
        out[key] = decoded;
      }
    }
    return out ?? item;
  };

  return Array.isArray(result) ? result.map(decodeOne) : decodeOne(result);
}

/**
 * Extension de Prisma con el codec de dinero.
 *
 *   - `query`: convierte los montos de entrada y decodifica los agregados.
 *   - `result`: decodifica los campos de dinero de las filas leidas (Prisma se
 *     encarga de aplicar el bloque correcto tambien dentro de `include`/`select`
 *     anidados).
 */
export const moneyCodec = Prisma.defineExtension({
  name: 'nexo:money-cents',
  query: {
    $allModels: {
      async $allOperations({ model, args, query }) {
        const result = await query(convertArgs(model, args) as never);
        return decodeAggregates(model, result);
      },
    },
  },
  result: {
    product: {
      price: {
        needs: { price: true },
        compute: (row) => fromCents(row.price),
      },
      cost: {
        needs: { cost: true },
        compute: (row) => fromCents(row.cost),
      },
    },
    stockMovement: {
      unitCost: {
        needs: { unitCost: true },
        compute: (row) => (row.unitCost == null ? null : fromCents(row.unitCost)),
      },
    },
    order: {
      subtotal: {
        needs: { subtotal: true },
        compute: (row) => fromCents(row.subtotal),
      },
      discount: {
        needs: { discount: true },
        compute: (row) => fromCents(row.discount),
      },
      tax: {
        needs: { tax: true },
        compute: (row) => fromCents(row.tax),
      },
      total: {
        needs: { total: true },
        compute: (row) => fromCents(row.total),
      },
      paidAmount: {
        needs: { paidAmount: true },
        compute: (row) => fromCents(row.paidAmount),
      },
    },
    orderItem: {
      unitPrice: {
        needs: { unitPrice: true },
        compute: (row) => fromCents(row.unitPrice),
      },
      total: {
        needs: { total: true },
        compute: (row) => fromCents(row.total),
      },
    },
    orderPayment: {
      amount: {
        needs: { amount: true },
        compute: (row) => fromCents(row.amount),
      },
      baseAmount: {
        needs: { baseAmount: true },
        compute: (row) => fromCents(row.baseAmount),
      },
    },
    expense: {
      amount: {
        needs: { amount: true },
        compute: (row) => fromCents(row.amount),
      },
      baseAmount: {
        needs: { baseAmount: true },
        compute: (row) => fromCents(row.baseAmount),
      },
    },
    accountPayable: {
      amount: {
        needs: { amount: true },
        compute: (row) => fromCents(row.amount),
      },
      baseAmount: {
        needs: { baseAmount: true },
        compute: (row) => fromCents(row.baseAmount),
      },
      paidAmount: {
        needs: { paidAmount: true },
        compute: (row) => fromCents(row.paidAmount),
      },
    },
    payablePayment: {
      amount: {
        needs: { amount: true },
        compute: (row) => fromCents(row.amount),
      },
      baseAmount: {
        needs: { baseAmount: true },
        compute: (row) => fromCents(row.baseAmount),
      },
    },
    accountReceivable: {
      amount: {
        needs: { amount: true },
        compute: (row) => fromCents(row.amount),
      },
      baseAmount: {
        needs: { baseAmount: true },
        compute: (row) => fromCents(row.baseAmount),
      },
      paidAmount: {
        needs: { paidAmount: true },
        compute: (row) => fromCents(row.paidAmount),
      },
    },
    receivablePayment: {
      amount: {
        needs: { amount: true },
        compute: (row) => fromCents(row.amount),
      },
      baseAmount: {
        needs: { baseAmount: true },
        compute: (row) => fromCents(row.baseAmount),
      },
    },
    cashSession: {
      openingAmount: {
        needs: { openingAmount: true },
        compute: (row) => fromCents(row.openingAmount),
      },
      countedAmount: {
        needs: { countedAmount: true },
        compute: (row) =>
          row.countedAmount == null ? null : fromCents(row.countedAmount),
      },
      expectedAmount: {
        needs: { expectedAmount: true },
        compute: (row) =>
          row.expectedAmount == null ? null : fromCents(row.expectedAmount),
      },
      difference: {
        needs: { difference: true },
        compute: (row) => (row.difference == null ? null : fromCents(row.difference)),
      },
    },
    cashMovement: {
      amount: {
        needs: { amount: true },
        compute: (row) => fromCents(row.amount),
      },
      baseAmount: {
        needs: { baseAmount: true },
        compute: (row) => fromCents(row.baseAmount),
      },
    },
  },
});

/** Cliente de Prisma con el codec de dinero aplicado. */
export type MoneyDbClient = ReturnType<typeof applyMoneyCodec>;

/**
 * Cliente de Prisma dentro de una transaccion (el `tx` que entrega
 * `$transaction`), con el codec de dinero aplicado.
 */
export type PrismaTx = Omit<
  MoneyDbClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Aplica el codec de dinero a un cliente de Prisma ya construido.
 * Se tipa con el `PrismaClient` generado (no con `Prisma.PrismaClient`, que es
 * el generico) para no perder los tipos de los payloads de cada modelo.
 */
export function applyMoneyCodec(client: PrismaClient) {
  return client.$extends(moneyCodec);
}

/** Modelos con dinero declarados en el inventario (para pruebas y auditoria). */
export const MONEY_MODELS = Object.keys(MONEY_COLUMNS).map((model) => ({
  model,
  clientKey: clientKeyOf(model),
  fields: MONEY_COLUMNS[model as keyof typeof MONEY_COLUMNS],
}));
