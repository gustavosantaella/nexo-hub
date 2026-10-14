/**
 * Seed de desarrollo para Nexo Hub.
 *
 * Deja la base de datos lista para probar TODO el sistema:
 *
 *   - Dos empresas (multi-empresa): la principal "Nexo Hub Demo, C.A." recibe
 *     todo el historial; "Bodegon La Esquina, C.A." queda configurada y con
 *     catalogo (sin operaciones) para probar el cambio de empresa activa. El rol
 *     de cada usuario se guarda en su `Membership`, no en el usuario.
 *   - Datos maestros (usuarios, categorias, proveedores, clientes, productos,
 *     monedas y tasa personalizada): se actualizan con `upsert` (nunca se
 *     duplican).
 *   - Datos de operacion de los ultimos `HISTORY_DAYS` dias (por defecto 30):
 *     sesiones de caja con fondo de una o varias monedas, movimientos, cierres
 *     con arqueo, pedidos en todos los estados, cobros en USD/VES/EUR/COP,
 *     gastos, cuentas por cobrar/pagar e inventario (cargas, reposiciones,
 *     consumo por venta y ajustes).
 *
 * Los datos transaccionales de demo se BORRAN y se regeneran en cada ejecucion
 * para que el resultado sea determinista y reproducible (el generador usa un
 * PRNG con semilla fija: `RANDOM_SEED`). Cambia esa semilla para obtener otro
 * historial igual de valido.
 *
 * Uso:  npm run prisma:seed        (o  npm run db:reset  /  npm run setup)
 */
import { PrismaClient, type Product } from '@prisma/client';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { hashPassword } from '../src/common/utils/password.util';
import { buildCode } from '../src/common/utils/code.util';
import { resolveAccountStatus } from '../src/common/utils/account.util';
import { convertToBase } from '../src/common/utils/currency.util';
import { compareMoney, fitToBalance, money, moneyFieldsToCents, round2, toMoney } from '../src/common/utils/money.util';
import { boxUnitsOf } from '../src/common/utils/packaging.util';
import { OPENING_LINE_MONEY_FIELDS } from '../src/common/constants/money-columns';
import { applyMoneyCodec } from '../src/common/utils/money-codec';
import { computeOrderTotals } from '../src/modules/orders/orders.service';
import { CURRENCIES_KEY } from '../src/modules/currencies/currencies.service';
import { CUSTOM_RATE_KEY } from '../src/modules/rates/rates.service';
import {
  BASE_CURRENCY_CODE,
  LOCAL_CURRENCY_CODE,
  MIXED_CURRENCY_CODE,
  currencyInfo,
  normalizeCurrencyCode,
  type CurrencySetting,
} from '../src/common/constants/currencies';
import {
  AccountStatus,
  CashMovementCategory,
  CashMovementType,
  CashSessionStatus,
  ExpenseCategory,
  OrderStatus,
  OrderType,
  PaymentMethod,
  PaymentStatus,
  Role,
  StockMovementType,
  StockReferenceType,
} from '../src/common/constants/enums';

// Al ejecutarse con ts-node (fuera de Nest) las variables de entorno no se
// cargan solas: se leen del .env del backend.
dotenv.config({ path: resolve(__dirname, '..', '.env') });

// El cliente pasa por el codec de dinero: el seed trabaja en decimales igual que
// los servicios y la base guarda centavos.
const prisma = applyMoneyCodec(new PrismaClient());

// ===========================================================================
//  Parametros de la simulacion
// ===========================================================================

/** Semilla del PRNG: cambiarla produce otro historial (igual de coherente). */
const RANDOM_SEED = 20261013;
/** Dias de historia generados (incluye el dia de hoy). */
const HISTORY_DAYS = 30;
/** Bolivares por 1 USD al inicio del historial (serie ficticia). */
const RATE_START = 248.5;
/** Devaluacion diaria aproximada (bolivares por 1 USD). */
const RATE_STEP = 1.9;
/** Bolivares por 1 COP (moneda extra con tasa manual en `currencies.config`). */
const COP_RATE = 0.08;
/** IVA (%) aplicado a una parte de los pedidos (el resto sale sin IVA). */
const TAX_RATE_CHOICES = [0, 0, 0, 0, 10];
/** Pedidos por turno (rangos tipicos). */
const ORDERS_PER_SHIFT = { min: 3, max: 7 };
/** Notas que aparecen de vez en cuando en los pedidos. */
const ORDER_NOTES = [
  'Sin cebolla',
  'Sin picante',
  'Para llevar bien envuelto',
  'Cliente frecuente',
  'Cumpleanos: poner vela',
  'Cambio exacto por favor',
];

// ===========================================================================
//  Utilidades: aleatoriedad reproducible y fechas
// ===========================================================================

/** PRNG determinista (mulberry32): mismo resultado en cada ejecucion. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = createRandom(RANDOM_SEED);

/** Entero aleatorio en [min, max]. */
function randInt(min: number, max: number): number {
  return Math.floor(random() * (max - min + 1)) + min;
}

/** Decimal aleatorio en [min, max] con 2 decimales. */
function randAmount(min: number, max: number): number {
  return round2(min + random() * (max - min));
}

/** Elemento aleatorio de una lista no vacia. */
function pick<T>(items: readonly T[]): T {
  return items[Math.floor(random() * items.length)];
}

/** `true` con probabilidad `probability` (0..1). */
function chance(probability: number): boolean {
  return random() < probability;
}

/** Medianoche local (00:00) del dia indicado. */
function startOfDay(date: Date = new Date()): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/** Copia con `days` dias sumados. */
function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

/** Fecha con la hora/minuto indicados. */
function atTime(day: Date, hour: number, minute = 0): Date {
  const copy = new Date(day);
  copy.setHours(hour, minute, randInt(0, 59), 0);
  return copy;
}

/** Primer dia del historial (el mas antiguo). */
const FIRST_DAY = addDays(startOfDay(new Date()), -(HISTORY_DAYS - 1));

/** Fecha (00:00) del dia `index` del historial (0 = mas antiguo). */
function dayOf(index: number): Date {
  return addDays(FIRST_DAY, index);
}

/** `true` cuando el indice corresponde al dia de hoy (ultima jornada). */
function isToday(index: number): boolean {
  return index === HISTORY_DAYS - 1;
}

// ===========================================================================
//  Tasas de cambio (serie ficticia) y conversion a la moneda base
// ===========================================================================

/** Bolivares por 1 unidad de cada moneda durante un dia. */
interface DayRates {
  /** Bolivares por 1 USD (tasa que el local tiene activa ese dia). */
  bsPerUsd: number;
  /** Bolivares por 1 EUR (tasa del BCV). */
  bsPerEur: number;
}

/**
 * Serie de tasas: el bolivar se devalua dia a dia, como en la realidad. La
 * ultima tasa de la serie es la que se guarda como tasa personalizada del local
 * (`rates.custom_usd`), de modo que los datos de HOY coinciden con la tasa que
 * el sistema tiene configurada.
 */
const RATES: DayRates[] = Array.from({ length: HISTORY_DAYS }, (_, index) => {
  const bsPerUsd = round2(RATE_START + index * RATE_STEP + (random() * 1.4 - 0.7));
  const bsPerEur = round2(bsPerUsd * (1.07 + random() * 0.04));
  return { bsPerUsd, bsPerEur };
});

/** Bolivares por 1 unidad de `currency` con las tasas de ese dia. */
function bsPerUnit(currency: string, rates: DayRates): number {
  switch (normalizeCurrencyCode(currency)) {
    case BASE_CURRENCY_CODE:
      return rates.bsPerUsd;
    case LOCAL_CURRENCY_CODE:
      return 1;
    case 'EUR':
      return rates.bsPerEur;
    case 'COP':
      return COP_RATE;
    default:
      return 0;
  }
}

/** Resultado de convertir un monto a la moneda base (mismo shape que el API). */
interface Conversion {
  currency: string;
  amount: number;
  exchangeRate: number | null;
  baseAmount: number;
}

/**
 * Convierte `amount` de `currency` a USD usando las tasas del dia. Reutiliza la
 * utilidad del backend para que las cifras del seed sigan exactamente la misma
 * formula que la aplicacion.
 */
function toBase(amount: number, currency: string, rates: DayRates): Conversion {
  const code = normalizeCurrencyCode(currency) || BASE_CURRENCY_CODE;
  const conversion = convertToBase(amount, code, {
    bsPerUsd: rates.bsPerUsd,
    bsPerCurrency: bsPerUnit(code, rates) || null,
  });
  if (!conversion) {
    throw new Error(`No hay tasa para convertir ${amount} ${code}`);
  }
  return {
    currency: conversion.currency,
    amount: toMoney(amount),
    exchangeRate: conversion.exchangeRate,
    baseAmount: conversion.baseAmount,
  };
}

/** Equivalente en `currency` de un monto en USD (para "contar" en otra moneda). */
function fromBase(baseAmount: number, currency: string, rates: DayRates): number {
  const code = normalizeCurrencyCode(currency) || BASE_CURRENCY_CODE;
  if (code === BASE_CURRENCY_CODE) return toMoney(baseAmount);
  if (code === LOCAL_CURRENCY_CODE) return money.mul(baseAmount, rates.bsPerUsd);
  const rate = bsPerUnit(code, rates);
  if (!rate) throw new Error(`No hay tasa de ${code}`);
  return money.div(money.mul(baseAmount, rates.bsPerUsd), rate);
}

// ===========================================================================
//  Datos maestros
// ===========================================================================

/** Empresa del seed. Cada una es un espacio de datos independiente. */
interface SeedCompany {
  name: string;
  rif: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
}

/**
 * Empresas del seed.
 *
 * La PRIMERA recibe todo el historial de demostracion (caja, pedidos, gastos,
 * cuentas e inventario). La SEGUNDA queda configurada y con catalogo pero sin
 * historial: existe para poder probar el cambio de empresa activa desde el panel.
 */
const COMPANIES: SeedCompany[] = [
  {
    name: 'Nexo Hub Demo, C.A.',
    rif: 'J-40123456-7',
    phone: '2125551122',
    email: 'contacto@nexohub.com',
    address: 'Av. Principal 123, Caracas',
    notes: 'Empresa principal del seed: recibe todo el historial de demostracion.',
  },
  {
    name: 'Bodegon La Esquina, C.A.',
    rif: 'J-40987654-3',
    phone: '2125553344',
    email: 'contacto@bodegonlaesquina.com',
    address: 'Calle 8 con Av. 4, Valencia',
    notes: 'Segunda empresa: sirve para probar el cambio de empresa activa.',
  },
];

/**
 * Empresa activa del seed.
 *
 * Todos los datos de dominio (catalogo, caja, pedidos, cuentas, ajustes) son por
 * empresa, asi que cada `create` incluye este id. Se cambia con `withCompany`.
 */
let COMPANY_ID = '';

interface SeedUser {
  email: string;
  name: string;
  password: string;
  role: string;
  phone?: string;
}

const USERS: SeedUser[] = [
  {
    email: 'admin@nexohub.com',
    name: 'Administrador',
    password: 'Admin123!',
    role: Role.ADMIN,
    phone: '4121112233',
  },
  {
    email: 'manager@nexohub.com',
    name: 'Encargado de tienda',
    password: 'Manager123!',
    role: Role.MANAGER,
    phone: '4142223344',
  },
  {
    email: 'caja@nexohub.com',
    name: 'Cajero principal',
    password: 'Caja123!',
    role: Role.CASHIER,
    phone: '4243334455',
  },
  {
    email: 'cashier@nexohub.com',
    name: 'Cajero turno tarde',
    password: 'Cashier123!',
    role: Role.CASHIER,
    phone: '4264445566',
  },
];

interface SeedCategory {
  name: string;
  description: string;
  /** Nombre de la principal: la convierte en SUBCATEGORIA (un solo nivel). */
  parent?: string;
}

/**
 * Catalogo de categorias. Las subcategorias son opcionales: "Refrescos" y
 * "Cervezas" cuelgan de "Bebidas" para mostrar la jerarquia, y el resto son
 * categorias principales normales.
 */
const CATEGORIES: SeedCategory[] = [
  { name: 'Bebidas', description: 'Gaseosas, jugos, cervezas y agua' },
  {
    name: 'Refrescos',
    description: 'Gaseosas y jugos',
    parent: 'Bebidas',
  },
  {
    name: 'Cervezas',
    description: 'Cervezas nacionales e importadas',
    parent: 'Bebidas',
  },
  { name: 'Comidas', description: 'Platos preparados y menus del dia' },
  { name: 'Postres', description: 'Dulces, tortas y helados' },
  { name: 'Panaderia', description: 'Pan frances, panes rellenos y bolleria' },
  { name: 'Insumos', description: 'Materia prima e insumos de cocina' },
  { name: 'Limpieza', description: 'Productos de limpieza e higiene' },
  { name: 'Servicios', description: 'Servicios que cobra el local (delivery, etc.)' },
];

interface SeedSupplier {
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  taxId?: string;
  notes?: string;
}

const SUPPLIERS: SeedSupplier[] = [
  {
    name: 'Distribuidora Andina',
    contactName: 'Ventas mayoreo',
    phone: '999111222',
    email: 'ventas@distribuidora-andina.com',
    address: 'Av. Los Andes 120',
    taxId: 'J-30123456-7',
  },
  {
    name: 'Lacteos del Sur',
    contactName: 'Atencion a clientes',
    phone: '999333444',
    email: 'pedidos@lacteosdelsur.com',
    address: 'Zona Industrial, galpon 4',
    taxId: 'J-30987654-1',
  },
  {
    name: 'Bebidas del Caribe',
    contactName: 'Ruta de reparto',
    phone: '999555666',
    email: 'rutas@bebidasdelcaribe.com',
    address: 'Calle 5 con Av. Principal',
    taxId: 'J-31555111-9',
  },
  {
    name: 'Panaderia El Trigal',
    contactName: 'Don Manuel',
    phone: '999777888',
    email: 'eltrigal@gmail.com',
    address: 'Mercado municipal, local 12',
  },
  {
    name: 'Servicios Electricos Caracas',
    contactName: 'Departamento de cobranza',
    phone: '0800-5566778',
    email: 'cobranzas@selec.co',
    notes: 'Factura mensual; se paga antes del dia 15.',
  },
];

interface SeedCustomer {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  docNumber?: string;
  notes?: string;
}

const CUSTOMERS: SeedCustomer[] = [
  { name: 'Consumidor final', phone: '999000111' },
  { name: 'Maria Perez', phone: '4121234567', docNumber: 'V-12345678' },
  { name: 'Carlos Rondon', phone: '4148765432', email: 'carlos.rondon@mail.com' },
  {
    name: 'Panaderia La Espiga',
    phone: '4245556677',
    email: 'compras@laespiga.com',
    docNumber: 'J-40111222-3',
  },
  {
    name: 'Eventos Delicias C.A.',
    phone: '2125559988',
    email: 'administracion@delicias.com',
    address: 'Torre Delta, piso 6',
    docNumber: 'J-40222333-4',
  },
  {
    name: 'Colegio San Jose',
    phone: '2125557766',
    email: 'meriendas@colegiosanjose.edu',
    notes: 'Facturar a nombre de la asociacion de padres.',
  },
  { name: 'Luisana Marquez', phone: '4163344556', notes: 'Pide delivery los viernes.' },
  { name: 'Pedro Silva', phone: '4267766554', docNumber: 'V-19876543' },
];

interface SeedProduct {
  sku: string;
  name: string;
  description?: string;
  price: number;
  cost: number;
  /** Stock con el que arranca el historial (carga inicial). */
  stock: number;
  minStock: number;
  unit: string;
  /**
   * Unidades individuales de la presentacion (caja/paquete). El `price` es el de
   * la presentacion completa y el stock se lleva en unidades sueltas.
   */
  unitsPerBox?: number;
  /**
   * `true` cuando el local cargo el precio/costo en bolivares: el seed guarda el
   * equivalente en USD y recuerda lo que se escribio (moneda, monto y tasa).
   */
  pricedInBs?: boolean;
  trackStock: boolean;
  category: string;
}

/**
 * Catalogo demo. Los productos con precio 0 son insumos/servicios internos: se
 * cargan y se consumen en inventario, pero no se venden en los pedidos.
 */
const PRODUCTS: SeedProduct[] = [
  { sku: 'BEB-001', name: 'Gaseosa 500ml', price: 4, cost: 2.2, stock: 240, minStock: 48, unit: 'UND', trackStock: true, category: 'Refrescos' },
  { sku: 'BEB-002', name: 'Agua mineral 625ml (caja 24)', price: 72, cost: 33.6, stock: 288, minStock: 48, unit: 'CAJA', unitsPerBox: 24, trackStock: true, category: 'Bebidas' },
  { sku: 'BEB-003', name: 'Malta 355ml', price: 3.5, cost: 2, stock: 180, minStock: 36, unit: 'UND', trackStock: true, category: 'Bebidas' },
  { sku: 'BEB-004', name: 'Jugo natural 1L', price: 7, cost: 3.5, stock: 90, minStock: 18, unit: 'LT', trackStock: true, category: 'Refrescos' },
  { sku: 'BEB-005', name: 'Cerveza lata 355ml', price: 5, cost: 3, stock: 200, minStock: 48, unit: 'UND', trackStock: true, category: 'Cervezas' },
  { sku: 'BEB-006', name: 'Cafe expreso 250ml', price: 4.5, cost: 1.8, stock: 120, minStock: 24, unit: 'UND', trackStock: true, category: 'Bebidas' },
  { sku: 'COM-001', name: 'Menu del dia', description: 'Sopa + segundo + refresco', price: 12, cost: 6.5, stock: 140, minStock: 30, unit: 'UND', trackStock: true, category: 'Comidas' },
  { sku: 'COM-002', name: 'Pollo a la brasa 1/4', price: 18, cost: 9, stock: 90, minStock: 20, unit: 'UND', trackStock: true, category: 'Comidas' },
  { sku: 'COM-003', name: 'Hamburguesa clasica', price: 15, cost: 7.5, stock: 110, minStock: 24, unit: 'UND', trackStock: true, category: 'Comidas' },
  { sku: 'COM-004', name: 'Pizza personal', price: 16, cost: 8, stock: 80, minStock: 18, unit: 'UND', trackStock: true, category: 'Comidas' },
  { sku: 'COM-005', name: 'Lasagna de carne', price: 14, cost: 7, stock: 70, minStock: 16, unit: 'UND', trackStock: true, category: 'Comidas' },
  { sku: 'COM-006', name: 'Ensalada cesar', price: 11, cost: 4.5, stock: 60, minStock: 14, unit: 'UND', trackStock: true, category: 'Comidas' },
  { sku: 'POS-001', name: 'Flan casero', price: 6, cost: 2.1, stock: 80, minStock: 18, unit: 'UND', trackStock: true, category: 'Postres' },
  { sku: 'POS-002', name: 'Torta de chocolate (porcion)', price: 7, cost: 2.8, stock: 70, minStock: 24, unit: 'UND', trackStock: true, category: 'Postres' },
  { sku: 'POS-003', name: 'Helado 2 bolas', price: 5, cost: 2, stock: 90, minStock: 20, unit: 'UND', trackStock: true, category: 'Postres' },
  { sku: 'PAN-001', name: 'Pan frances', price: 1, cost: 0.35, stock: 400, minStock: 80, unit: 'UND', trackStock: true, category: 'Panaderia' },
  { sku: 'PAN-002', name: 'Pan de queso', price: 2.5, cost: 1.1, stock: 260, minStock: 60, unit: 'UND', trackStock: true, category: 'Panaderia' },
  { sku: 'INS-001', name: 'Arroz extra', price: 0, cost: 4.8, stock: 120, minStock: 24, unit: 'KG', trackStock: true, category: 'Insumos' },
  { sku: 'INS-002', name: 'Harina de trigo', price: 0, cost: 3.2, stock: 150, minStock: 30, unit: 'KG', trackStock: true, category: 'Insumos' },
  { sku: 'INS-003', name: 'Aceite vegetal', price: 0, cost: 5.4, stock: 110, minStock: 24, unit: 'LT', trackStock: true, category: 'Insumos' },
  { sku: 'INS-004', name: 'Queso blanco', price: 0, cost: 7.9, stock: 70, minStock: 40, unit: 'KG', trackStock: true, category: 'Insumos' },
  { sku: 'LIM-001', name: 'Detergente 1L', price: 0, cost: 6.1, stock: 60, minStock: 14, unit: 'LT', trackStock: true, category: 'Limpieza' },
  { sku: 'LIM-002', name: 'Jabon liquido', price: 0, cost: 4.2, stock: 90, minStock: 40, unit: 'UND', pricedInBs: true, trackStock: true, category: 'Limpieza' },
  { sku: 'SER-001', name: 'Servicio de delivery', description: 'Flete cobrado al cliente', price: 3, cost: 0, stock: 0, minStock: 0, unit: 'UND', trackStock: false, category: 'Servicios' },
];

/** Gasto variable de la rutina diaria (se sortea varias veces al dia). */
interface SeedExpense {
  category: string;
  description: string;
  min: number;
  max: number;
  /** Proveedor sugerido cuando el gasto es una compra. */
  supplier?: string;
}

const EXPENSE_POOL: SeedExpense[] = [
  { category: ExpenseCategory.OPERATIVO, description: 'Gas y productos de limpieza', min: 4, max: 16 },
  { category: ExpenseCategory.OPERATIVO, description: 'Hielo y bolsas para delivery', min: 2, max: 9 },
  { category: ExpenseCategory.OPERATIVO, description: 'Papeleria y rollos de facturacion', min: 2, max: 12 },
  { category: ExpenseCategory.SERVICIOS, description: 'Recarga de internet y telefonia', min: 3, max: 12 },
  { category: ExpenseCategory.SERVICIOS, description: 'Transporte y flete de mercancia', min: 5, max: 25 },
  { category: ExpenseCategory.COMPRAS, description: 'Compra de mercancia perecedera', min: 18, max: 65, supplier: 'Distribuidora Andina' },
  { category: ExpenseCategory.COMPRAS, description: 'Compra de lacteos', min: 12, max: 40, supplier: 'Lacteos del Sur' },
  { category: ExpenseCategory.MANTENIMIENTO, description: 'Reparacion de equipos de cocina', min: 15, max: 90 },
  { category: ExpenseCategory.MANTENIMIENTO, description: 'Mantenimiento de la nevera exhibidora', min: 10, max: 55 },
  { category: ExpenseCategory.OTROS, description: 'Propinas y gastos varios', min: 2, max: 15 },
];

/** Gastos fijos que caen en un dia concreto del mes. */
interface FixedExpense {
  dayOfMonth: number;
  category: string;
  description: string;
  amount: number;
}

const FIXED_EXPENSES: FixedExpense[] = [
  { dayOfMonth: 1, category: ExpenseCategory.SUELDOS, description: 'Quincena 1 del personal', amount: 240 },
  { dayOfMonth: 5, category: ExpenseCategory.IMPUESTOS, description: 'IVA municipal del mes', amount: 85 },
  { dayOfMonth: 15, category: ExpenseCategory.SUELDOS, description: 'Quincena 2 del personal', amount: 225 },
  { dayOfMonth: 20, category: ExpenseCategory.SERVICIOS, description: 'Internet y telefonia (plan mensual)', amount: 42 },
];

/** Un abono planificado de una cuenta por cobrar/pagar. */
interface PlannedPayment {
  /** Dias de antiguedad del abono (0 = hoy). Debe ser <= `createdDaysAgo`. */
  daysAgo: number;
  /** Porcion del total que se abona (0..1). */
  ratio: number;
  method: string;
  /** Moneda en la que se hace el abono. */
  currency: string;
  /** `true` si el dinero entra/sale del efectivo de la caja. */
  cash: boolean;
  note?: string;
}

/** Cuenta por cobrar/pagar de demo (con sus abonos planificados). */
interface SeedAccount {
  /** Nombre del cliente (por cobrar) o del proveedor (por pagar). */
  party: string;
  description: string;
  /** Monto total en USD (moneda base). */
  amount: number;
  reference?: string;
  notes?: string;
  /** Antiguedad del alta de la cuenta (0 = hoy). */
  createdDaysAgo: number;
  /** Dias de plazo de pago desde el alta. */
  dueInDays: number;
  /** Cuenta anulada: no lleva abonos y queda en estado CANCELLED. */
  cancelled?: boolean;
  payments: PlannedPayment[];
}

const PAYABLES: SeedAccount[] = [
  {
    party: 'Distribuidora Andina',
    description: 'Compra de bebidas y abarrotes (pedido semanal)',
    amount: 420,
    reference: 'FAC-10231',
    createdDaysAgo: 27,
    dueInDays: 8,
    payments: [
      { daysAgo: 22, ratio: 0.5, method: PaymentMethod.CASH, currency: LOCAL_CURRENCY_CODE, cash: true, note: 'Abono en bolivares' },
      { daysAgo: 12, ratio: 0.5, method: PaymentMethod.TRANSFER, currency: BASE_CURRENCY_CODE, cash: false },
    ],
  },
  {
    party: 'Lacteos del Sur',
    description: 'Quesos, mantequilla y crema',
    amount: 180.5,
    reference: 'FAC-7741',
    createdDaysAgo: 20,
    dueInDays: 7,
    payments: [
      { daysAgo: 6, ratio: 1, method: PaymentMethod.CASH, currency: BASE_CURRENCY_CODE, cash: true },
    ],
  },
  {
    party: 'Bebidas del Caribe',
    description: 'Reposicion de cerveza y malta',
    amount: 265,
    reference: 'FAC-3320',
    createdDaysAgo: 15,
    dueInDays: 5,
    payments: [
      { daysAgo: 9, ratio: 0.4, method: PaymentMethod.TRANSFER, currency: BASE_CURRENCY_CODE, cash: false },
    ],
  },
  {
    party: 'Servicios Electricos Caracas',
    description: 'Factura de electricidad del local',
    amount: 145.75,
    reference: 'SEL-99120',
    createdDaysAgo: 12,
    dueInDays: 3,
    payments: [],
  },
  {
    party: 'Panaderia El Trigal',
    description: 'Harina, levadura y mantequilla',
    amount: 96.4,
    createdDaysAgo: 8,
    dueInDays: 2,
    payments: [
      { daysAgo: 2, ratio: 0.6, method: PaymentMethod.CASH, currency: LOCAL_CURRENCY_CODE, cash: true },
    ],
  },
  {
    party: 'Distribuidora Andina',
    description: 'Arroz, aceite y enlatados',
    amount: 310,
    createdDaysAgo: 3,
    dueInDays: 12,
    payments: [],
  },
  {
    party: 'Lacteos del Sur',
    description: 'Pedido de lacteos anulado por faltante',
    amount: 88,
    cancelled: true,
    notes: 'El proveedor no tenia stock disponible.',
    createdDaysAgo: 10,
    dueInDays: 3,
    payments: [],
  },
];

const RECEIVABLES: SeedAccount[] = [
  {
    party: 'Panaderia La Espiga',
    description: 'Venta al credito (reposteria de la semana)',
    amount: 240,
    reference: 'CC-1188',
    createdDaysAgo: 28,
    dueInDays: 10,
    payments: [
      { daysAgo: 20, ratio: 0.5, method: PaymentMethod.TRANSFER, currency: BASE_CURRENCY_CODE, cash: false },
      { daysAgo: 10, ratio: 0.5, method: PaymentMethod.CASH, currency: LOCAL_CURRENCY_CODE, cash: true },
    ],
  },
  {
    party: 'Eventos Delicias C.A.',
    description: 'Catering de evento corporativo',
    amount: 520,
    reference: 'CC-1195',
    createdDaysAgo: 24,
    dueInDays: 15,
    payments: [
      { daysAgo: 14, ratio: 0.35, method: PaymentMethod.TRANSFER, currency: BASE_CURRENCY_CODE, cash: false },
    ],
  },
  {
    party: 'Maria Perez',
    description: 'Cena familiar a credito',
    amount: 86.5,
    createdDaysAgo: 18,
    dueInDays: 5,
    payments: [
      { daysAgo: 12, ratio: 1, method: PaymentMethod.CASH, currency: BASE_CURRENCY_CODE, cash: true },
    ],
  },
  {
    party: 'Carlos Rondon',
    description: 'Pedido por delivery a credito',
    amount: 64.25,
    createdDaysAgo: 11,
    dueInDays: 4,
    payments: [
      { daysAgo: 5, ratio: 0.5, method: PaymentMethod.CASH, currency: LOCAL_CURRENCY_CODE, cash: true },
    ],
  },
  {
    party: 'Colegio San Jose',
    description: 'Meriendas escolares (factura mensual)',
    amount: 385,
    reference: 'CC-1203',
    createdDaysAgo: 7,
    dueInDays: 10,
    payments: [],
  },
  {
    party: 'Consumidor final',
    description: 'Venta al credito en mostrador',
    amount: 45.75,
    createdDaysAgo: 4,
    dueInDays: 3,
    payments: [],
  },
  {
    party: 'Pedro Silva',
    description: 'Reserva de salon anulada por el cliente',
    amount: 120,
    cancelled: true,
    notes: 'El cliente no confirmo la fecha.',
    createdDaysAgo: 16,
    dueInDays: 7,
    payments: [],
  },
];

/** Proveedor habitual de cada categoria (para carga inicial y reposiciones). */
const SUPPLIER_BY_CATEGORY: Record<string, string> = {
  Bebidas: 'Bebidas del Caribe',
  Comidas: 'Distribuidora Andina',
  Postres: 'Lacteos del Sur',
  Panaderia: 'Panaderia El Trigal',
  Insumos: 'Distribuidora Andina',
  Limpieza: 'Distribuidora Andina',
};

// ===========================================================================
//  Sembrado de datos maestros (idempotente)
// ===========================================================================

/** Configuracion de una moneda lista para guardar en `currencies.config`. */
function currencySetting(
  code: string,
  options: { enabled: boolean; rate?: number },
): CurrencySetting {
  const info = currencyInfo(code);
  return {
    code: info.code,
    label: info.label,
    symbol: info.symbol,
    enabled: options.enabled,
    rate: options.rate ?? null,
    decimals: info.decimals,
  };
}

interface MasterData {
  adminId: string;
  operatorIds: string[];
  supplierIds: Map<string, string>;
  customerIds: Map<string, string>;
  categoryIds: Map<string, string>;
}

/**
 * Ejecuta una tarea con otra empresa activa y restaura la anterior al terminar.
 * Asi cada bloque (configuracion, catalogo, historial) se siembra en su empresa.
 */
async function withCompany<T>(companyId: string, task: () => Promise<T>): Promise<T> {
  const previous = COMPANY_ID;
  COMPANY_ID = companyId;
  try {
    return await task();
  } finally {
    COMPANY_ID = previous;
  }
}

/** Crea (o actualiza) las empresas del seed por su RIF. */
async function seedCompanies(): Promise<{ primaryId: string; secondaryId: string }> {
  const ids: string[] = [];
  for (const company of COMPANIES) {
    const row = await prisma.company.upsert({
      where: { rif: company.rif },
      update: { ...company, active: true },
      create: company,
    });
    ids.push(row.id);
  }

  console.log(
    `  Empresas: ${COMPANIES.map((company) => `${company.name} (${company.rif})`).join(', ')}`,
  );
  return { primaryId: ids[0], secondaryId: ids[1] };
}

/** Usuarios demo (se identifican por email; nunca se duplican). */
async function seedUsers(
  companyId: string,
  secondaryCompanyId: string,
): Promise<{ adminId: string; operatorIds: string[] }> {
  const byEmail = new Map<string, string>();
  for (const user of USERS) {
    const passwordHash = await hashPassword(user.password);
    const row = await prisma.user.upsert({
      where: { email: user.email },
      update: { name: user.name, active: true, phone: user.phone ?? null },
      create: {
        email: user.email,
        name: user.name,
        active: true,
        phone: user.phone ?? null,
        passwordHash,
      },
    });

    // El rol vive en la membresia (usuario + empresa), no en el usuario.
    await prisma.membership.upsert({
      where: { userId_companyId: { userId: row.id, companyId } },
      update: { role: user.role, active: true },
      create: { userId: row.id, companyId, role: user.role, active: true },
    });

    byEmail.set(user.email, row.id);
  }

  // El administrador y el encargado tambien pertenecen a la segunda empresa, con
  // un rol DISTINTO al de la principal: es lo que permite demostrar el cambio de
  // empresa activa y que el rol es por empresa, no del usuario.
  const extraMemberships = [
    { email: 'admin@nexohub.com', role: Role.MANAGER },
    { email: 'manager@nexohub.com', role: Role.ADMIN },
  ];
  for (const extra of extraMemberships) {
    const userId = byEmail.get(extra.email) as string;
    await prisma.membership.upsert({
      where: { userId_companyId: { userId, companyId: secondaryCompanyId } },
      update: { role: extra.role, active: true },
      create: { userId, companyId: secondaryCompanyId, role: extra.role, active: true },
    });
  }

  console.log(`  Usuarios: ${USERS.map((u) => `${u.email} (${u.role})`).join(', ')}`);
  return {
    adminId: byEmail.get('admin@nexohub.com') as string,
    operatorIds: [
      byEmail.get('caja@nexohub.com') as string,
      byEmail.get('cashier@nexohub.com') as string,
      byEmail.get('manager@nexohub.com') as string,
    ],
  };
}

/**
 * Configuracion del local: monedas aceptadas y tasa personalizada del dolar.
 * La tasa guardada es la del ultimo dia de la serie para que los datos de hoy
 * cuadren con lo que muestra la aplicacion.
 */
async function seedSettings(adminId: string): Promise<void> {
  const settings: CurrencySetting[] = [
    currencySetting(BASE_CURRENCY_CODE, { enabled: true }),
    currencySetting(LOCAL_CURRENCY_CODE, { enabled: true }),
    currencySetting('EUR', { enabled: true }),
    currencySetting('COP', { enabled: true, rate: COP_RATE }),
    currencySetting('PEN', { enabled: false, rate: 82.5 }),
  ];
  const value = JSON.stringify(settings);

  await prisma.setting.upsert({
    where: { companyId_key: { companyId: COMPANY_ID, key: CURRENCIES_KEY } },
    update: { value, updatedById: adminId },
    create: {
      companyId: COMPANY_ID,
      key: CURRENCIES_KEY,
      value,
      updatedById: adminId,
    },
  });

  const customUsd = RATES[RATES.length - 1].bsPerUsd;
  await prisma.setting.upsert({
    where: { companyId_key: { companyId: COMPANY_ID, key: CUSTOM_RATE_KEY } },
    update: { value: String(customUsd), updatedById: adminId },
    create: {
      companyId: COMPANY_ID,
      key: CUSTOM_RATE_KEY,
      value: String(customUsd),
      updatedById: adminId,
    },
  });

  console.log(
    `  Configuracion: ${settings.map((s) => s.code).join(', ')} ` +
      `(activas: ${settings.filter((s) => s.enabled).map((s) => s.code).join(', ')})`,
  );
  console.log(`  Tasa personalizada: ${customUsd} Bs/USD`);
}

/**
 * Catalogo maestro: categorias, proveedores, clientes y productos.
 *
 * El `stock` de los productos se RESETEA al valor del catalogo (`PRODUCTS.stock`)
 * para que el historial de inventario que genera el seed arranque siempre de la
 * misma base (el generador lo recalcula a partir de los movimientos).
 */
async function seedCatalog(): Promise<{
  supplierIds: Map<string, string>;
  customerIds: Map<string, string>;
  categoryIds: Map<string, string>;
}> {
  const categoryIds = new Map<string, string>();
  for (const category of CATEGORIES) {
    // Las principales van primero en la lista: cuando toca crear una
    // subcategoria su principal ya existe.
    const data = {
      description: category.description,
      active: true,
      parentId: category.parent
        ? (categoryIds.get(category.parent) ?? null)
        : null,
    };
    const row = await prisma.category.upsert({
      where: { companyId_name: { companyId: COMPANY_ID, name: category.name } },
      update: data,
      create: { name: category.name, ...data, companyId: COMPANY_ID },
    });
    categoryIds.set(row.name, row.id);
  }

  const supplierIds = new Map<string, string>();
  for (const supplier of SUPPLIERS) {
    const existing = await prisma.supplier.findFirst({
      where: { name: supplier.name, companyId: COMPANY_ID },
    });
    const row = existing
      ? await prisma.supplier.update({
          where: { id: existing.id },
          data: { ...supplier, active: true },
        })
      : await prisma.supplier.create({
          data: { ...supplier, active: true, companyId: COMPANY_ID },
        });
    supplierIds.set(row.name, row.id);
  }

  const customerIds = new Map<string, string>();
  for (const customer of CUSTOMERS) {
    const existing = await prisma.customer.findFirst({
      where: { name: customer.name, companyId: COMPANY_ID },
    });
    const row = existing
      ? await prisma.customer.update({
          where: { id: existing.id },
          data: { ...customer, active: true },
        })
      : await prisma.customer.create({
          data: { ...customer, active: true, companyId: COMPANY_ID },
        });
    customerIds.set(row.name, row.id);
  }

  const today = RATES[RATES.length - 1];
  for (const product of PRODUCTS) {
    const units = product.unitsPerBox ?? 1;
    // Contexto de moneda: por defecto el precio se cargo en dolares; los
    // productos `pricedInBs` se cargaron en bolivares (su equivalente en USD se
    // guarda igual, con la tasa y el monto que se escribio).
    const currency = product.pricedInBs ? LOCAL_CURRENCY_CODE : BASE_CURRENCY_CODE;
    const rate = product.pricedInBs ? 1 : today.bsPerUsd;
    const entered = (value: number): number =>
      product.pricedInBs ? round2(value * today.bsPerUsd) : value;
    // El costo de la unidad suelta se reparte entre las unidades de la caja y el
    // precio de venta unitario tambien (72 / 24 = 3). El operador puede fijar otro
    // precio unitario desde el formulario; 0 = sin definir.
    const unitCost = units > 1 ? money.div(product.cost, units) : product.cost;
    const unitPrice = units > 1 ? money.div(product.price, units) : 0;

    const base = {
      name: product.name,
      description: product.description ?? null,
      price: product.price,
      priceCurrency: currency,
      priceRate: rate,
      priceEntered: entered(product.price),
      cost: product.cost,
      costCurrency: currency,
      costRate: rate,
      costEntered: entered(product.cost),
      unitCost,
      unitCostEntered: entered(unitCost),
      unitPrice,
      unitPriceCurrency: currency,
      unitPriceRate: rate,
      unitPriceEntered: entered(unitPrice),
      minStock: product.minStock,
      unit: product.unit,
      unitsPerBox: units,
      trackStock: product.trackStock,
      active: true,
      categoryId: categoryIds.get(product.category) ?? null,
      supplierId: supplierIds.get(SUPPLIER_BY_CATEGORY[product.category] ?? '') ?? null,
    };

    await prisma.product.upsert({
      where: { companyId_sku: { companyId: COMPANY_ID, sku: product.sku } },
      // El stock vuelve al valor del catalogo: lo reconstruye el historial.
      update: { ...base, stock: product.stock },
      create: { ...base, companyId: COMPANY_ID, sku: product.sku, stock: product.stock },
    });
  }

  console.log(
    `  Catalogo: ${categoryIds.size} categorias, ${supplierIds.size} proveedores, ` +
      `${customerIds.size} clientes y ${PRODUCTS.length} productos`,
  );

  return { supplierIds, customerIds, categoryIds };
}

// ===========================================================================
//  Menus demo (recetas con los productos del catalogo)
// ===========================================================================

/** Categorias comerciales del menu (con una subcategoria de ejemplo). */
const MENU_CATEGORIES = [
  { name: 'Almuerzos', description: 'Platos del dia', color: '#f59e0b', sortOrder: 1 },
  {
    name: 'Sopas y cremas',
    description: 'Entradas calientes del dia',
    color: '#f97316',
    sortOrder: 1,
    parent: 'Almuerzos',
  },
  { name: 'Combos', description: 'Plato + bebida', color: '#0ea5e9', sortOrder: 2 },
  { name: 'Postres', description: 'Dulces de la casa', color: '#ec4899', sortOrder: 3 },
];

interface SeedMenu {
  code: string;
  name: string;
  description: string;
  category: string;
  price: number;
  preparationMinutes: number;
  /** `true` cuando el precio de la carta se cargo en bolivares. */
  pricedInBs?: boolean;
  /** Receta: SKU del producto y cuanto consume UNA unidad del menu. */
  ingredients: { sku: string; quantity: number; section?: string }[];
}

const MENU_ITEMS: SeedMenu[] = [
  {
    code: 'MENU-0001',
    name: 'Pollo a la brasa + gaseosa',
    description: 'Cuarto de pollo con guarnicion y gaseosa de 500 ml',
    category: 'Combos',
    price: 22,
    preparationMinutes: 20,
    ingredients: [
      { sku: 'COM-002', quantity: 1 },
      { sku: 'BEB-001', quantity: 1, section: 'Bebida' },
    ],
  },
  {
    code: 'MENU-0002',
    name: 'Hamburguesa + malta',
    description: 'Hamburguesa clasica con malta bien fria',
    category: 'Combos',
    price: 18,
    preparationMinutes: 15,
    ingredients: [
      { sku: 'COM-003', quantity: 1 },
      { sku: 'BEB-003', quantity: 1, section: 'Bebida' },
    ],
  },
  {
    code: 'MENU-0003',
    name: 'Pizza personal + jugo',
    description: 'Pizza personal acompanada de medio litro de jugo natural',
    category: 'Almuerzos',
    price: 20,
    preparationMinutes: 18,
    ingredients: [
      { sku: 'COM-004', quantity: 1 },
      // Medio litro: el jugo se controla en litros, asi que la receta consume 0.5.
      { sku: 'BEB-004', quantity: 0.5, section: 'Bebida' },
    ],
  },
  {
    code: 'MENU-0004',
    name: 'Menu del dia con postre',
    description: 'Sopa + segundo + refresco y flan casero de postre',
    category: 'Almuerzos',
    price: 17,
    preparationMinutes: 15,
    ingredients: [
      { sku: 'COM-001', quantity: 1 },
      { sku: 'POS-001', quantity: 1, section: 'Postre' },
    ],
  },
  {
    code: 'MENU-0005',
    name: 'Ensalada cesar con pan de queso',
    description: 'Ensalada cesar con dos panes de queso',
    category: 'Almuerzos',
    price: 13,
    // Precio de la carta cargado en bolivares (2.950 Bs, con la tasa del dia).
    pricedInBs: true,
    preparationMinutes: 10,
    ingredients: [
      { sku: 'COM-006', quantity: 1 },
      { sku: 'PAN-002', quantity: 2, section: 'Acompanamiento' },
    ],
  },
];

/**
 * Categorias y menus de demo. La receta usa los productos del catalogo, asi que
 * vender un menu descuenta sus ingredientes igual que en produccion: el costo se
 * calcula con el costo de cada producto y su cantidad.
 */
async function seedMenus(): Promise<void> {
  const menuCategoryIds = new Map<string, string>();
  for (const category of MENU_CATEGORIES) {
    // Igual que en el catalogo: la principal se crea antes que su subcategoria.
    const data = {
      description: category.description,
      color: category.color,
      sortOrder: category.sortOrder,
      active: true,
      parentId: category.parent
        ? (menuCategoryIds.get(category.parent) ?? null)
        : null,
    };
    const row = await prisma.menuCategory.upsert({
      where: { companyId_name: { companyId: COMPANY_ID, name: category.name } },
      update: data,
      create: { name: category.name, ...data, companyId: COMPANY_ID },
    });
    menuCategoryIds.set(row.name, row.id);
  }

  const products = await prisma.product.findMany({
    where: { companyId: COMPANY_ID },
    select: { id: true, sku: true, cost: true },
  });
  const productBySku = new Map(products.map((product) => [product.sku, product]));

  let created = 0;
  // Tasa del ultimo dia del historial: es la que queda vigente al terminar.
  const todayRates = RATES[RATES.length - 1];
  for (const item of MENU_ITEMS) {
    const recipe = item.ingredients
      .map((ingredient) => ({
        ...ingredient,
        product: productBySku.get(ingredient.sku),
      }))
      .filter(
        (ingredient): ingredient is typeof ingredient & { product: { id: string; cost: number } } =>
          !!ingredient.product,
      );
    if (recipe.length === 0) continue;

    const cost =
      Math.round(
        recipe.reduce(
          (acc, ingredient) => acc + ingredient.product.cost * ingredient.quantity,
          0,
        ) * 100,
      ) / 100;

    const base = {
      name: item.name,
      description: item.description,
      price: item.price,
      priceCurrency: item.pricedInBs ? LOCAL_CURRENCY_CODE : BASE_CURRENCY_CODE,
      priceRate: item.pricedInBs ? 1 : todayRates.bsPerUsd,
      priceEntered: item.pricedInBs
        ? round2(item.price * todayRates.bsPerUsd)
        : item.price,
      cost,
      availability: 'ALL',
      preparationMinutes: item.preparationMinutes,
      categoryId: menuCategoryIds.get(item.category) ?? null,
      active: true,
    };

    const menu = await prisma.menu.upsert({
      where: { companyId_code: { companyId: COMPANY_ID, code: item.code } },
      update: base,
      create: { ...base, companyId: COMPANY_ID, code: item.code },
    });

    // La receta se reconstruye en cada siembra (no se duplica).
    await prisma.menuIngredient.deleteMany({ where: { menuId: menu.id } });
    await prisma.menuIngredient.createMany({
      data: recipe.map((ingredient, index) => ({
        companyId: COMPANY_ID,
        menuId: menu.id,
        productId: ingredient.product.id,
        quantity: ingredient.quantity,
        section: ingredient.section ?? 'Principal',
        sortOrder: index,
      })),
    });
    created += 1;
  }

  console.log(
    `  Menus: ${menuCategoryIds.size} categorias y ${created} menus con receta`,
  );
}

// ===========================================================================
//  Generacion del historial de operacion
// ===========================================================================

/** Cuenta de demo (por pagar o por cobrar) con sus abonos ya planificados. */
interface AccountPlan {
  kind: 'PAYABLE' | 'RECEIVABLE';
  id: string;
  /** Parte implicada: cliente (por cobrar) o proveedor (por pagar). */
  party: string;
  description: string;
  /** Monto total en la moneda de la cuenta (`currency`). */
  amount: number;
  /** Moneda en la que se registro la cuenta (USD en el seed). */
  currency: string;
  /** Equivalente del monto en USD (moneda base). */
  baseAmount: number;
  /** Total abonado hasta ahora (lo actualiza el generador). */
  paidAmount: number;
  status: string;
  /** Antiguedad del alta en dias (para validar los abonos). */
  createdDaysAgo: number;
  payments: PlannedPayment[];
}

/** Contexto compartido por todo el generador de historial. */
interface DemoContext {
  adminId: string;
  operators: string[];
  supplierIds: Map<string, string>;
  supplierNames: Map<string, string>;
  customerIds: Map<string, string>;
  customerNames: string[];
  products: Product[];
  /** Productos vendibles (precio > 0). */
  sellable: Product[];
  /** Productos con control de stock (candidatos a reposicion/ajuste). */
  tracked: Product[];
  /** Stock vivo por producto mientras se simula el historial. */
  stock: Map<string, number>;
  /** Marca de tiempo del ultimo movimiento de stock (reloj monotono). */
  lastStockAt: number;
  payables: AccountPlan[];
  receivables: AccountPlan[];
}

/** Una sesion de caja dentro de un turno (estado mutable del arqueo). */
interface ShiftContext {
  day: Date;
  index: number;
  rates: DayRates;
  sessionId: string;
  openedAt: Date;
  closedAt: Date;
  operatorId: string;
  /** Fondo inicial del turno en USD. */
  openingAmount: number;
  /** Efectivo (solo metodo CASH) que entro, en USD. */
  cashInBase: number;
  /** Efectivo (solo metodo CASH) que salio, en USD. */
  cashOutBase: number;
}

/** Efectivo disponible en la caja del turno (en USD). */
function availableCash(shift: ShiftContext): number {
  return money.sub(money.add(shift.openingAmount, shift.cashInBase), shift.cashOutBase);
}

/** Desenlace de un pedido en la simulacion. */
type OrderOutcome = 'PAID' | 'PARTIAL' | 'PENDING' | 'CANCELLED';

/** Monedas y metodos de pago que se sortean en los cobros. */
const SALE_CURRENCIES = [
  BASE_CURRENCY_CODE,
  BASE_CURRENCY_CODE,
  LOCAL_CURRENCY_CODE,
  LOCAL_CURRENCY_CODE,
  LOCAL_CURRENCY_CODE,
  'EUR',
  'COP',
];
const SALE_METHODS = [
  PaymentMethod.CASH,
  PaymentMethod.CASH,
  PaymentMethod.CASH,
  PaymentMethod.CARD,
  PaymentMethod.TRANSFER,
  PaymentMethod.YAPE,
  PaymentMethod.PLIN,
];

/** Hora aleatoria dentro de la ventana del turno (gastos y movimientos). */
function timeWithin(shift: ShiftContext, from = 10, to = -15): Date {
  const start = shift.openedAt.getTime() + from * 60000;
  const end = Math.max(start + 60000, shift.closedAt.getTime() + to * 60000);
  return new Date(start + Math.floor(random() * (end - start)));
}

/**
 * Borra los datos de operacion (caja, pedidos, gastos, cuentas e inventario) de
 * la empresa activa para regenerarlos. Los datos maestros y los usuarios NO se
 * tocan.
 */
async function wipeOperationalData(): Promise<void> {
  const where = { companyId: COMPANY_ID };
  await prisma.$transaction([
    prisma.receivablePayment.deleteMany({ where }),
    prisma.payablePayment.deleteMany({ where }),
    prisma.orderPayment.deleteMany({ where }),
    prisma.orderItem.deleteMany({ where }),
    prisma.order.deleteMany({ where }),
    prisma.cashMovement.deleteMany({ where }),
    prisma.stockMovement.deleteMany({ where }),
    prisma.expense.deleteMany({ where }),
    prisma.accountReceivable.deleteMany({ where }),
    prisma.accountPayable.deleteMany({ where }),
    prisma.cashSession.deleteMany({ where }),
  ]);
  console.log('  Historial de operacion anterior eliminado');
}

/**
 * MOTOR DE STOCK del seed: replica lo que hace `InventoryService.applyMovement`
 * (stock resultante + movimiento append-only con `stockBefore`/`stockAfter`).
 */
async function applyStockMovement(
  ctx: DemoContext,
  options: {
    productId: string;
    type: string;
    quantity: number;
    at: Date;
    createdById: string;
    reason?: string;
    referenceType?: string;
    referenceId?: string;
    unitCost?: number;
    /** En ajustes (`ADJUSTMENT`), `quantity` es el stock FINAL deseado. */
    absolute?: boolean;
  },
): Promise<number> {
  const before = ctx.stock.get(options.productId) ?? 0;
  const after = options.absolute
    ? options.quantity
    : options.type === StockMovementType.IN
      ? before + options.quantity
      : before - options.quantity;

  if (after < 0) {
    const info = ctx.products.find((product) => product.id === options.productId);
    throw new Error(
      `Inventario inconsistente en el seed: ${info?.sku ?? options.productId} quedaria en ` +
        `${after} (stock actual ${before}, tipo ${options.type})`,
    );
  }

  // Reloj monotono: el orden de creacion coincide siempre con el orden
  // cronologico, de modo que la cadena `stockBefore`/`stockAfter` de cada
  // producto queda consistente en la base de datos.
  const at = new Date(Math.max(options.at.getTime(), ctx.lastStockAt + 60000));
  ctx.lastStockAt = at.getTime();

  ctx.stock.set(options.productId, after);
  // Trazabilidad de la unidad: el stock se mueve en la unidad del producto.
  const info = ctx.products.find((product) => product.id === options.productId);
  // En las presentaciones (cajas/paquetes) el stock vive en unidades sueltas.
  const stockUnit = info && boxUnitsOf(info) > 1 ? 'UND' : (info?.unit ?? 'UND');
  await prisma.stockMovement.create({
    data: {
      companyId: COMPANY_ID,
      productId: options.productId,
      type: options.type,
      quantity: Math.abs(after - before),
      stockBefore: before,
      stockAfter: after,
      inputUnit: stockUnit,
      inputQuantity: Math.abs(after - before),
      unitCost: options.unitCost ?? null,
      unitCostCurrency: BASE_CURRENCY_CODE,
      unitCostEntered: options.unitCost ?? null,
      reason: options.reason,
      referenceType: options.referenceType,
      referenceId: options.referenceId,
      createdById: options.createdById,
      createdAt: at,
    },
  });

  return after;
}

/** Movimiento de caja a registrar dentro de un turno. */
interface CashMovementInput {
  category: string;
  type: string;
  method: string;
  amount: number;
  currency: string;
  exchangeRate: number | null;
  baseAmount: number;
  at: Date;
  description?: string;
  referenceType?: string;
  referenceId?: string;
}

/**
 * Registra un movimiento de caja y actualiza los acumuladores del arqueo.
 * Solo el efectivo (metodo CASH) altera el arqueo, igual que en
 * `CashService.buildBreakdown`.
 */
async function registerCashMovement(
  shift: ShiftContext,
  input: CashMovementInput,
): Promise<string> {
  const movement = await prisma.cashMovement.create({
    data: {
      companyId: COMPANY_ID,
      sessionId: shift.sessionId,
      type: input.type,
      category: input.category,
      paymentMethod: input.method,
      amount: input.amount,
      currency: input.currency,
      exchangeRate: input.exchangeRate,
      baseAmount: input.baseAmount,
      description: input.description,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      createdById: shift.operatorId,
      createdAt: input.at,
    },
  });

  if (input.method === PaymentMethod.CASH) {
    if (input.type === CashMovementType.IN) {
      shift.cashInBase = money.add(shift.cashInBase, input.baseAmount);
    } else {
      shift.cashOutBase = money.add(shift.cashOutBase, input.baseAmount);
    }
  }

  return movement.id;
}

/** Fondo inicial del turno: una o varias lineas de moneda. */
interface OpeningFund {
  lines: { currency: string; amount: number; rate: number | null; baseAmount: number }[];
  /** Total del fondo en USD. */
  amount: number;
  /** Moneda contada o `MIX` cuando fueron varias. */
  currency: string;
  rate: number | null;
}

/**
 * Construye el fondo inicial: la mayoria de los turnos abren con dolares, pero
 * hay dias con fondo en bolivares y dias con fondo contado en varias monedas
 * (el caso mixto que soporta `CashSession.openingLines`).
 */
function buildOpeningFund(rates: DayRates): OpeningFund {
  const style = pick(['USD', 'USD', 'VES', 'MIX', 'MIX', 'MIX'] as const);

  const raw: { currency: string; amount: number }[] = [];
  if (style === 'USD') {
    raw.push({ currency: BASE_CURRENCY_CODE, amount: randInt(80, 220) });
  } else if (style === 'VES') {
    raw.push({
      currency: LOCAL_CURRENCY_CODE,
      amount: fromBase(randInt(60, 170), LOCAL_CURRENCY_CODE, rates),
    });
  } else {
    raw.push({ currency: BASE_CURRENCY_CODE, amount: randInt(60, 180) });
    raw.push({
      currency: LOCAL_CURRENCY_CODE,
      amount: fromBase(randInt(40, 120), LOCAL_CURRENCY_CODE, rates),
    });
    if (chance(0.5)) {
      raw.push({ currency: 'EUR', amount: randInt(20, 80) });
    }
  }

  const lines = raw.map((line) => {
    const conversion = toBase(line.amount, line.currency, rates);
    return {
      currency: conversion.currency,
      amount: conversion.amount,
      rate: conversion.exchangeRate,
      baseAmount: conversion.baseAmount,
    };
  });

  const mixed = lines.length > 1;
  return {
    lines,
    amount: money.sum(lines.map((line) => line.baseAmount)),
    currency: mixed ? MIXED_CURRENCY_CODE : lines[0].currency,
    rate: mixed ? null : lines[0].rate,
  };
}

/** Movimiento manual de caja (retiro, deposito, devolucion, ajuste, ...). */
async function createManualMovement(
  shift: ShiftContext,
  options: {
    category: string;
    type: string;
    description: string;
    amountBase: number;
    at: Date;
    currency?: string;
    method?: string;
  },
): Promise<void> {
  const currency = options.currency ?? pick(['USD', 'USD', LOCAL_CURRENCY_CODE]);
  const method = options.method ?? PaymentMethod.CASH;
  let amountBase = options.amountBase;

  // Nunca se puede sacar mas efectivo del que hay en la caja (dejando cambio).
  if (options.type === CashMovementType.OUT && method === PaymentMethod.CASH) {
    const room = money.sub(availableCash(shift), 20);
    if (room < 5) return;
    amountBase = Math.min(amountBase, room);
  }

  const conversion = toBase(fromBase(amountBase, currency, shift.rates), currency, shift.rates);

  await registerCashMovement(shift, {
    category: options.category,
    type: options.type,
    method,
    amount: conversion.amount,
    currency: conversion.currency,
    exchangeRate: conversion.exchangeRate,
    baseAmount: conversion.baseAmount,
    at: options.at,
    description: options.description,
    referenceType: 'MANUAL',
  });
}

/**
 * Cobra un pedido: crea el movimiento de caja (IN/SALE), el `OrderPayment` y
 * actualiza el acumulado del pedido. `options.targetBase` es lo que se quiere
 * cobrar en USD; el monto real se ajusta al saldo pendiente.
 *
 * Devuelve el equivalente en USD realmente aplicado (0 si no se cobro nada).
 */
async function registerOrderPayment(
  shift: ShiftContext,
  order: { id: string; code: string; total: number; paidAmount: number },
  options: { targetBase: number; at: Date; currency?: string; method?: string; note?: string },
): Promise<number> {
  const balance = money.sub(order.total, order.paidAmount);
  if (balance <= 0) return 0;

  const target = Math.min(toMoney(options.targetBase), balance);
  const currency = options.currency ?? pick(SALE_CURRENCIES);
  const method = options.method ?? pick(SALE_METHODS);

  let conversion = toBase(fromBase(target, currency, shift.rates), currency, shift.rates);
  let baseAmount = fitToBalance(conversion.baseAmount, balance);
  if (baseAmount === null) {
    // El "pago exacto" en otra moneda se paso del saldo: se cobra el saldo.
    conversion = toBase(fromBase(balance, currency, shift.rates), currency, shift.rates);
    baseAmount = fitToBalance(conversion.baseAmount, balance) ?? balance;
  }
  if (baseAmount <= 0) return 0;

  const movementId = await registerCashMovement(shift, {
    category: CashMovementCategory.SALE,
    type: CashMovementType.IN,
    method,
    amount: conversion.amount,
    currency: conversion.currency,
    exchangeRate: conversion.exchangeRate,
    baseAmount,
    at: options.at,
    description: `Cobro pedido ${order.code}`,
    referenceType: 'ORDER',
    referenceId: order.id,
  });

  await prisma.orderPayment.create({
    data: {
      companyId: COMPANY_ID,
      orderId: order.id,
      amount: conversion.amount,
      method,
      currency: conversion.currency,
      exchangeRate: conversion.exchangeRate,
      baseAmount,
      cashMovementId: movementId,
      note: options.note ?? null,
      createdById: shift.operatorId,
      createdAt: options.at,
    },
  });

  order.paidAmount = money.add(order.paidAmount, baseAmount);
  return baseAmount;
}

/** Crea un pedido completo: items, inventario, cobros y estado final. */
async function createOrder(
  ctx: DemoContext,
  options: {
    code: string;
    at: Date;
    shift: ShiftContext | null;
    outcome: OrderOutcome;
  },
): Promise<void> {
  const operatorId = options.shift?.operatorId ?? ctx.adminId;

  // 1) Items: productos vendibles distintos, con cantidad segun su precio.
  const items: { product: Product; quantity: number; unitPrice: number; total: number }[] = [];
  const chosen = new Set<string>();
  const itemCount = randInt(1, 4);
  let guard = 0;
  while (items.length < itemCount && guard < 40) {
    guard += 1;
    const product = pick(ctx.sellable);
    if (chosen.has(product.id)) continue;
    chosen.add(product.id);
    // El precio de la linea es el de UNA unidad: en los productos por caja el
    // precio del catalogo es el de la presentacion completa.
    const unitPrice = money.div(product.price, boxUnitsOf(product));
    const quantity = unitPrice <= 2.5 ? randInt(2, 6) : randInt(1, 3);
    items.push({
      product,
      quantity,
      unitPrice: toMoney(unitPrice),
      total: money.mul(unitPrice, quantity),
    });
  }

  // 2) Totales (misma formula que `computeOrderTotals` del backend).
  const subtotal = money.sum(items.map((item) => item.total));
  const discount = chance(0.15) ? money.mul(subtotal, randAmount(0.05, 0.15)) : 0;
  const totals = computeOrderTotals({
    items: items.map((item) => ({ quantity: item.quantity, unitPrice: item.unitPrice })),
    discount,
    taxRate: pick(TAX_RATE_CHOICES),
  });

  const type = pick([
    OrderType.DINE_IN,
    OrderType.DINE_IN,
    OrderType.DINE_IN,
    OrderType.TAKEAWAY,
    OrderType.TAKEAWAY,
    OrderType.DELIVERY,
  ]);
  const customerName = chance(0.55) ? 'Consumidor final' : pick(ctx.customerNames);

  let status: string;
  if (options.outcome === 'CANCELLED') {
    status = OrderStatus.CANCELLED;
  } else if (options.outcome === 'PARTIAL') {
    status = pick([OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.READY]);
  } else if (options.outcome === 'PENDING') {
    status = pick([
      OrderStatus.PENDING,
      OrderStatus.CONFIRMED,
      OrderStatus.PREPARING,
      OrderStatus.READY,
    ]);
  } else {
    // Los pedidos que se cobran arrancan en PENDING y cierran como COMPLETED.
    status = OrderStatus.PENDING;
  }

  const order = await prisma.order.create({
    data: {
      companyId: COMPANY_ID,
      code: options.code,
      customerId: ctx.customerIds.get(customerName) ?? null,
      type,
      status,
      tableNumber: type === OrderType.DINE_IN ? `Mesa ${randInt(1, 12)}` : null,
      notes: chance(0.25) ? pick(ORDER_NOTES) : null,
      subtotal: totals.subtotal,
      discount: totals.discount,
      tax: totals.tax,
      total: totals.total,
      paidAmount: 0,
      paymentStatus: PaymentStatus.UNPAID,
      cashSessionId: options.shift?.sessionId ?? null,
      createdById: operatorId,
      createdAt: options.at,
      items: {
        create: items.map((item) => ({
          companyId: COMPANY_ID,
          productId: item.product.id,
          name: item.product.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.total,
        })),
      },
    },
  });

  // 3) El stock se descuenta al registrar la venta.
  for (const item of items) {
    if (!item.product.trackStock) continue;
    await applyStockMovement(ctx, {
      productId: item.product.id,
      type: StockMovementType.OUT,
      quantity: item.quantity,
      at: options.at,
      createdById: operatorId,
      reason: `Pedido ${order.code}`,
      referenceType: StockReferenceType.ORDER,
      referenceId: order.id,
    });
  }

  // 4) Cobros: completo, partido en dos pagos o abono parcial.
  const mutable = { id: order.id, code: order.code, total: totals.total, paidAmount: 0 };
  if (options.shift && options.outcome !== 'PENDING' && options.outcome !== 'CANCELLED') {
    const split = options.outcome === 'PAID' && chance(0.12);
    const ratios = options.outcome === 'PARTIAL'
      ? [randAmount(0.35, 0.6)]
      : split
        ? [0.6, 0.4]
        : [1];

    for (let i = 0; i < ratios.length; i += 1) {
      const target =
        ratios[i] === 1
          ? money.sub(totals.total, mutable.paidAmount)
          : money.mul(totals.total, ratios[i]);
      await registerOrderPayment(options.shift, mutable, {
        targetBase: target,
        at: new Date(options.at.getTime() + i * randInt(2, 6) * 60000),
        note: options.outcome === 'PARTIAL' ? 'Abono parcial del pedido' : undefined,
      });
    }
  }

  // 5) Estado final (mismo criterio que `OrdersService.addPayment`).
  const fullyPaid = compareMoney(mutable.paidAmount, totals.total) >= 0;
  await prisma.order.update({
    where: { id: order.id },
    data: {
      paidAmount: mutable.paidAmount,
      paymentStatus: fullyPaid
        ? PaymentStatus.PAID
        : mutable.paidAmount > 0
          ? PaymentStatus.PARTIAL
          : PaymentStatus.UNPAID,
      ...(fullyPaid ? { status: OrderStatus.COMPLETED } : {}),
    },
  });

  // 6) Pedido cancelado: lo consumido vuelve al inventario.
  if (options.outcome === 'CANCELLED') {
    const restockAt = new Date(options.at.getTime() + randInt(20, 90) * 60000);
    for (const item of items) {
      if (!item.product.trackStock) continue;
      await applyStockMovement(ctx, {
        productId: item.product.id,
        type: StockMovementType.IN,
        quantity: item.quantity,
        at: restockAt,
        createdById: ctx.adminId,
        reason: `Devolucion por cancelacion del pedido ${order.code}`,
        referenceType: StockReferenceType.ORDER,
        referenceId: order.id,
      });
    }
  }
}

// ===========================================================================
//  Cuentas por cobrar / pagar
// ===========================================================================

/** Tarea de abono de una cuenta asignada a un turno del dia. */
interface AccountPaymentTask {
  plan: AccountPlan;
  payment: PlannedPayment;
  shiftIndex: number;
}

/** Crea las cuentas de demo y valida que el guion de abonos sea coherente. */
async function createAccounts(options: {
  kind: 'PAYABLE' | 'RECEIVABLE';
  defs: SeedAccount[];
  adminId: string;
  supplierIds: Map<string, string>;
  customerIds: Map<string, string>;
}): Promise<AccountPlan[]> {
  const plans: AccountPlan[] = [];

  for (const def of options.defs) {
    if (def.cancelled && def.payments.length > 0) {
      throw new Error(`La cuenta cancelada "${def.description}" no puede tener abonos`);
    }
    for (const payment of def.payments) {
      if (payment.daysAgo >= def.createdDaysAgo) {
        throw new Error(
          `El abono de "${def.description}" seria anterior al alta de la cuenta ` +
            `(${payment.daysAgo} >= ${def.createdDaysAgo} dias de antiguedad)`,
        );
      }
    }

    const createdAt = atTime(dayOf(HISTORY_DAYS - 1 - def.createdDaysAgo), randInt(9, 18));
    const dueDate = addDays(createdAt, def.dueInDays);
    const status = def.cancelled ? AccountStatus.CANCELLED : AccountStatus.PENDING;
    const amount = toMoney(def.amount);
    const shared = {
      description: def.description,
      amount,
      currency: BASE_CURRENCY_CODE,
      exchangeRate: null,
      baseAmount: amount,
      paidAmount: 0,
      dueDate,
      status,
      reference: def.reference ?? null,
      notes: def.notes ?? null,
      createdById: options.adminId,
      createdAt,
    };

    let id: string;
    if (options.kind === 'PAYABLE') {
      const row = await prisma.accountPayable.create({
        data: {
          ...shared,
          companyId: COMPANY_ID,
          supplierId: options.supplierIds.get(def.party) ?? null,
        },
      });
      id = row.id;
    } else {
      const row = await prisma.accountReceivable.create({
        data: {
          ...shared,
          companyId: COMPANY_ID,
          customerId: options.customerIds.get(def.party) ?? null,
        },
      });
      id = row.id;
    }

    plans.push({
      kind: options.kind,
      id,
      party: def.party,
      description: def.description,
      amount,
      currency: BASE_CURRENCY_CODE,
      baseAmount: amount,
      paidAmount: 0,
      status,
      createdDaysAgo: def.createdDaysAgo,
      payments: def.payments,
    });
  }

  return plans;
}

/**
 * Registra un abono de una cuenta (con el mismo criterio que
 * `ReceivablesService.collect` / `PayablesService.addPayment`): el monto se
 * guarda en la moneda del abono + su equivalente en USD, el estado se deriva de
 * `baseAmount`/`paidAmount` y, si el dinero toca el efectivo, se refleja en el
 * arqueo del turno como movimiento `PAYMENT`.
 */
async function applyAccountPayment(shift: ShiftContext, task: AccountPaymentTask): Promise<void> {
  const { plan, payment } = task;
  const balance = money.sub(plan.baseAmount, plan.paidAmount);
  if (balance <= 0) return;

  const target = Math.min(money.mul(plan.baseAmount, payment.ratio), balance);
  const currency = payment.currency;

  let conversion = toBase(fromBase(target, currency, shift.rates), currency, shift.rates);
  let baseAmount = fitToBalance(conversion.baseAmount, balance);
  if (baseAmount === null) {
    conversion = toBase(fromBase(balance, currency, shift.rates), currency, shift.rates);
    baseAmount = fitToBalance(conversion.baseAmount, balance) ?? balance;
  }
  if (baseAmount <= 0) return;

  const at = timeWithin(shift, 30, -30);
  const paymentData = {
    amount: conversion.amount,
    method: payment.method,
    currency: conversion.currency,
    exchangeRate: conversion.exchangeRate,
    baseAmount,
    note: payment.note ?? null,
    createdById: shift.operatorId,
    createdAt: at,
  };

  if (plan.kind === 'PAYABLE') {
    await prisma.payablePayment.create({
      data: { ...paymentData, companyId: COMPANY_ID, payableId: plan.id },
    });
  } else {
    await prisma.receivablePayment.create({
      data: { ...paymentData, companyId: COMPANY_ID, receivableId: plan.id },
    });
  }

  // El estado de la cuenta se deriva de baseAmount/paidAmount (account.util.ts).
  plan.paidAmount = money.add(plan.paidAmount, baseAmount);
  plan.status = resolveAccountStatus(plan.baseAmount, plan.paidAmount);
  const accountData = { paidAmount: plan.paidAmount, status: plan.status };
  if (plan.kind === 'PAYABLE') {
    await prisma.accountPayable.update({ where: { id: plan.id }, data: accountData });
  } else {
    await prisma.accountReceivable.update({ where: { id: plan.id }, data: accountData });
  }

  // El abono solo toca el efectivo si hay suficiente (dejando cambio); si no,
  // se registra igual contra la cuenta pero sin movimiento de caja.
  const touchesCash = payment.cash && baseAmount <= money.sub(availableCash(shift), 5);
  if (!touchesCash) return;

  await registerCashMovement(shift, {
    category: CashMovementCategory.PAYMENT,
    type: plan.kind === 'PAYABLE' ? CashMovementType.OUT : CashMovementType.IN,
    method: payment.method,
    amount: conversion.amount,
    currency: conversion.currency,
    exchangeRate: conversion.exchangeRate,
    baseAmount,
    at,
    description:
      plan.kind === 'PAYABLE'
        ? `Pago a ${plan.party}: ${plan.description}`
        : `Cobro de ${plan.party}: ${plan.description}`,
    referenceType: plan.kind,
    referenceId: plan.id,
  });
}

// ===========================================================================
//  Inventario y gastos
// ===========================================================================

/** Reposicion de mercancia de un proveedor (llega temprano, no pasa por caja). */
async function restock(ctx: DemoContext, at: Date): Promise<void> {
  const count = randInt(0, 2);
  for (let i = 0; i < count; i += 1) {
    const product = pick(ctx.tracked);
    const quantity = product.price <= 2.5 ? randInt(80, 240) : randInt(24, 96);
    const supplierName = ctx.supplierNames.get(product.supplierId ?? '') ?? 'proveedor';
    await applyStockMovement(ctx, {
      productId: product.id,
      type: StockMovementType.IN,
      quantity,
      unitCost: round2(product.cost * (0.95 + random() * 0.1)),
      at,
      createdById: ctx.adminId,
      reason: `Reposicion de mercancia (${supplierName})`,
      referenceType: StockReferenceType.PURCHASE,
    });
  }
}

/**
 * Ajustes finales de inventario: dejan algunos productos por debajo de su stock
 * minimo para poder probar las alertas de "stock critico" del panel.
 */
async function adjustLowStock(ctx: DemoContext): Promise<void> {
  const day = dayOf(HISTORY_DAYS - 2);
  const requests = [
    { sku: 'POS-002', stock: 6, reason: 'Merma por vencimiento' },
    { sku: 'INS-004', stock: 8, reason: 'Ajuste por inventario fisico' },
    { sku: 'LIM-002', stock: 5, reason: 'Consumo interno (limpieza del local)' },
    { sku: 'COM-006', stock: 7, reason: 'Merma de producto fresco' },
  ];

  for (const request of requests) {
    const product = ctx.products.find((item) => item.sku === request.sku);
    if (!product) continue;
    await applyStockMovement(ctx, {
      productId: product.id,
      type: StockMovementType.ADJUSTMENT,
      quantity: request.stock,
      absolute: true,
      at: atTime(day, 22, 30),
      createdById: ctx.adminId,
      reason: request.reason,
      referenceType: StockReferenceType.ADJUSTMENT,
    });
  }
}

/** Gasto a registrar (variable de la rutina o fijo del mes). */
interface ExpenseInput {
  category: string;
  description: string;
  /** Monto en USD (moneda base). */
  amountBase: number;
  currency?: string;
  supplier?: string;
  method?: string;
  cash?: boolean;
}

/** Gasto asignado a un turno del dia. */
interface ExpenseTask {
  shiftIndex: number;
  input: ExpenseInput;
}

/**
 * Registra un gasto y, si se paga en efectivo, su egreso de caja
 * (mismo comportamiento que `ExpensesService.create`).
 */
async function createExpense(
  ctx: DemoContext,
  shift: ShiftContext,
  input: ExpenseInput,
): Promise<void> {
  const currency =
    input.currency ??
    pick([BASE_CURRENCY_CODE, BASE_CURRENCY_CODE, BASE_CURRENCY_CODE, LOCAL_CURRENCY_CODE, 'EUR']);
  const method =
    input.method ??
    pick([PaymentMethod.CASH, PaymentMethod.CASH, PaymentMethod.TRANSFER, PaymentMethod.CARD]);
  const at = timeWithin(shift, 20, -20);
  const conversion = toBase(fromBase(input.amountBase, currency, shift.rates), currency, shift.rates);

  // Si el gasto se iba a pagar en efectivo pero no alcanza (dejando cambio), se
  // registra igual pero sin tocar la caja (el arqueo no puede quedar negativo).
  const cash =
    (input.cash ?? method === PaymentMethod.CASH) &&
    conversion.baseAmount <= money.sub(availableCash(shift), 5);

  const expense = await prisma.expense.create({
    data: {
      companyId: COMPANY_ID,
      category: input.category,
      description: input.description,
      amount: conversion.amount,
      currency: conversion.currency,
      exchangeRate: conversion.exchangeRate,
      baseAmount: conversion.baseAmount,
      date: at,
      paymentMethod: method,
      supplierId: input.supplier ? ctx.supplierIds.get(input.supplier) ?? null : null,
      cashSessionId: cash ? shift.sessionId : null,
      createdById: shift.operatorId,
      createdAt: at,
    },
  });

  if (!cash) return;

  await registerCashMovement(shift, {
    category: CashMovementCategory.EXPENSE,
    type: CashMovementType.OUT,
    method,
    amount: conversion.amount,
    currency: conversion.currency,
    exchangeRate: conversion.exchangeRate,
    baseAmount: conversion.baseAmount,
    at,
    description: `Gasto: ${input.description}`,
    referenceType: 'EXPENSE',
    referenceId: expense.id,
  });
}

// ===========================================================================
//  Simulacion de los turnos y los dias
// ===========================================================================

/** Opciones de un turno de caja. */
interface ShiftOptions {
  index: number;
  day: Date;
  rates: DayRates;
  shiftIndex: number;
  /** Numero secuencial de la sesion dentro del dia (codigo CJ-...). */
  sessionSeq: number;
  openHour: number;
  closeHour: number;
  today: boolean;
  /** Contador de pedidos del dia (los codigos PED-... son unicos por dia). */
  orderSeq: { value: number };
  accountPayments: AccountPaymentTask[];
  expenses: ExpenseTask[];
}

/** Desenlace aleatorio de un pedido (hoy quedan cuentas abiertas en el tablero). */
function pickOutcome(today: boolean): OrderOutcome {
  const roll = random();
  if (today) {
    if (roll < 0.45) return 'PENDING';
    if (roll < 0.55) return 'PARTIAL';
    return 'PAID';
  }
  if (roll < 0.05) return 'CANCELLED';
  if (roll < 0.07) return 'PARTIAL';
  return 'PAID';
}

/** Diferencia de arqueo: la mayoria de los cierres cuadran al centavo. */
function pickDifference(): number {
  const roll = random();
  if (roll < 0.55) return 0;
  if (roll < 0.78) return randAmount(-6, -0.4);
  return randAmount(0.3, 4);
}

/** Simula un turno completo: apertura, pedidos, gastos y cierre con arqueo. */
async function simulateShift(ctx: DemoContext, options: ShiftOptions): Promise<void> {
  const operatorId = pick(ctx.operators);
  const fund = buildOpeningFund(options.rates);
  const now = Date.now();

  // Hoy la caja tiene que haber abierto antes de "ahora" (nunca en el futuro).
  const openedAt = options.today
    ? new Date(
        Math.min(
          Math.max(options.day.getTime() + 7 * 3600000, now - randInt(90, 300) * 60000),
          now - 30 * 60000,
        ),
      )
    : atTime(options.day, options.openHour, randInt(0, 30));
  const closedAt = options.today
    ? new Date(now - randInt(5, 20) * 60000)
    : atTime(options.day, options.closeHour, randInt(0, 45));

  const session = await prisma.cashSession.create({
    data: {
      companyId: COMPANY_ID,
      code: buildCode('CJ', options.sessionSeq, options.day),
      status: CashSessionStatus.OPEN,
      openedById: operatorId,
      openedAt,
      openingAmount: fund.amount,
      openingCurrency: fund.currency,
      openingRate: fund.rate,
      // El desglose se guarda con los montos en centavos (ver money-codec).
      openingLines: JSON.stringify(
        moneyFieldsToCents(fund.lines, OPENING_LINE_MONEY_FIELDS),
      ),
      openingNotes:
        fund.lines.length > 1
          ? 'Fondo contado en varias monedas'
          : `Fondo contado en ${fund.currency}`,
      createdAt: openedAt,
    },
  });

  const shift: ShiftContext = {
    day: options.day,
    index: options.index,
    rates: options.rates,
    sessionId: session.id,
    openedAt,
    closedAt,
    operatorId,
    openingAmount: fund.amount,
    cashInBase: 0,
    cashOutBase: 0,
  };

  // --- Pedidos del turno (en orden cronologico) --------------------------
  const orderCount = randInt(ORDERS_PER_SHIFT.min, ORDERS_PER_SHIFT.max);
  const windowStart = openedAt.getTime() + 5 * 60000;
  const windowEnd = Math.max(windowStart + 60000, closedAt.getTime() - 5 * 60000);
  const times = Array.from({ length: orderCount }, () =>
    new Date(windowStart + Math.floor(random() * (windowEnd - windowStart))),
  ).sort((a, b) => a.getTime() - b.getTime());

  for (let i = 0; i < times.length; i += 1) {
    const outcome = pickOutcome(options.today);
    options.orderSeq.value += 1;
    await createOrder(ctx, {
      code: buildCode('PED', options.orderSeq.value, options.day),
      at: times[i],
      shift: outcome === 'PENDING' || outcome === 'CANCELLED' ? null : shift,
      outcome,
    });
  }

  // --- Gastos variables del dia + fijos que caen hoy en este turno -------
  const variableExpenses = randInt(1, 3);
  for (let i = 0; i < variableExpenses; i += 1) {
    const def = pick(EXPENSE_POOL);
    await createExpense(ctx, shift, {
      category: def.category,
      description: def.description,
      amountBase: randAmount(def.min, def.max),
      supplier: def.supplier,
    });
  }
  for (const task of options.expenses.filter((item) => item.shiftIndex === options.shiftIndex)) {
    await createExpense(ctx, shift, task.input);
  }

  // --- Abonos de cuentas por cobrar/pagar que caen hoy -------------------
  for (const task of options.accountPayments.filter(
    (item) => item.shiftIndex === options.shiftIndex,
  )) {
    await applyAccountPayment(shift, task);
  }

  // --- Movimientos manuales aleatorios -----------------------------------
  if (chance(0.5)) {
    await createManualMovement(shift, {
      category: CashMovementCategory.WITHDRAWAL,
      type: CashMovementType.OUT,
      description: 'Retiro de efectivo para deposito bancario',
      amountBase: randAmount(40, 150),
      at: timeWithin(shift, 60, -60),
    });
  }
  if (chance(0.45)) {
    await createManualMovement(shift, {
      category: CashMovementCategory.DEPOSIT,
      type: CashMovementType.IN,
      description: 'Reposicion de fondo en efectivo',
      amountBase: randAmount(30, 120),
      at: timeWithin(shift, 60, -45),
      currency: pick([LOCAL_CURRENCY_CODE, LOCAL_CURRENCY_CODE, BASE_CURRENCY_CODE]),
    });
  }
  if (chance(0.2)) {
    await createManualMovement(shift, {
      category: CashMovementCategory.REFUND,
      type: CashMovementType.OUT,
      description: 'Devolucion a cliente (producto en mal estado)',
      amountBase: randAmount(3, 25),
      at: timeWithin(shift, 30, -30),
    });
  }
  if (chance(0.25)) {
    await createManualMovement(shift, {
      category: CashMovementCategory.ADJUSTMENT,
      type: chance(0.5) ? CashMovementType.IN : CashMovementType.OUT,
      description: 'Ajuste por redondeo de cambio',
      amountBase: randAmount(0.3, 3),
      at: timeWithin(shift, 30, -10),
    });
  }

  // --- Cierre con arqueo: todas las cajas menos la de hoy ----------------
  if (options.today) return;

  const expected = money.sub(money.add(fund.amount, shift.cashInBase), shift.cashOutBase);
  const countedCurrency = pick([
    BASE_CURRENCY_CODE,
    BASE_CURRENCY_CODE,
    BASE_CURRENCY_CODE,
    LOCAL_CURRENCY_CODE,
    'EUR',
  ]);
  const entered = fromBase(
    Math.max(1, money.add(expected, pickDifference())),
    countedCurrency,
    options.rates,
  );
  const conversion = toBase(entered, countedCurrency, options.rates);
  const difference = money.sub(conversion.baseAmount, expected);

  await prisma.cashSession.update({
    where: { id: session.id },
    data: {
      status: CashSessionStatus.CLOSED,
      closedById: operatorId,
      closedAt,
      countedAmount: conversion.baseAmount,
      countedCurrency: conversion.currency,
      countedRate: conversion.exchangeRate,
      expectedAmount: expected,
      difference,
      closingNotes:
        difference > 0
          ? 'Sobrante detectado en el conteo'
          : difference < 0
            ? 'Faltante detectado en el conteo'
            : 'Cierre sin diferencias',
    },
  });
}

/** Simula un dia completo del historial (turnos, gastos y movimientos). */
async function simulateDay(ctx: DemoContext, index: number): Promise<void> {
  const day = dayOf(index);
  const rates = RATES[index];
  const today = isToday(index);

  // La mercancia llega antes de abrir la caja.
  await restock(ctx, atTime(day, randInt(7, 8)));

  // Un turno unico o dos (manana/tarde) en los dias con mas movimiento.
  const doubleShift = !today && (index % 4 === 0 || chance(0.3));
  const shifts = doubleShift
    ? [
        { openHour: 8, closeHour: 15 },
        { openHour: 15, closeHour: 22 },
      ]
    : [{ openHour: 8, closeHour: 22 }];

  // Abonos de cuentas y gastos fijos que caen hoy: se reparten entre turnos.
  const accountPayments: AccountPaymentTask[] = [];
  let taskIndex = 0;
  for (const plan of [...ctx.payables, ...ctx.receivables]) {
    for (const payment of plan.payments) {
      if (HISTORY_DAYS - 1 - payment.daysAgo !== index) continue;
      accountPayments.push({ plan, payment, shiftIndex: taskIndex % shifts.length });
      taskIndex += 1;
    }
  }

  const expenses: ExpenseTask[] = FIXED_EXPENSES.filter(
    (item) => day.getDate() === item.dayOfMonth,
  ).map((item) => ({
    shiftIndex: 0,
    input: {
      category: item.category,
      description: item.description,
      amountBase: item.amount,
    },
  }));

  // Los codigos PED-YYYYMMDD-NNNN son unicos por dia: el contador se comparte
  // entre los turnos para que el segundo continue la numeracion.
  const orderSeq = { value: 0 };

  for (let shiftIndex = 0; shiftIndex < shifts.length; shiftIndex += 1) {
    await simulateShift(ctx, {
      index,
      day,
      rates,
      shiftIndex,
      sessionSeq: shiftIndex + 1,
      openHour: shifts[shiftIndex].openHour,
      closeHour: shifts[shiftIndex].closeHour,
      today,
      orderSeq,
      accountPayments,
      expenses,
    });
  }
}

/** Fecha corta (YYYY-MM-DD) para los mensajes de consola. */
function formatDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Genera el historial completo de operacion de los ultimos `HISTORY_DAYS` dias. */
async function seedDemoData(master: MasterData): Promise<void> {
  await wipeOperationalData();

  // Solo se simula el catalogo demo: si la base tiene productos creados a mano
  // (pruebas manuales), se dejan intactos para no alterarlos.
  const catalogSkus = new Set(PRODUCTS.map((product) => product.sku));
  const products = (
    await prisma.product.findMany({
      where: { companyId: COMPANY_ID },
      orderBy: { sku: 'asc' },
    })
  ).filter((product) => catalogSkus.has(product.sku));
  const stock = new Map<string, number>(products.map((product) => [product.id, product.stock]));
  const supplierNames = new Map(
    [...master.supplierIds.entries()].map(([name, id]) => [id, name]),
  );

  const ctx: DemoContext = {
    adminId: master.adminId,
    operators: master.operatorIds,
    supplierIds: master.supplierIds,
    supplierNames,
    customerIds: master.customerIds,
    customerNames: CUSTOMERS.map((customer) => customer.name).filter(
      (name) => name !== 'Consumidor final',
    ),
    products,
    sellable: products.filter((product) => product.price > 0),
    tracked: products.filter((product) => product.trackStock),
    stock,
    lastStockAt: dayOf(0).getTime(),
    payables: await createAccounts({
      kind: 'PAYABLE',
      defs: PAYABLES,
      adminId: master.adminId,
      supplierIds: master.supplierIds,
      customerIds: master.customerIds,
    }),
    receivables: await createAccounts({
      kind: 'RECEIVABLE',
      defs: RECEIVABLES,
      adminId: master.adminId,
      supplierIds: master.supplierIds,
      customerIds: master.customerIds,
    }),
  };
  console.log(
    `  Cuentas: ${ctx.payables.length} por pagar y ${ctx.receivables.length} por cobrar`,
  );

  // Carga inicial de inventario: el punto de partida de cada producto.
  // Se marca a primera hora del primer dia para que quede antes de cualquier
  // reposicion o venta del historial.
  const firstDay = dayOf(0);
  for (const product of products) {
    if (product.stock <= 0) continue;
    await prisma.stockMovement.create({
      data: {
        companyId: COMPANY_ID,
        productId: product.id,
        type: StockMovementType.IN,
        quantity: product.stock,
        stockBefore: 0,
        stockAfter: product.stock,
        inputUnit: boxUnitsOf(product) > 1 ? 'UND' : product.unit,
        inputQuantity: product.stock,
        // El stock se lleva en unidades sueltas: la carga se valora al costo
        // unitario (el de la caja repartido entre sus unidades).
        unitCost: product.unitCost || product.cost,
        unitCostCurrency: product.costCurrency,
        unitCostRate: product.costRate,
        unitCostEntered: product.unitCostEntered ?? product.costEntered,
        reason: 'Carga inicial de inventario',
        referenceType: StockReferenceType.INITIAL,
        createdById: master.adminId,
        createdAt: atTime(firstDay, 0, 30),
      },
    });
  }

  for (let index = 0; index < HISTORY_DAYS; index += 1) {
    await simulateDay(ctx, index);
  }

  await adjustLowStock(ctx);

  // El stock del producto es el resultado de todo el historial simulado.
  for (const product of products) {
    await prisma.product.update({
      where: { id: product.id },
      data: { stock: ctx.stock.get(product.id) ?? product.stock },
    });
  }

  console.log(
    `  Historial: ${HISTORY_DAYS} dias (${formatDay(dayOf(0))} a ${formatDay(dayOf(HISTORY_DAYS - 1))})`,
  );
}

/** Resumen de lo que quedo en la base de datos del seed. */
async function printSummary(): Promise<void> {
  const where = { companyId: COMPANY_ID };
  const [
    sessions,
    openSessions,
    movements,
    orders,
    payments,
    expenses,
    payables,
    receivables,
    stockMovements,
  ] = await Promise.all([
    prisma.cashSession.count({ where }),
    prisma.cashSession.count({ where: { ...where, status: CashSessionStatus.OPEN } }),
    prisma.cashMovement.count({ where }),
    prisma.order.count({ where }),
    prisma.orderPayment.count({ where }),
    prisma.expense.count({ where }),
    prisma.accountPayable.count({ where }),
    prisma.accountReceivable.count({ where }),
    prisma.stockMovement.count({ where }),
  ]);

  const tracked = await prisma.product.findMany({
    where: { trackStock: true, ...where },
    select: { stock: true, minStock: true },
  });
  const lowStock = tracked.filter((product) => product.stock <= product.minStock).length;

  console.log('Resumen de datos generados:');
  console.log(`  Caja: ${sessions} sesiones (${openSessions} abierta) y ${movements} movimientos`);
  console.log(`  Pedidos: ${orders} con ${payments} pagos registrados`);
  console.log(`  Gastos: ${expenses} | Cuentas: ${payables} por pagar, ${receivables} por cobrar`);
  console.log(
    `  Inventario: ${stockMovements} movimientos | ${lowStock} productos en stock critico`,
  );
}

async function main(): Promise<void> {
  console.log('Sembrando datos de Nexo Hub...');

  const { primaryId, secondaryId } = await seedCompanies();
  const { adminId, operatorIds } = await seedUsers(primaryId, secondaryId);

  // Empresa principal: configuracion, catalogo e historial completo.
  await withCompany(primaryId, () => seedSettings(adminId));
  const catalog = await withCompany(primaryId, () => seedCatalog());
  await withCompany(primaryId, () => seedMenus());
  await withCompany(primaryId, () =>
    seedDemoData({
      adminId,
      operatorIds,
      supplierIds: catalog.supplierIds,
      customerIds: catalog.customerIds,
      categoryIds: catalog.categoryIds,
    }),
  );

  // Segunda empresa: queda configurada y con catalogo (sin historial) para poder
  // probar el cambio de empresa activa desde el panel.
  await withCompany(secondaryId, () => seedSettings(adminId));
  await withCompany(secondaryId, () => seedCatalog());
  await withCompany(secondaryId, () => seedMenus());

  COMPANY_ID = primaryId;
  await printSummary();
  console.log('Listo. Accede con admin@nexohub.com / Admin123!');
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Error al sembrar la base de datos:', message);
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
