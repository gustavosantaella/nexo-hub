import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  MONEY_COLUMNS,
  NON_MONEY_INT_COLUMNS,
  RATE_COLUMNS,
  clientKeyOf,
  isMoneyField,
} from './money-columns';

/**
 * Lee `prisma/schema.prisma` y devuelve, por modelo, las columnas de un tipo
 * escalar (`Int` o `Float`). Se hace con texto y no con el DMMF para que la
 * prueba sea independiente del cliente generado.
 */
function columnsOfType(scalar: 'Int' | 'Float'): Map<string, string[]> {
  const schema = readFileSync(
    resolve(__dirname, '../../../prisma/schema.prisma'),
    'utf8',
  );

  const models = new Map<string, string[]>();
  let current: string | null = null;

  for (const line of schema.split(/\r?\n/)) {
    const model = /^model\s+(\w+)\s*\{/.exec(line);
    if (model) {
      current = model[1];
      models.set(current, []);
      continue;
    }
    if (/^\}/.test(line)) {
      current = null;
      continue;
    }
    if (!current) continue;

    const field = new RegExp(`^\\s+(\\w+)\\s+${scalar}\\??(\\s|$)`).exec(line);
    if (field) models.get(current)?.push(field[1]);
  }
  return models;
}

/** `true` cuando la columna entera es un conteo/existencia (no dinero). */
function isCountedColumn(model: string, field: string): boolean {
  const counted = (NON_MONEY_INT_COLUMNS as Record<string, readonly string[]>)[
    model
  ];
  return counted?.includes(field) ?? false;
}

describe('money-columns (inventario vs esquema de Prisma)', () => {
  const ints = columnsOfType('Int');
  const floats = columnsOfType('Float');

  const declaredMoney = Object.entries(MONEY_COLUMNS).flatMap(([model, fields]) =>
    fields.map((field) => `${model}.${field}`),
  );
  const actualMoney = [...ints.entries()].flatMap(([model, fields]) =>
    fields.filter((field) => !isCountedColumn(model, field)).map((f) => `${model}.${f}`),
  );
  const declaredRates = Object.entries(RATE_COLUMNS).flatMap(([model, fields]) =>
    fields.map((field) => `${model}.${field}`),
  );
  const actualRates = [...floats.entries()].flatMap(([model, fields]) =>
    fields.map((field) => `${model}.${field}`),
  );

  it('el esquema se lee correctamente', () => {
    expect(ints.size).toBeGreaterThanOrEqual(12);
    expect(declaredMoney.length).toBe(31);
  });

  it('toda columna entera es dinero declarado o un conteo declarado', () => {
    const unknown = [...ints.entries()].flatMap(([model, fields]) =>
      fields
        .filter((field) => !isMoneyField(model, field) && !isCountedColumn(model, field))
        .map((field) => `${model}.${field}`),
    );

    expect(unknown).toEqual([]);
  });

  it('el inventario de dinero coincide exactamente con las columnas enteras de dinero', () => {
    expect([...declaredMoney].sort()).toEqual([...actualMoney].sort());
  });

  it('toda columna Float es una tasa declarada (ninguna guarda dinero)', () => {
    expect([...actualRates].sort()).toEqual([...declaredRates].sort());
  });

  it('las tasas y el dinero no comparten columnas', () => {
    const shared = declaredMoney.filter((column) => declaredRates.includes(column));
    expect(shared).toEqual([]);
  });

  it('la clave del cliente es el nombre del modelo en camelCase', () => {
    expect(clientKeyOf('Order')).toBe('order');
    expect(clientKeyOf('StockMovement')).toBe('stockMovement');
    expect(clientKeyOf('CashSession')).toBe('cashSession');
  });
});
