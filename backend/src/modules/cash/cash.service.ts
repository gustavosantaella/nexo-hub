import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CASH_OUT_CATEGORIES,
  CashMovementCategory,
  CashMovementType,
  CashSessionStatus,
  PAYMENT_PROOF_METHODS,
  PaymentMethod,
} from '../../common/constants/enums';
import {
  BASE_CURRENCY_CODE,
  MIXED_CURRENCY_CODE,
  normalizeCurrencyCode,
} from '../../common/constants/currencies';
import { ImageStorageService } from '../../common/media/image-storage.service';
import { buildPaginatedResult } from '../../common/utils/pagination.util';
import { buildCode } from '../../common/utils/code.util';
import {
  compareMoney,
  fromCents,
  money,
  moneyFieldsFromCents,
  moneyFieldsToCents,
  toCents,
  toMoney,
} from '../../common/utils/money.util';
import { OPENING_LINE_MONEY_FIELDS } from '../../common/constants/money-columns';
import type { PrismaClientLike } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RatesService } from '../rates/rates.service';
import { CashRepository, type CashSessionWithRelations } from './cash.repository';
import { CashMovementQueryDto, CashSessionQueryDto } from './dto/cash-query.dto';
import { CloseSessionDto } from './dto/close-session.dto';
import { CreateCashMovementDto } from './dto/create-cash-movement.dto';
import { OpenSessionDto } from './dto/open-session.dto';

/** Datos minimos de un movimiento para calcular el arqueo. */
export interface MovementLike {
  /** Identificador del movimiento (permite cruzar la propina con su cobro). */
  id?: string;
  type: string;
  category: string;
  paymentMethod: string;
  /** Monto en la moneda del movimiento. */
  amount: number;
  /** Moneda en que entro/salio el dinero (por defecto USD). */
  currency?: string | null;
  /** Equivalente en USD (moneda base); 0 en registros anteriores. */
  baseAmount?: number | null;
  /**
   * Tasa exacta con la que se valoro el movimiento: unidades de `currency` por
   * 1 USD. El arqueo la usa para sumar sin perder decimales; `null` solo en
   * registros anteriores a este campo.
   */
  baseRate?: number | null;
  /**
   * Propina incluida en el movimiento, en la moneda base. El movimiento guarda
   * el cobro completo (consumo + propina), asi que este monto lo calcula
   * `withTips` a partir del pedido cobrado.
   */
  tipAmount?: number | null;
  /** Origen del movimiento (`ORDER` cuando es el cobro de un pedido). */
  referenceType?: string | null;
  referenceId?: string | null;
}

/** Totales de un metodo de pago dentro de una moneda. */
export interface CurrencyMethodTotal {
  method: string;
  /** Montos en la moneda de la fila. */
  in: number;
  out: number;
  net: number;
  /** Los mismos montos expresados en USD (moneda base). */
  baseIn: number;
  baseOut: number;
  baseNet: number;
}

/**
 * Totales de un movimiento, en la moneda original y en la moneda base.
 *
 * Ademas del total general, cada moneda guarda los agregados que pinta el
 * arqueo (efectivo, ventas, propinas y vueltos). Con ellos la pantalla suma en
 * la moneda en que se cobro: el equivalente en USD se guarda redondeado a
 * centavos, asi que reconvertirlo pintaba Bs 15.520,00 como Bs 15.521,27.
 */
export interface CurrencyBreakdown {
  currency: string;
  in: number;
  out: number;
  net: number;
  /** Los mismos totales expresados en USD (moneda base). */
  baseIn: number;
  baseOut: number;
  baseNet: number;
  /** Efectivo (metodo CASH) que entro y salio en esta moneda. */
  cashIn: number;
  cashOut: number;
  baseCashIn: number;
  baseCashOut: number;
  /** Ventas brutas (categoria SALE) cobradas en esta moneda, con propina. */
  sales: number;
  /** Propina incluida en esos cobros, en esta moneda. */
  tips: number;
  /** Vueltos entregados (categoria CHANGE) en esta moneda. */
  change: number;
  baseSales: number;
  baseTips: number;
  baseChange: number;
  /** Desglose de esta moneda por metodo de pago. */
  methods: CurrencyMethodTotal[];
}

/** Una parte del fondo inicial: monto contado en su moneda + equivalente en USD. */
export interface OpeningLine {
  currency: string;
  /** Monto que se conto fisicamente en `currency`. */
  amount: number;
  /** Bolivares por 1 unidad de `currency` (tasa usada al abrir). */
  rate: number | null;
  /**
   * Unidades de `currency` por 1 USD (`amount / baseRate` = USD exactos).
   * `null` en aperturas anteriores a este campo; ahi se usa `baseAmount`.
   */
  baseRate?: number | null;
  /** Equivalente en USD (moneda base) de `amount`. */
  baseAmount: number;
}

/** Linea del fondo tal como llega en la peticion de apertura. */
interface OpeningLineInput {
  currency?: string;
  amount?: number;
}

/** Fondo inicial resuelto a partir de la apertura (una o varias monedas). */
interface OpeningFund {
  /** Total del fondo en USD (moneda base). */
  amount: number;
  /** Moneda contada, o `MIX` cuando fueron varias. */
  currency: string;
  /** Tasa de la moneda contada (`null` si fueron varias o no hubo conversion). */
  rate: number | null;
  /** Desglose por moneda (vacio en aperturas antiguas de una sola moneda). */
  lines: OpeningLine[];
}

/**
 * Entrada del desglose por moneda mientras se recorre el turno: los totales
 * por metodo se acumulan en un mapa y se pasan a lista al terminar.
 */
type CurrencyEntry = Omit<CurrencyBreakdown, 'methods'> & {
  methods: Map<string, { in: number; out: number; baseIn: number; baseOut: number }>;
};

/** Entrada vacia del desglose por moneda. */
function emptyCurrencyEntry(currency: string): CurrencyEntry {
  return {
    currency,
    in: 0,
    out: 0,
    net: 0,
    baseIn: 0,
    baseOut: 0,
    baseNet: 0,
    cashIn: 0,
    cashOut: 0,
    baseCashIn: 0,
    baseCashOut: 0,
    sales: 0,
    tips: 0,
    change: 0,
    baseSales: 0,
    baseTips: 0,
    baseChange: 0,
    methods: new Map(),
  };
}

/**
 * Recorta centavos a un entero SIN redondear (hacia cero).
 *
 * El arqueo suma los equivalentes en centavos con toda su precision y recorta
 * una sola vez al final: redondear movimiento por movimiento producia un centavo
 * de mas en el esperado frente a lo que pinta la pantalla. La tolerancia
 * relativa evita que el ruido del punto flotante pierda un centavo
 * (`658.9999999998` -> 659).
 */
function truncCents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const truncated = Math.trunc(value + Math.abs(value) * 1e-9);
  return truncated === 0 ? 0 : truncated;
}

/**
 * Arqueo de caja.
 *
 * Todos los totales agregados (`cashIn`, `totalOut`, `expectedCash`, ...) se
 * expresan en USD (moneda base del sistema) para que montos cobrados en
 * distintas monedas sean comparables y sumables. El desglose `byCurrency`
 * conserva los montos originales de cada moneda.
 */
export interface CashBreakdown {
  /** Efectivo que entro a la caja (solo metodo CASH). */
  cashIn: number;
  /** Efectivo que salio de la caja (solo metodo CASH). */
  cashOut: number;
  /**
   * Fondo inicial en USD valorizado con su tasa exacta y recortado a centavos
   * (no el total ya redondeado de la apertura). Es la parte del esperado que el
   * cajero puede contar en el cajon.
   */
  openingCash: number;
  /** Efectivo que deberia haber en la caja: apertura + cashIn - cashOut. */
  expectedCash: number;
  /** Totales por todos los metodos. */
  totalIn: number;
  totalOut: number;
  net: number;
  /** Ventas cobradas (categoria SALE) en moneda base, SIN propinas. */
  salesTotal: number;
  /** Propinas cobradas en el turno (ya vienen dentro de los cobros por venta). */
  tipsTotal: number;
  movementCount: number;
  byMethod: { method: string; in: number; out: number; net: number }[];
  byCategory: { category: string; in: number; out: number; net: number }[];
  /** Desglose por moneda (montos originales + equivalente en USD). */
  byCurrency: CurrencyBreakdown[];
  /** Como se conto el fondo inicial, moneda por moneda (vacio si es antiguo). */
  openingByCurrency: OpeningLine[];
  /** `true` cuando el fondo inicial se conto en mas de una moneda. */
  openingMixed: boolean;
}

export interface RegisterMovementInput {
  sessionId?: string;
  type?: CashMovementType;
  category: CashMovementCategory;
  paymentMethod?: PaymentMethod;
  amount: number;
  /** Moneda del dinero que entra o sale (por defecto USD). */
  currency?: string;
  /**
   * Equivalente en USD ya calculado por el llamador (para que el arqueo
   * coincida exactamente con el documento de origen, ej. un cobro ajustado
   * al saldo del pedido).
   */
  baseAmount?: number | null;
  description?: string;
  referenceType?: string;
  referenceId?: string;
  /** Referencia bancaria del comprobante (transferencia / pago movil). */
  paymentReference?: string | null;
  /** Foto del comprobante: URL local `/media/...` subida por multipart. */
  paymentPhotoUrl?: string | null;
  createdById?: string;
}

@Injectable()
export class CashService {
  constructor(
    private readonly cash: CashRepository,
    private readonly config: ConfigService,
    private readonly rates: RatesService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly images?: ImageStorageService,
  ) {}

  // =========================================================================
  //  APRQUEO / CALCULOS
  // =========================================================================

  /** Moneda del movimiento (registros antiguos sin moneda = USD). */
  private currencyOf(row: MovementLike): string {
    return normalizeCurrencyCode(row.currency) || BASE_CURRENCY_CODE;
  }

  /**
   * Equivalente en USD (moneda base) de un movimiento, con toda su precision y
   * expresado en centavos.
   *
   * Con `baseRate` (unidades de la moneda por 1 USD) se recalcula desde el monto
   * original, sin perder los decimales que el redondeo de `baseAmount` descarta:
   * Bs 15.520,00 al BCV son 17,5685 USD, no 17,57. Sin tasa (registros
   * anteriores o montos ajustados al saldo) vale el `baseAmount` guardado, que
   * es el valor contable del movimiento.
   */
  private baseCentsOf(row: MovementLike): number {
    const amountCents = toCents(row.amount);
    const rate = Number(row.baseRate ?? 0);
    if (Number.isFinite(rate) && rate > 0) return amountCents / rate;
    const base = toCents(row.baseAmount ?? 0);
    return base > 0 ? base : amountCents;
  }

  /**
   * Equivalente en USD (moneda base) de un movimiento.
   * Los registros anteriores al soporte multimoneda no tienen `baseAmount` ni
   * `baseRate`, por lo que su `amount` ya estaba expresado en dolares.
   */
  private baseOf(row: MovementLike): number {
    return fromCents(this.baseCentsOf(row));
  }

  // =========================================================================
  //  FONDO INICIAL (UNA O VARIAS MONEDAS)
  // =========================================================================

  /**
   * Lee el desglose del fondo guardado en la sesion (JSON en `openingLines`).
   * Los montos del JSON viven en centavos, igual que el resto del dinero, y se
   * devuelven en decimales. Tolera valores vacios o corruptos (devuelve `[]`,
   * nunca lanza).
   */
  private openingLinesOf(value: unknown): OpeningLine[] {
    if (value === null || value === undefined) return [];
    let parsed: unknown = value;
    if (typeof value === 'string') {
      const raw = value.trim();
      if (!raw) return [];
      try {
        parsed = JSON.parse(raw);
      } catch {
        return [];
      }
    }
    if (!Array.isArray(parsed)) return [];

    const rows = moneyFieldsFromCents(
      parsed as Record<string, unknown>[],
      OPENING_LINE_MONEY_FIELDS,
    );

    const lines: OpeningLine[] = [];
    for (const item of rows) {
      if (!item || typeof item !== 'object') continue;
      const currency = normalizeCurrencyCode(item.currency);
      if (!currency) continue;
      const amount = toMoney(item.amount);
      const rate = Number(item.rate);
      const baseRate = Number(item.baseRate);
      lines.push({
        currency,
        amount,
        rate: Number.isFinite(rate) && rate > 0 ? rate : null,
        baseRate: Number.isFinite(baseRate) && baseRate > 0 ? baseRate : null,
        baseAmount: toMoney(item.baseAmount ?? amount),
      });
    }
    return lines;
  }

  /**
   * Centavos exactos del fondo inicial.
   *
   * Se valoriza linea por linea con la tasa a la que se conto el fondo
   * (`amount / baseRate`) en vez de usar `openingAmount`, que ya viene redondeado
   * a centavos: un fondo de Bs 100.000,00 al BCV son 113,1976 USD y el arqueo
   * tiene que compararlo contra el conteo del cierre con esa misma precision,
   * no con 113,20. Las aperturas antiguas (sin `baseRate`) usan su equivalente
   * guardado y, si no hay desglose, el total de la sesion.
   */
  private openingCentsOf(openingAmount: number, lines: OpeningLine[]): number {
    if (lines.length === 0) return toCents(openingAmount);
    let cents = 0;
    for (const line of lines) {
      const amountCents = toCents(line.amount);
      const rate = Number(line.baseRate ?? 0);
      cents +=
        Number.isFinite(rate) && rate > 0
          ? amountCents / rate
          : toCents(line.baseAmount);
    }
    return cents;
  }

  /** Serializa el desglose del fondo con los montos en centavos. */
  private encodeOpeningLines(lines: OpeningLine[]): string {
    return JSON.stringify(moneyFieldsToCents(lines, OPENING_LINE_MONEY_FIELDS));
  }

  /**
   * Une las lineas del fondo repetidas (misma moneda) y descarta las de monto 0.
   * Asi el cajero puede dejar lineas en blanco sin romper la apertura.
   */
  private mergeOpeningLines(
    input?: OpeningLineInput[],
  ): { currency: string; amount: number }[] {
    const merged = new Map<string, number>();
    for (const line of input ?? []) {
      const currency = normalizeCurrencyCode(line?.currency);
      if (!currency) {
        throw new BadRequestException('Cada linea del fondo debe indicar su moneda');
      }
      const amount = toMoney(line?.amount);
      if (amount < 0) {
        throw new BadRequestException(
          `El monto del fondo en ${currency} no puede ser negativo`,
        );
      }
      merged.set(currency, money.add(merged.get(currency) ?? 0, amount));
    }

    return [...merged.entries()]
      .filter(([, amount]) => amount > 0)
      .map(([currency, amount]) => ({ currency, amount }));
  }

  /**
   * Resuelve el fondo inicial de la apertura.
   *
   * El dinero del cajon suele estar en varias monedas a la vez, por lo que el
   * fondo se puede enviar como `openingLines` (moneda + monto por linea): cada
   * linea se convierte a USD (moneda base) y los equivalentes se suman en
   * `openingAmount`, que es el total que usa el arqueo. Cuando se envia una sola
   * moneda (`openingAmount` + `openingCurrency`) el comportamiento es el de
   * siempre y el desglose queda con una unica linea.
   */
  private async resolveOpeningFund(
    companyId: string,
    dto: OpenSessionDto,
  ): Promise<OpeningFund> {
    const merged = this.mergeOpeningLines(dto.openingLines);
    const currency =
      normalizeCurrencyCode(dto.openingCurrency) || BASE_CURRENCY_CODE;

    if (merged.length === 0) {
      // Sin lineas con monto solo queda el fondo de una moneda (o fondo 0, que
      // es valido: una caja puede abrir sin efectivo).
      const lines = dto.openingLines ?? [];
      if (
        lines.length === 0 &&
        (dto.openingAmount === null || dto.openingAmount === undefined)
      ) {
        throw new BadRequestException(
          'Indica el fondo inicial (una moneda con monto o varias lineas de moneda + monto)',
        );
      }

      const amount = toMoney(dto.openingAmount);
      if (amount <= 0) {
        // Caja sin fondo: se respeta la moneda indicada, sin tasa que aplicar.
        return { amount: 0, currency, rate: null, lines: [] };
      }

      const conversion = await this.rates.resolvePayment(
        companyId,
        amount,
        currency,
      );
      return {
        amount: conversion.baseAmount,
        currency,
        rate: conversion.exchangeRate,
        lines: [
          {
            currency,
            amount,
            rate: conversion.exchangeRate,
            baseRate: conversion.unitsPerBase,
            baseAmount: conversion.baseAmount,
          },
        ],
      };
    }

    const lines: OpeningLine[] = [];
    for (const line of merged) {
      const conversion = await this.rates.resolvePayment(
        companyId,
        line.amount,
        line.currency,
      );
      lines.push({
        currency: conversion.currency,
        amount: line.amount,
        rate: conversion.exchangeRate,
        baseRate: conversion.unitsPerBase,
        baseAmount: conversion.baseAmount,
      });
    }

    return {
      amount: money.sum(lines.map((line) => line.baseAmount)),
      // Una sola linea => se conserva la moneda tal cual; varias => fondo mixto.
      currency: lines.length === 1 ? lines[0].currency : MIXED_CURRENCY_CODE,
      rate: lines.length === 1 ? lines[0].rate : null,
      lines,
    };
  }

  /** Construye el resumen de arqueo a partir de la apertura y los movimientos. */
  buildBreakdown(
    openingAmount: number,
    movements: MovementLike[],
    /** Desglose del fondo guardado en la sesion (`CashSession.openingLines`). */
    openingLines?: unknown,
  ): CashBreakdown {
    const fundLines = this.openingLinesOf(openingLines);
    const openingCents = this.openingCentsOf(openingAmount, fundLines);
    // Los agregados en moneda base se acumulan en CENTAVOS SIN REDONDEAR: cada
    // movimiento aporta su equivalente exacto y se recorta una sola vez al
    // final, igual que la pantalla. Redondear movimiento por movimiento dejaba
    // el esperado un centavo por encima de lo que se ve en el arqueo.
    let cashIn = 0;
    let cashOut = 0;
    let totalIn = 0;
    let totalOut = 0;
    // Ventas y propinas se acumulan por separado: el movimiento guarda el cobro
    // completo, asi que las ventas quedan netas de propina.
    let salesTotal = 0;
    let tipsTotal = 0;
    // Vueltos del turno: salen de la caja y no son ventas. Se descuentan del
    // total de ventas para que `salesTotal` siga siendo lo NETO cobrado.
    let changeTotal = 0;

    const methods = new Map<string, { in: number; out: number }>();
    const categories = new Map<string, { in: number; out: number }>();
    const currencies = new Map<string, CurrencyEntry>();

    for (const m of movements) {
      const currency = this.currencyOf(m);
      // `amount`: moneda original · `base`: equivalente en USD exacto (centavos).
      const amount = toMoney(m.amount);
      const base = this.baseCentsOf(m);
      const isIn = m.type === CashMovementType.IN;
      const isCash = m.paymentMethod === PaymentMethod.CASH;
      const side = isIn ? 'in' : 'out';

      if (isIn) {
        totalIn += base;
        if (isCash) cashIn += base;
      } else {
        totalOut += base;
        if (isCash) cashOut += base;
      }

      if (isIn && m.category === CashMovementCategory.SALE) {
        salesTotal += base;
        // La propina entra dentro del cobro: se separa de la venta.
        tipsTotal += toCents(this.tipOf(m));
      }
      if (!isIn && m.category === CashMovementCategory.CHANGE) {
        changeTotal += base;
      }

      const methodEntry = methods.get(m.paymentMethod) ?? { in: 0, out: 0 };
      methodEntry[side] += base;
      methods.set(m.paymentMethod, methodEntry);

      const catEntry = categories.get(m.category) ?? { in: 0, out: 0 };
      catEntry[side] += base;
      categories.set(m.category, catEntry);

      // Propina que lleva dentro el cobro, en la moneda del movimiento. La
      // propina se guarda en USD (moneda base): aqui se reparte en la moneda en
      // que se cobro para poder sumarla sin reconvertir.
      const tipBase =
        isIn && m.category === CashMovementCategory.SALE ? this.tipOf(m) : 0;
      const tip =
        tipBase > 0 && base > 0
          ? money.div(money.mul(tipBase, amount), fromCents(base))
          : 0;

      const entry = currencies.get(currency) ?? emptyCurrencyEntry(currency);
      entry[side] = money.add(entry[side], amount);
      entry[side === 'in' ? 'baseIn' : 'baseOut'] += base;
      if (isCash) {
        entry[side === 'in' ? 'cashIn' : 'cashOut'] = money.add(
          entry[side === 'in' ? 'cashIn' : 'cashOut'],
          amount,
        );
        entry[side === 'in' ? 'baseCashIn' : 'baseCashOut'] += base;
      }
      if (isIn && m.category === CashMovementCategory.SALE) {
        entry.sales = money.add(entry.sales, amount);
        entry.tips = money.add(entry.tips, tip);
        entry.baseSales += base;
        entry.baseTips += toCents(tipBase);
      }
      if (!isIn && m.category === CashMovementCategory.CHANGE) {
        entry.change = money.add(entry.change, amount);
        entry.baseChange += base;
      }
      const currencyMethod = entry.methods.get(m.paymentMethod) ?? {
        in: 0,
        out: 0,
        baseIn: 0,
        baseOut: 0,
      };
      currencyMethod[side] = money.add(currencyMethod[side], amount);
      currencyMethod[side === 'in' ? 'baseIn' : 'baseOut'] += base;
      entry.methods.set(m.paymentMethod, currencyMethod);
      entry.net = money.sub(entry.in, entry.out);
      currencies.set(currency, entry);
    }

    /** Centavos acumulados -> monto, recortando una sola vez. */
    const truncate = (cents: number): number => fromCents(truncCents(cents));

    return {
      cashIn: truncate(cashIn),
      cashOut: truncate(cashOut),
      openingCash: truncate(openingCents),
      expectedCash: truncate(openingCents + cashIn - cashOut),
      totalIn: truncate(totalIn),
      totalOut: truncate(totalOut),
      net: truncate(totalIn - totalOut),
      // Ventas netas: se descuentan la propina (que viene dentro del cobro) y los
      // vueltos entregados. `cashIn`/`totalIn` conservan el bruto para que el
      // arqueo cuadre con el dinero que fisicamente paso por el cajon.
      salesTotal: truncate(salesTotal - tipsTotal - changeTotal),
      tipsTotal: truncate(tipsTotal),
      movementCount: movements.length,
      byMethod: [...methods.entries()].map(([method, v]) => ({
        method,
        in: truncate(v.in),
        out: truncate(v.out),
        net: truncate(v.in - v.out),
      })),
      byCategory: [...categories.entries()].map(([category, v]) => ({
        category,
        in: truncate(v.in),
        out: truncate(v.out),
        net: truncate(v.in - v.out),
      })),
      byCurrency: [...currencies.values()].map(({ methods: byMethod, ...entry }) => {
        const baseIn = truncate(entry.baseIn);
        const baseOut = truncate(entry.baseOut);
        return {
          ...entry,
          baseIn,
          baseOut,
          baseNet: money.sub(baseIn, baseOut),
          baseCashIn: truncate(entry.baseCashIn),
          baseCashOut: truncate(entry.baseCashOut),
          baseSales: truncate(entry.baseSales),
          baseTips: truncate(entry.baseTips),
          baseChange: truncate(entry.baseChange),
          methods: [...byMethod.entries()].map(([method, v]) => {
            const methodBaseIn = truncate(v.baseIn);
            const methodBaseOut = truncate(v.baseOut);
            return {
              method,
              in: v.in,
              out: v.out,
              net: money.sub(v.in, v.out),
              baseIn: methodBaseIn,
              baseOut: methodBaseOut,
              baseNet: money.sub(methodBaseIn, methodBaseOut),
            };
          }),
        };
      }),
      openingByCurrency: fundLines,
      openingMixed: fundLines.length > 1,
    };
  }

  // =========================================================================
  //  PROPINAS
  // =========================================================================

  /**
   * Propina incluida en un movimiento de venta, en la moneda base.
   * Es 0 en los movimientos propios (manuales) y en los cobros anteriores al
   * reparto de propinas. Nunca puede superar el monto cobrado.
   */
  private tipOf(row: MovementLike): number {
    const tip = toMoney(row.tipAmount ?? 0);
    if (tip <= 0) return 0;
    // El tope se recorta: la propina nunca puede sobre-cobrar el movimiento.
    const base = fromCents(truncCents(this.baseCentsOf(row)));
    return compareMoney(tip, base) > 0 ? base : tip;
  }

  /**
   * Reparte la propina de un pedido entre sus cobros (en moneda base).
   *
   * El movimiento de caja guarda el cobro completo (consumo + propina) y la
   * propina vive en el pedido (`Order.tip`), por lo que hay que deducirla: se
   * considera que el cliente paga primero el consumo (`total - propina`) y que
   * la propina entra con el dinero que completa ese consumo. Asi un abono
   * parcial no adelanta propina y un pedido pagado completo reparte exactamente
   * su propina (la suma de las partes siempre da la propina del pedido).
   *
   * @param total Suma del pedido (consumo + propina) en moneda base.
   * @param tip Propina del pedido en moneda base.
   * @param payments Cobros del pedido en orden cronologico.
   * @returns Propina que le corresponde a cada cobro, por id de cobro.
   */
  tipPortionsOfOrder(
    total: number,
    tip: number,
    payments: readonly {
      id: string;
      amount?: number | null;
      baseAmount?: number | null;
    }[],
  ): Map<string, number> {
    const portions = new Map<string, number>();
    const tipTotal = toMoney(tip);
    const nonTipTotal = money.sub(toMoney(total), tipTotal);
    let paid = 0;

    for (const payment of payments) {
      // Equivalente en USD del cobro (registros antiguos sin `baseAmount`).
      const base = toMoney(payment.baseAmount ?? 0);
      const amount = base > 0 ? base : toMoney(payment.amount);
      // Consumo que aun quedaba por pagar antes de este cobro.
      const nonTipPending = money.sub(nonTipTotal, Math.min(paid, nonTipTotal));
      portions.set(
        payment.id,
        compareMoney(amount, nonTipPending) > 0
          ? money.sub(amount, nonTipPending)
          : 0,
      );
      paid = money.add(paid, amount);
    }

    return portions;
  }

  /**
   * Añade a cada cobro por venta la propina que lleva dentro (moneda base).
   *
   * Solo consulta los pedidos con propina referenciados por los movimientos
   * recibidos; los movimientos que no son cobros de pedido se devuelven tal
   * cual. Lo usan el arqueo (`serializeSession`) y el panel para que las ventas
   * que muestra el sistema queden siempre netas de propina.
   */
  async withTips(
    companyId: string,
    movements: readonly MovementLike[],
  ): Promise<MovementLike[]> {
    const orderIds = [
      ...new Set(
        movements
          .filter(
            (m) =>
              m.category === CashMovementCategory.SALE &&
              m.referenceType === 'ORDER' &&
              !!m.referenceId,
          )
          .map((m) => m.referenceId as string),
      ),
    ];
    if (orderIds.length === 0) return [...movements];

    const orders = await this.cash.findOrdersWithTips(companyId, orderIds);

    const tipsByMovement = new Map<string, number>();
    for (const order of orders) {
      const portions = this.tipPortionsOfOrder(
        order.total,
        order.tip,
        order.payments,
      );
      for (const payment of order.payments) {
        if (!payment.cashMovementId) continue;
        tipsByMovement.set(payment.cashMovementId, portions.get(payment.id) ?? 0);
      }
    }

    return movements.map((movement) => ({
      ...movement,
      tipAmount: movement.id ? (tipsByMovement.get(movement.id) ?? 0) : 0,
    }));
  }

  /** Etiqueta legible del resultado del arqueo. */
  private differenceLabel(difference: number | null | undefined): string {
    if (difference == null) return 'PENDING';
    const cmp = compareMoney(difference, 0);
    if (cmp > 0) return 'SURPLUS'; // sobrante
    if (cmp < 0) return 'SHORTAGE'; // faltante
    return 'BALANCED';
  }

  /**
   * Anexa el resumen de arqueo a una sesion.
   * Antes de sumar se reparte la propina de cada cobro (`withTips`) para que
   * `salesTotal` quede neto de propinas y `tipsTotal` traiga lo recaudado.
   */
  private async serializeSession(session: CashSessionWithRelations) {
    // El desglose del fondo viaja siempre parseado (y como lista vacia cuando la
    // apertura fue de una sola moneda antes del soporte multimoneda).
    const openingLines = this.openingLinesOf(session.openingLines);
    const movements = await this.withTips(session.companyId, session.movements);
    const summary = this.buildBreakdown(
      session.openingAmount,
      movements,
      session.openingLines,
    );
    const reconciliation =
      session.status === CashSessionStatus.CLOSED
        ? {
            expectedAmount: toMoney(session.expectedAmount ?? summary.expectedCash),
            countedAmount: toMoney(session.countedAmount ?? 0),
            difference: toMoney(session.difference ?? 0),
            result: this.differenceLabel(session.difference),
            /** Moneda en la que se conto el efectivo al cerrar. */
            countedCurrency: session.countedCurrency ?? BASE_CURRENCY_CODE,
            countedRate: session.countedRate ?? null,
          }
        : null;

    return {
      ...session,
      /** Todos los montos del arqueo estan en esta moneda (USD). */
      baseCurrency: BASE_CURRENCY_CODE,
      /** Desglose del fondo (moneda + monto contado + equivalente en USD). */
      openingLines,
      /** `true` cuando el fondo se conto en varias monedas a la vez. */
      openingMixed: openingLines.length > 1,
      summary,
      reconciliation,
    };
  }

  // =========================================================================
  //  CONSULTAS
  // =========================================================================

  /** Devuelve la sesion de caja abierta actualmente (o null). */
  async getCurrentSession(companyId: string) {
    const session = await this.cash.findCurrentSession(companyId);

    if (!session) return { session: null, summary: null, reconciliation: null };
    return this.serializeSession(session);
  }

  async getSessionById(companyId: string, id: string) {
    const session = await this.cash.findSessionById(companyId, id);
    if (!session) throw new NotFoundException('Sesion de caja no encontrada');
    return this.serializeSession(session);
  }

  async listSessions(companyId: string, query: CashSessionQueryDto) {
    const { items, total } = await this.cash.findSessionPage(companyId, query);

    // El desglose del fondo se guarda como JSON en texto: se devuelve siempre
    // parseado (lista) para que los listados no tengan que saber del formato.
    const rows = items.map((row) => {
      const openingLines = this.openingLinesOf(row.openingLines);
      return {
        ...row,
        openingLines,
        openingMixed: openingLines.length > 1,
      };
    });

    return buildPaginatedResult(rows, total, query.page, query.limit);
  }

  async listMovements(companyId: string, query: CashMovementQueryDto) {
    const { items, total } = await this.cash.findMovementPage(companyId, query);

    return buildPaginatedResult(items, total, query.page, query.limit);
  }


  // =========================================================================
  //  APERTURA Y CIERRE
  // =========================================================================

  /**
   * Abre una nueva sesion de caja.
   * Regla: no puede existir otra sesion OPEN (global o por usuario segun config).
   * Se ejecuta dentro de una transaccion para evitar dobles aperturas.
   *
   * El fondo inicial puede venir en una moneda (`openingAmount` +
   * `openingCurrency`) o en varias a la vez (`openingLines`: USD, VES, EUR...).
   * En ambos casos se guarda el total en USD (moneda base) y el desglose de
   * monedas para poder compararlo contra el arqueo.
   */
  async openSession(companyId: string, dto: OpenSessionDto, userId: string) {
    const fund = await this.resolveOpeningFund(companyId, dto);

    const single = this.config.get<boolean>('cash.singleOpenSession') ?? true;

    const session = await this.cash.transaction(async (tx) => {
      const existing = await this.cash.findOpenSession(
        companyId,
        single ? {} : { openedById: userId },
        tx,
      );

      if (existing) {
        throw new ConflictException(
          `Ya existe una caja abierta (${existing.code}). Debes cerrarla antes de abrir otra.`,
        );
      }

      const todayCount = await this.cash.countToday(companyId, tx);

      return this.cash.createSession(
        {
          companyId,
          code: buildCode('CJ', todayCount + 1),
          status: CashSessionStatus.OPEN,
          openedById: userId,
          openingAmount: fund.amount,
          openingCurrency: fund.currency,
          openingRate: fund.rate,
          // El desglose se guarda como JSON en texto (SQLite no tiene tipo Json
          // nativo), con los montos en centavos.
          ...(fund.lines.length > 0
            ? { openingLines: this.encodeOpeningLines(fund.lines) }
            : {}),
          openingNotes: dto.openingNotes,
        },
        tx,
      );
    });

    return this.serializeSession(session);
  }

  /**
   * Cierra la sesion abierta con arqueo.
   * expected = apertura + ingresos(CASH) - egresos(CASH)
   * difference = contado - expected  (sobrante > 0, faltante < 0)
   */
  async closeSession(companyId: string, dto: CloseSessionDto, userId: string) {
    const entered = toMoney(dto.countedAmount);
    const currency = normalizeCurrencyCode(dto.countedCurrency);

    // El conteo fisico se ingresa en la moneda que el cajero tenga a mano y se
    // guarda en USD (moneda base) para compararlo contra el arqueo esperado.
    let countedAmount = entered;
    let countedRate: number | null = null;
    let countedCurrency: string | null = null;
    if (entered > 0) {
      const conversion = await this.rates.resolvePayment(
        companyId,
        entered,
        currency || BASE_CURRENCY_CODE,
      );
      // El conteo se lleva a USD como el arqueo: se valoriza con la tasa y se
      // recorta (nunca hacia arriba). Redondear el conteo dejaba el cierre con
      // un centavo de sobrante cuando el cajero contaba exactamente lo esperado.
      const unitsPerBase = Number(conversion.unitsPerBase ?? 0);
      countedAmount =
        Number.isFinite(unitsPerBase) && unitsPerBase > 0
          ? fromCents(truncCents(toCents(entered) / unitsPerBase))
          : conversion.baseAmount;
      countedRate = conversion.exchangeRate;
      countedCurrency = conversion.currency;
    }

    const closed = await this.cash.transaction(async (tx) => {
      const session = await this.cash.findOpenSessionWithMovements(companyId, tx);

      if (!session) {
        throw new BadRequestException('No hay ninguna caja abierta para cerrar');
      }

      // La propina no cambia el efectivo: el arqueo solo necesita el total.
      const breakdown = this.buildBreakdown(
        session.openingAmount,
        session.movements,
      );
      const expectedAmount = breakdown.expectedCash;
      const difference = money.sub(countedAmount, expectedAmount);

      // updateMany con filtro de estado => cierre atomico (evita doble cierre).
      const guard = await this.cash.closeSession(
        companyId,
        session.id,
        {
          status: CashSessionStatus.CLOSED,
          closedById: userId,
          closedAt: new Date(),
          countedAmount,
          countedCurrency,
          countedRate,
          expectedAmount,
          difference,
          closingNotes: dto.closingNotes,
        },
        tx,
      );

      if (guard.count === 0) {
        throw new ConflictException(
          'La caja ya fue cerrada por otro usuario. Recarga la informacion.',
        );
      }

      return this.cash.findSessionOrThrow(companyId, session.id, tx);
    });

    // Fuera de la transaccion: el reparto de propinas solo lee del pedido.
    const result = await this.serializeSession(closed);
    const summary = result.summary;
    const reconciliation = result.reconciliation;
    void this.notifications?.notifyCashClose(companyId, {
      code: closed.code,
      openedAt: closed.openedAt?.toISOString() ?? null,
      closedAt: closed.closedAt?.toISOString() ?? null,
      salesTotal: summary.salesTotal,
      totalIn: summary.totalIn,
      expectedCash: reconciliation?.expectedAmount ?? summary.expectedCash,
      countedAmount: reconciliation?.countedAmount ?? 0,
      difference: reconciliation?.difference ?? 0,
      result: reconciliation?.result ?? 'BALANCED',
      movementCount: summary.movementCount,
    });
    return result;
  }


  // =========================================================================
  //  MOVIMIENTOS
  // =========================================================================

  /** Deduce IN/OUT a partir de la categoria (ADJUSTMENT/OTHER requieren type). */
  private inferType(category: string): CashMovementType {
    if (
      category === CashMovementCategory.SALE ||
      category === CashMovementCategory.DEPOSIT
    ) {
      return CashMovementType.IN;
    }
    if ((CASH_OUT_CATEGORIES as readonly string[]).includes(category)) {
      return CashMovementType.OUT;
    }
    throw new BadRequestException(
      `Debes indicar el tipo (IN/OUT) para la categoria ${category}`,
    );
  }

  /** Devuelve la sesion abierta o lanza error. Usado por pedidos/gastos. */
  async getOpenSessionOrThrow(companyId: string, tx?: PrismaClientLike) {
    const session = await this.cash.findOpenSession(companyId, {}, tx);
    if (!session) {
      throw new BadRequestException(
        'No hay una caja abierta. Debes abrir la caja antes de registrar esta operacion.',
      );
    }
    return session;
  }

  /**
   * Registra un movimiento en la sesion de caja (append-only).
   * Si no se indica sessionId se usa la sesion abierta actual.
   */
  async registerMovement(
    companyId: string,
    input: RegisterMovementInput,
    tx?: PrismaClientLike,
  ) {
    const amount = toMoney(input.amount);

    if (amount <= 0) {
      throw new BadRequestException('El monto del movimiento debe ser mayor a 0');
    }

    // El comprobante ya se subio a `private/img/<rif>/payments` por multipart;
    // aqui solo se normaliza la URL local que queda en la fila.
    const paymentPhotoUrl = this.images
      ? await this.images.persist(companyId, 'payments', input.paymentPhotoUrl)
      : (input.paymentPhotoUrl ?? null);

    // El monto se registra en la moneda del pago; el equivalente en USD
    // (`baseAmount`) es lo que se suma en los arqueos y reportes.
    const conversion = await this.rates.resolvePayment(
      companyId,
      amount,
      input.currency ?? BASE_CURRENCY_CODE,
    );
    // El llamador puede fijar el equivalente en USD (montos ajustados al saldo).
    // El valor contable se guarda en centavos; `baseRate` conserva la tasa exacta
    // para que el arqueo pueda valorar el dinero fisico sin perder decimales.
    const baseAmount =
      input.baseAmount === null || input.baseAmount === undefined
        ? toMoney(conversion.baseAmount)
        : toMoney(input.baseAmount);
    // Tasa exacta para valorar el movimiento en la moneda base: se guarda
    // SIEMPRE, aunque el llamador haya ajustado `baseAmount` a un saldo.
    //
    // `baseAmount` es el valor contable del cobro (p. ej. el precio en USD del
    // pedido, recortado al centavo) y no lo que fisicamente entro al cajon. El
    // arqueo necesita el dinero real: Bs 15.520,00 al BCV son 17,5686 USD, no
    // los 17,56 del precio. Con la tasa guardada el turno suma sin perder
    // decimales y recorta una sola vez al final, igual que la pantalla.
    const baseRate = conversion.unitsPerBase;

    const sessionId =
      input.sessionId ?? (await this.getOpenSessionOrThrow(companyId, tx)).id;

    const session = await this.cash.findSessionForMovement(
      companyId,
      sessionId,
      tx,
    );

    if (!session) throw new NotFoundException('Sesion de caja no encontrada');
    if (session.status !== CashSessionStatus.OPEN) {
      throw new BadRequestException(
        `La caja ${session.code} ya esta cerrada y no admite movimientos.`,
      );
    }

    return this.cash.createMovement(
      {
        companyId,
        sessionId: session.id,
        type: input.type ?? this.inferType(input.category),
        category: input.category,
        paymentMethod: input.paymentMethod ?? PaymentMethod.CASH,
        amount,
        currency: conversion.currency,
        exchangeRate: conversion.exchangeRate,
        baseAmount,
        baseRate,
        description: input.description,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        paymentReference: input.paymentReference ?? undefined,
        paymentPhotoUrl: paymentPhotoUrl ?? undefined,
        createdById: input.createdById,
      },
      tx,
    );
  }

  /**
   * Comprobante que se guarda en un movimiento. Solo los metodos bancarios
   * (transferencia / Yape / Plin) lo exigen: la referencia debe tener de 4 a 6
   * digitos y la foto es opcional. En los demas metodos el comprobante se ignora.
   */
  private proofFor(
    method: PaymentMethod | undefined,
    input: {
      paymentReference?: string | null;
      paymentPhotoUrl?: string | null;
    },
  ): { paymentReference?: string; paymentPhotoUrl?: string } {
    if (!method || !PAYMENT_PROOF_METHODS.includes(method)) return {};

    const reference = String(input.paymentReference ?? '').trim();
    if (!/^\d{4,6}$/.test(reference)) {
      throw new BadRequestException(
        `Escribe la referencia del comprobante de ${method}: de 4 a 6 digitos.`,
      );
    }

    return {
      paymentReference: reference,
      ...(input.paymentPhotoUrl
        ? { paymentPhotoUrl: input.paymentPhotoUrl }
        : {}),
    };
  }

  /** Endpoint manual: ingreso/egreso de caja. */
  async addMovement(
    companyId: string,
    dto: CreateCashMovementDto,
    userId: string,
  ) {
    // El vuelto (`CHANGE`) nace del cobro de un pedido, con su metodo y su
    // moneda: no se captura como movimiento manual para que no se descuadre el
    // arqueo con un egreso que no corresponde a ninguna venta.
    if (dto.category === CashMovementCategory.CHANGE) {
      throw new BadRequestException(
        'El vuelto se registra automaticamente al cobrar un pedido.',
      );
    }

    const parts = dto.parts ?? [];

    // Movimiento simple: una sola forma de pago. MIXTO siempre exige el desglose
    // para que el arqueo sepa cuanto entro por cada metodo y moneda.
    if (parts.length === 0) {
      if (dto.paymentMethod === PaymentMethod.MIXED) {
        throw new BadRequestException(
          'El pago mixto requiere el desglose de las partes (parts)',
        );
      }
      const amount = dto.amount;
      if (amount === null || amount === undefined || toMoney(amount) <= 0) {
        throw new BadRequestException('El monto del movimiento debe ser mayor a 0');
      }

      return this.registerMovement(companyId, {
        type: dto.type,
        category: dto.category,
        paymentMethod: dto.paymentMethod,
        amount,
        currency: dto.currency,
        description: dto.description,
        ...this.proofFor(dto.paymentMethod ?? PaymentMethod.CASH, dto),
        createdById: userId,
      });
    }

    if (parts.length > 8) {
      throw new BadRequestException('El pago mixto admite hasta 8 partes');
    }
    if (parts.some((part) => toMoney(part.amount) <= 0)) {
      throw new BadRequestException(
        'El monto de cada parte del pago debe ser mayor a 0',
      );
    }

    // Cada parte queda como un movimiento propio y todas se guardan en la misma
    // transaccion: si una falla (por ejemplo, sin tasa) no queda un cobro a
    // medias en la caja.
    return this.cash.transaction(async (tx) => {
      const session = await this.getOpenSessionOrThrow(companyId, tx);
      const movements = [];

      for (const part of parts) {
        movements.push(
          await this.registerMovement(
            companyId,
            {
              sessionId: session.id,
              type: dto.type,
              category: dto.category,
              paymentMethod: part.paymentMethod,
              amount: part.amount,
              currency: part.currency,
              description: dto.description,
              ...this.proofFor(part.paymentMethod, {
                paymentReference:
                  part.paymentReference ?? dto.paymentReference,
                paymentPhotoUrl: part.paymentPhotoUrl ?? dto.paymentPhotoUrl,
              }),
              createdById: userId,
            },
            tx,
          ),
        );
      }

      return { movements, count: movements.length };
    });
  }

}
