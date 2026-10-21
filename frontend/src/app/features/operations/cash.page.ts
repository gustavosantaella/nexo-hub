import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { PaginationMeta } from '../../core/models/api.model';
import type {
  CashCurrentResponse,
  CashMovement,
  CashMovementPayload,
  CashOpeningLine,
  CashSession,
  CashSummary,
  CurrencyBreakdown,
} from '../../core/models/operations.model';
import {
  CASH_CATEGORY_LABELS,
  CASH_CATEGORY_OPTIONS,
  CASH_IN_CATEGORIES,
  CASH_OUT_CATEGORIES,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHOD_OPTIONS,
} from '../../core/constants/domain';
import { BASE_CURRENCY, MIXED_CURRENCY_CODE } from '../../core/constants/currency';
import { CurrencySelectComponent } from '../../shared/components/currency-select.component';
import { RateConversionsComponent } from '../../shared/components/rate-conversions.component';
import { RatesService, BCV_USD_RATE_KEY } from '../../core/services/rates.service';
import { CashService } from '../../core/services/cash.service';
import { PreferencesService } from '../../core/services/preferences.service';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmService } from '../../shared/services/confirm.service';
import {
  apiErrorMessage,
  dateTime,
  displayBaseCode,
  displayBaseLabel,
  moneyIn,
  rate,
  sumMoney,
  truncate,
} from '../../core/utils/format';
import { EmptyStateComponent, LoaderComponent } from '../../shared/components/feedback.component';
import { IconComponent } from '../../shared/components/icon.component';
import { PosComponent } from './pos.component';
import { DialogComponent } from '../../shared/components/dialog.component';
import { MoneyComponent } from '../../shared/components/money.component';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { PaginationComponent } from '../../shared/components/pagination.component';
import { StatCardComponent } from '../../shared/components/stat-card.component';

type CashCategory = CashMovementPayload['category'];

const EMPTY_META: PaginationMeta = {
  total: 0,
  page: 1,
  limit: 20,
  totalPages: 0,
  hasNextPage: false,
  hasPreviousPage: false,
};

/** Pagina de caja: arqueo de la sesion actual, movimientos e historial. */
@Component({
  selector: 'app-cash',
  standalone: true,
  imports: [
    FormsModule,
    IconComponent,
    PageHeaderComponent,
    PaginationComponent,
    DialogComponent,
    StatCardComponent,
    PosComponent,
    MoneyComponent,
    CurrencySelectComponent,
    RateConversionsComponent,
    EmptyStateComponent,
    LoaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './cash.page.html',
})
export class CashPage implements OnInit {
  private readonly cash = inject(CashService);
  private readonly toast = inject(ToastService);
  private readonly rates = inject(RatesService);
  private readonly confirm = inject(ConfirmService);
  private readonly preferences = inject(PreferencesService);

  readonly dateTime = dateTime;
  readonly moneyIn = moneyIn;
  /** Código de la moneda base con la que se muestran los montos (USD por defecto). */
  readonly moneyBaseCode = displayBaseCode;
  /** Nombre de esa moneda: los equivalentes que pinta la pantalla van en ella. */
  readonly moneyBaseLabel = displayBaseLabel;
  readonly rate = rate;
  readonly baseCurrency = BASE_CURRENCY;
  /**
   * Cómo presenta la caja sus formularios (modal o panel lateral). El usuario lo
   * elige en Configuración → «Formularios de caja y pedidos».
   */
  readonly dialogView = this.preferences.dialogView;
  /** Monedas configuradas (para el filtro del historial). */
  readonly currencies = this.rates.currencies;

  /**
   * Vista activa de la caja: el arqueo del turno o el punto de venta del cajero
   * (misma sesión, cobros y pedidos).
   */
  readonly view = signal<'arqueo' | 'pos'>('arqueo');

  /** Abre el punto de venta dentro de la caja. */
  openPos(): void {
    this.view.set('pos');
  }

  /** Vuelve al arqueo y refresca los totales tras cobrar en el POS. */
  closePos(): void {
    this.view.set('arqueo');
    this.load();
    this.loadMovements();
  }
  readonly categoryLabels = CASH_CATEGORY_LABELS;
  /**
   * Categorias del movimiento manual. `CHANGE` (vuelto) lo genera el cobro de un
   * pedido con su metodo y moneda; no se captura a mano.
   */
  readonly categoryOptions = CASH_CATEGORY_OPTIONS.filter(
    (option) => option.value !== 'CHANGE',
  );
  readonly methodLabels = PAYMENT_METHOD_LABELS;
  readonly methodOptions = PAYMENT_METHOD_OPTIONS;
  readonly movementTypeOptions = [
    { value: 'IN', label: 'Entrada' },
    { value: 'OUT', label: 'Salida' },
  ];

  readonly loading = signal(false);
  readonly session = signal<CashSession | null>(null);
  readonly summary = signal<CashSummary | null>(null);

  readonly opening = signal(false);
  /** Máximo de monedas distintas por fondo (igual que el límite del backend). */
  readonly maxOpeningLines = 8;
  /** Una línea por cada moneda contada en el cajón al abrir la caja. */
  openForm: {
    lines: { currency: string; amount: number }[];
    openingNotes: string;
  } = { lines: [{ currency: BASE_CURRENCY.code as string, amount: 0 }], openingNotes: '' };

  readonly movOpen = signal(false);
  readonly saving = signal(false);
  movForm = {
    category: 'SALE' as CashCategory,
    type: 'IN' as 'IN' | 'OUT',
    paymentMethod: 'CASH',
    amount: 0,
    currency: BASE_CURRENCY.code as string,
    description: '',
  };

  readonly closeOpen = signal(false);
  readonly closing = signal(false);
  closeForm = {
    countedAmount: 0,
    countedCurrency: BASE_CURRENCY.code as string,
    closingNotes: '',
  };

  readonly movItems = signal<CashMovement[]>([]);
  readonly movMeta = signal<PaginationMeta>(EMPTY_META);
  readonly movLoading = signal(false);
  movFrom = '';
  movTo = '';
  movType = '';
  /** Filtro por moneda del historial de movimientos. */
  movCurrency = '';
  private movPage = 1;
  private movLimit = 20;

  readonly sesItems = signal<CashSession[]>([]);
  readonly sesMeta = signal<PaginationMeta>(EMPTY_META);
  readonly sesLoading = signal(false);
  private sesPage = 1;
  private sesLimit = 10;

  readonly detailOpen = signal(false);
  readonly detailSession = signal<CashSession | null>(null);

  readonly movementDetailOpen = signal(false);
  readonly movementDetail = signal<CashMovement | null>(null);
  /** El comprobante se muestra pequeño y se expande dentro del mismo dialogo. */
  readonly movementPhotoExpanded = signal(false);

  ngOnInit(): void {
    this.load();
    this.loadMovements();
    this.loadSessions();
  }

  load(): void {
    this.loading.set(true);
    this.cash.current().subscribe({
      next: (response) => {
        const payload = response as CashCurrentResponse | CashSession | null;
        const session =
          payload && 'status' in payload
            ? (payload as CashSession)
            : ((payload as CashCurrentResponse | null)?.session ?? null);
        const summary =
          payload && 'status' in payload
            ? ((payload as CashSession).summary ?? null)
            : ((payload as CashCurrentResponse | null)?.summary ?? null);
        this.session.set(session && session.status === 'OPEN' ? session : null);
        this.summary.set(session ? summary : null);
        this.loading.set(false);
      },
      error: () => {
        this.session.set(null);
        this.summary.set(null);
        this.loading.set(false);
      },
    });
  }

  get expectedCash(): number {
    const summary = this.summary();
    if (summary) return summary.expectedCash;
    return this.session()?.openingAmount ?? 0;
  }

  /** Ventas del turno sin propinas (moneda base). */
  get salesTotal(): number {
    return this.summary()?.salesTotal ?? 0;
  }

  /**
   * Propinas cobradas en el turno (moneda base). No son ventas: entran dentro
   * del cobro del pedido y el backend las separa del consumo en el arqueo.
   */
  get tipsTotal(): number {
    return this.summary()?.tipsTotal ?? 0;
  }

  /** Ventas + propinas: lo que entró por ventas en el turno. */
  get salesGrossTotal(): number {
    return sumMoney([this.salesTotal, this.tipsTotal]);
  }

  get byMethod(): { method: string; in: number; out: number; net: number }[] {
    return this.summary()?.byMethod ?? [];
  }

  /** Efectivo por moneda (montos originales + equivalente en la moneda base). */
  get byCurrency(): CurrencyBreakdown[] {
    return this.summary()?.byCurrency ?? [];
  }

  /** Fondo inicial contado en la sesión abierta, moneda por moneda. */
  get openingFund(): CashOpeningLine[] {
    return this.summary()?.openingByCurrency ?? [];
  }

  /** Líneas del fondo con monto (lo que se envía al abrir la caja). */
  get openingLines(): { currency: string; amount: number }[] {
    return this.openForm.lines
      .map((line) => ({
        currency: line.currency,
        amount: Number(line.amount) || 0,
      }))
      .filter((line) => line.amount > 0);
  }

  /** Fondo total de la apertura expresado en la moneda base (USD). */
  get openingTotal(): number {
    return sumMoney(
      this.openForm.lines.map(
        (line) => this.rates.toBase(Number(line.amount) || 0, line.currency) ?? 0,
      ),
    );
  }

  /** Monedas del fondo sin tasa disponible (no se pueden contabilizar). */
  get openingMissingRates(): string[] {
    return this.openForm.lines
      .filter(
        (line) =>
          (Number(line.amount) || 0) > 0 &&
          this.rates.toBase(1, line.currency) === null,
      )
      .map((line) => line.currency);
  }

  /** Resumen del fondo contado para la tarjeta del arqueo. */
  get openingStatHint(): string | undefined {
    const lines = this.session()?.openingLines ?? [];
    if (lines.length === 0) return undefined;
    return lines.length === 1
      ? `contado en ${lines[0].currency}`
      : `contado en ${lines.length} monedas`;
  }

  /** Texto del fondo de una sesión del historial (una o varias monedas). */
  openingFundHint(sessionRow: CashSession): string | null {
    const lines = Array.isArray(sessionRow.openingLines)
      ? sessionRow.openingLines
      : [];
    const counted = (code: string): string =>
      sessionRow.openingRate
        ? `contado en ${code} · × ${rate(sessionRow.openingRate)}`
        : `contado en ${code}`;

    if (lines.length > 1) {
      return `fondo en ${lines.length} monedas · ${lines
        .map((line) => line.currency)
        .join(' + ')}`;
    }
    if (lines.length === 1) return counted(lines[0].currency);

    // Sesiones anteriores al fondo multimoneda: la moneda viene en el campo.
    const code = sessionRow.openingCurrency;
    if (!code || code === BASE_CURRENCY.code || code === MIXED_CURRENCY_CODE) {
      return null;
    }
    return counted(code);
  }

  /** Agrega una línea al fondo, en la primera moneda que aún no se usa. */
  addOpeningLine(): void {
    if (this.openForm.lines.length >= this.maxOpeningLines) return;
    this.openForm.lines = [
      ...this.openForm.lines,
      { currency: this.nextOpeningCurrency(), amount: 0 },
    ];
  }

  removeOpeningLine(index: number): void {
    if (this.openForm.lines.length <= 1) return;
    this.openForm.lines = this.openForm.lines.filter(
      (_, position) => position !== index,
    );
  }

  /** Moneda sugerida para una línea nueva del fondo. */
  private nextOpeningCurrency(): string {
    const used = this.openForm.lines.map((line) => line.currency);
    const free = this.rates
      .enabledCurrencies()
      .find((item) => !used.includes(item.code));
    return free?.code ?? BASE_CURRENCY.code;
  }

  /** Deja el formulario de apertura como nuevo. */
  private resetOpenForm(): void {
    this.openForm = {
      lines: [{ currency: BASE_CURRENCY.code as string, amount: 0 }],
      openingNotes: '',
    };
  }

  /** Formatea un monto en la moneda indicada. */
  amountIn(value: number | null | undefined, currency?: string | null): string {
    return moneyIn(value, currency);
  }

  /**
   * Equivalente contable de un monto en la moneda de visualización.
   *
   * Va a la tasa del **BCV**, la misma de las tarjetas y los desgloses del
   * arqueo (`displayRateKey="BCV_USD"`). Con `money()` salía a la tasa de
   * vitrina y el mismo monto aparecía con dos valores distintos en la pantalla.
   *
   * La cuenta sale del monto original (los bolívares que entraron al cajón), no
   * del equivalente en USD guardado: ese se redondea a centavos, así que
   * reconvertirlo pintaba Bs 15.520,00 como Bs 15.521,27.
   */
  equivalentInBase(
    baseAmount: number | null | undefined,
    amount?: number | null,
    currency?: string | null,
  ): string {
    const converted = this.toDisplay(amount, currency, baseAmount);
    return moneyIn(converted ?? 0, displayBaseCode());
  }

  /** `true` cuando la moneda indicada es la que se está mostrando. */
  isDisplayCurrency(currency?: string | null): boolean {
    const code = String(currency ?? BASE_CURRENCY.code)
      .trim()
      .toUpperCase();
    return !!code && code === displayBaseCode();
  }

  /**
   * Monto del movimiento en la moneda de visualización.
   *
   * La moneda del movimiento conserva su monto físico (los bolívares que entraron
   * al cajón). Las demás se valoran con la tasa con la que se registró el
   * movimiento (`baseRate`), no con la del día: así el listado no cambia cuando
   * el BCV publica una tasa nueva y el total coincide con el arqueo.
   */
  movementDisplay(movement: CashMovement): number | null {
    const sign = movement.type === 'IN' ? 1 : -1;
    const amount = sign * Number(movement.amount ?? 0);
    if (this.isDisplayCurrency(movement.currency)) return amount;
    const baseRate = Number(movement.baseRate ?? 0);
    const base =
      Number.isFinite(baseRate) && baseRate > 0
        ? amount / baseRate
        : this.rates.toBase(amount, movement.currency, BCV_USD_RATE_KEY);
    if (base === null) return null;
    return this.rates.fromBase(base, displayBaseCode(), BCV_USD_RATE_KEY);
  }

  /**
   * Neto de una fila del desglose por moneda, en la moneda de visualización.
   *
   * La moneda que se está mostrando conserva su monto físico; las demás usan el
   * equivalente que ya calculó el backend (recortado una vez por moneda). Rehacer
   * la cuenta desde los montos originales a la tasa del día dejaba el neto en
   * bolívares en 35,13 mientras el total del método decía 35,12.
   */
  currencyNetDisplay(row: CurrencyBreakdown): number | null {
    if (this.isDisplayCurrency(row.currency)) return Number(row.net ?? 0);
    return this.aggregateDisplay(row.baseNet);
  }

  /**
   * Lleva un monto de su moneda original a la moneda de visualización.
   *
   * `amount` es lo que realmente entró o salió (en `currency`) y `baseAmount` su
   * equivalente guardado en USD, que solo se usa como respaldo cuando falta el
   * original. La cuenta va a la tasa del BCV, la misma del arqueo: así el monto
   * se pinta completo aunque el dólar guardado esté redondeado a centavos.
   */
  private toDisplay(
    amount: number | null | undefined,
    currency: string | null | undefined,
    baseAmount?: number | null,
  ): number | null {
    const value = Number(amount);
    if (amount != null && Number.isFinite(value)) {
      if (this.isDisplayCurrency(currency)) return value;
      const base = this.rates.toBase(value, currency, BCV_USD_RATE_KEY);
      if (base !== null) {
        return this.rates.fromBase(base, displayBaseCode(), BCV_USD_RATE_KEY);
      }
    }
    if (baseAmount == null) return null;
    return this.rates.fromBase(baseAmount, displayBaseCode(), BCV_USD_RATE_KEY);
  }

  /** Efectivo que entró al cajón, en la moneda de visualización. */
  get cashInDisplay(): number | null {
    return this.cashInDisplayOf(this.summary());
  }

  /** Efectivo que entró al cajón de un arqueo cualquiera. */
  cashInDisplayOf(summary: CashSummary | null | undefined): number | null {
    return this.aggregateDisplay(summary?.cashIn);
  }

  /** Efectivo que salió del cajón, en la moneda de visualización. */
  get cashOutDisplay(): number | null {
    return this.cashOutDisplayOf(this.summary());
  }

  /** Efectivo que salió del cajón de un arqueo cualquiera. */
  cashOutDisplayOf(summary: CashSummary | null | undefined): number | null {
    return this.aggregateDisplay(summary?.cashOut);
  }

  /** Fondo inicial en la moneda de visualización (lo contado al abrir). */
  get openingDisplay(): number | null {
    return this.openingDisplayOf(this.session(), this.summary());
  }

  /**
   * Fondo inicial de una sesión en la moneda de visualización.
   *
   * Se valoriza línea por línea con la tasa con la que se contó el fondo
   * (`amount / baseRate`), igual que el arqueo. `openingAmount` es el total ya
   * redondeado al centavo: un fondo de Bs 5.000,00 al BCV son 5,5555 USD y la
   * tarjeta no puede decir 5,56 si el efectivo esperado usa 5,55.
   */
  openingDisplayOf(
    session: CashSession | null | undefined,
    summary: CashSummary | null | undefined,
  ): number | null {
    if (summary?.openingCash != null) return this.aggregateDisplay(summary.openingCash);
    const lines = summary?.openingByCurrency ?? session?.openingLines ?? [];
    const rated = lines.filter((line) => Number(line.baseRate ?? 0) > 0);
    if (lines.length > 0 && rated.length === lines.length) {
      return this.aggregateDisplay(
        sumMoney(
          rated.map(
            (line) => Number(line.amount ?? 0) / Number(line.baseRate ?? 1),
          ),
        ),
      );
    }
    const opening = session?.openingAmount;
    if (opening != null) return this.aggregateDisplay(opening);
    if (lines.length === 0) return 0;
    return this.aggregateDisplay(
      sumMoney(lines.map((line) => Number(line.baseAmount ?? 0))),
    );
  }

  /** Efectivo esperado en el cajón, en la moneda de visualización. */
  get expectedCashDisplay(): number | null {
    return this.expectedCashDisplayOf(this.session(), this.summary());
  }

  /**
   * Efectivo esperado de una sesión en la moneda de visualización.
   *
   * Es el número con el que se cierra la caja (`summary.expectedCash`, que el
   * backend recorta una sola vez desde los centavos sin redondear) y el que
   * guarda la sesión ya cerrada (`expectedAmount`). Sumar aquí el desglose por
   * moneda a la tasa del día volvía a introducir el centavo que este número
   * acababa de quitar: la tarjeta decía 41,72 y el cierre 41,71.
   */
  expectedCashDisplayOf(
    session: CashSession | null | undefined,
    summary: CashSummary | null | undefined,
  ): number | null {
    const expected = session?.expectedAmount ?? summary?.expectedCash;
    if (expected != null) return this.aggregateDisplay(expected);
    return this.openingDisplayOf(session, summary);
  }

  /** Propinas del turno en la moneda de visualización. */
  get tipsTotalDisplay(): number | null {
    return this.tipsTotalDisplayOf(this.summary());
  }

  /** Propinas de un arqueo cualquiera en la moneda de visualización. */
  tipsTotalDisplayOf(summary: CashSummary | null | undefined): number | null {
    return this.aggregateDisplay(summary?.tipsTotal);
  }

  /** Ventas del turno (sin propinas ni vueltos) en la moneda de visualización. */
  get salesTotalDisplay(): number | null {
    return this.salesTotalDisplayOf(this.summary());
  }

  /** Ventas de un arqueo cualquiera en la moneda de visualización. */
  salesTotalDisplayOf(
    summary: CashSummary | null | undefined,
  ): number | null {
    return this.aggregateDisplay(summary?.salesTotal);
  }

  /** Ventas + propinas (lo cobrado por ventas) en la moneda de visualización. */
  get salesGrossDisplay(): number | null {
    return this.salesGrossDisplayOf(this.summary());
  }

  /** Ventas + propinas de un arqueo cualquiera en la moneda de visualización. */
  salesGrossDisplayOf(summary: CashSummary | null | undefined): number | null {
    if (!summary) return null;
    return this.aggregateDisplay(
      sumMoney([summary.salesTotal, summary.tipsTotal]),
    );
  }

  /** Desglose por método con el total exacto en la moneda de visualización. */
  get byMethodRows(): {
    method: string;
    in: number;
    out: number;
    net: number;
    inDisplay: number | null;
    outDisplay: number | null;
    netDisplay: number | null;
  }[] {
    const summary = this.summary();
    return (summary?.byMethod ?? []).map((row) => ({
      ...row,
      inDisplay: this.methodDisplay(summary, row.method, 'in'),
      outDisplay: this.methodDisplay(summary, row.method, 'out'),
      netDisplay: this.methodDisplay(summary, row.method, 'net'),
    }));
  }

  /**
   * Total de un método en la moneda de visualización.
   *
   * Sale del total del método que calcula el backend (`byMethod`, en USD), no de
   * sumar el desglose por moneda: es el mismo número que descuenta el arqueo.
   */
  private methodDisplay(
    summary: CashSummary | null | undefined,
    method: string,
    field: 'in' | 'out' | 'net',
  ): number | null {
    const row = (summary?.byMethod ?? []).find((line) => line.method === method);
    if (!row) return null;
    return this.aggregateDisplay(row[field]);
  }

  /**
   * Lleva un total del arqueo (siempre en USD, la moneda base contable) a la
   * moneda de visualización.
   *
   * Los agregados se pintan tal como los calcula el backend: cada movimiento
   * entra con su equivalente exacto y el total se recorta una sola vez. Rehacer
   * esa suma en el navegador —a la tasa del día y con el `baseAmount` guardado—
   * dejaba la tarjeta del efectivo esperado un centavo por encima del número con
   * el que se cierra la caja (41,72 contra 41,71).
   */
  private aggregateDisplay(amount: number | null | undefined): number | null {
    if (amount == null) return null;
    return this.rates.fromBase(amount, displayBaseCode(), BCV_USD_RATE_KEY);
  }

  /**
   * Abre la caja con el fondo contado en una o varias monedas. Si no se indica
   * ningún monto se confirma la apertura sin fondo (fondo 0).
   */
  async openCash(): Promise<void> {
    if (this.opening()) return;

    if (this.openingMissingRates.length > 0) {
      this.toast.error(
        `Falta la tasa de ${this.openingMissingRates.join(', ')}. Configúrala en Configuración → Monedas.`,
      );
      return;
    }

    const lines = this.openingLines;
    if (lines.length === 0) {
      const confirmed = await this.confirm.ask({
        title: 'Abrir caja sin fondo',
        message:
          'No indicaste ningún monto en el fondo inicial. ¿Abrir la caja con fondo 0?',
        confirmLabel: 'Abrir sin fondo',
      });
      if (!confirmed) return;
    }

    this.opening.set(true);
    this.cash
      .open({
        openingAmount: this.openingTotal,
        openingLines: lines,
        openingNotes: this.openForm.openingNotes || undefined,
      })
      .subscribe({
        next: () => {
          this.opening.set(false);
          this.toast.success('Caja abierta');
          this.resetOpenForm();
          this.load();
        },
        error: (error) => {
          this.opening.set(false);
          this.toast.error(apiErrorMessage(error));
        },
      });
  }

  get needsManualType(): boolean {
    return (
      !CASH_IN_CATEGORIES.includes(this.movForm.category) &&
      !CASH_OUT_CATEGORIES.includes(this.movForm.category)
    );
  }

  onCategoryChange(): void {
    if (CASH_IN_CATEGORIES.includes(this.movForm.category)) {
      this.movForm.type = 'IN';
    } else if (CASH_OUT_CATEGORIES.includes(this.movForm.category)) {
      this.movForm.type = 'OUT';
    }
  }

  openMovement(): void {
    this.movForm = {
      category: 'SALE',
      type: 'IN',
      paymentMethod: 'CASH',
      amount: 0,
      currency: BASE_CURRENCY.code,
      description: '',
    };
    this.movOpen.set(true);
  }

  closeMovement(): void {
    this.movOpen.set(false);
  }

  submitMovement(): void {
    if (this.saving()) return;
    const amount = Number(this.movForm.amount);
    if (!(amount > 0)) {
      this.toast.error('El monto debe ser mayor a 0');
      return;
    }
    this.saving.set(true);
    const payload: CashMovementPayload = {
      category: this.movForm.category,
      paymentMethod: this.movForm.paymentMethod as CashMovementPayload['paymentMethod'],
      amount,
      currency: this.movForm.currency || undefined,
      description: this.movForm.description || undefined,
    };
    if (this.needsManualType) payload.type = this.movForm.type;
    this.cash.addMovement(payload).subscribe({
      next: () => {
        this.saving.set(false);
        this.toast.success('Movimiento registrado');
        this.closeMovement();
        this.load();
        this.loadMovements();
      },
      error: (error) => {
        this.saving.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  openClose(): void {
    this.closeForm = {
      countedAmount: this.expectedCash,
      countedCurrency: BASE_CURRENCY.code,
      closingNotes: '',
    };
    this.closeOpen.set(true);
  }

  closeClose(): void {
    this.closeOpen.set(false);
  }

  /**
   * Conteo del cierre llevado a USD (moneda base).
   *
   * Se valoriza con la tasa del día y se recorta igual que el backend: el
   * conteo se guarda en USD para compararlo contra el arqueo esperado, que
   * también está en USD. Antes la diferencia restaba centavos de bolívares a
   * dólares (contar Bs 31.040,00 mostraba una diferencia de miles).
   */
  get countedBase(): number {
    const counted = Number(this.closeForm.countedAmount) || 0;
    if (counted <= 0) return 0;
    const currency = this.closeForm.countedCurrency || BASE_CURRENCY.code;
    const base = this.rates.toBase(counted, currency, BCV_USD_RATE_KEY);
    return truncate(base ?? counted, 2);
  }

  /** Diferencia del arqueo (contado − esperado), recortada y sin redondear. */
  get closeDifference(): number {
    const difference = truncate(this.countedBase - this.expectedCash, 2);
    return difference === 0 ? 0 : difference; // evita pintar "-0.00"
  }

  submitClose(): void {
    if (this.closing()) return;
    this.closing.set(true);
    this.cash
      .close({
        countedAmount: Number(this.closeForm.countedAmount) || 0,
        countedCurrency: this.closeForm.countedCurrency || undefined,
        closingNotes: this.closeForm.closingNotes || undefined,
      })
      .subscribe({
        next: () => {
          this.closing.set(false);
          this.toast.success('Caja cerrada');
          this.closeClose();
          this.load();
          this.loadSessions();
        },
        error: (error) => {
          this.closing.set(false);
          this.toast.error(apiErrorMessage(error));
        },
      });
  }

  loadMovements(): void {
    this.movLoading.set(true);
    this.cash
      .movements({
        page: this.movPage,
        limit: this.movLimit,
        from: this.movFrom || undefined,
        to: this.movTo || undefined,
        type: this.movType || undefined,
        currency: this.movCurrency || undefined,
      })
      .subscribe({
        next: (response) => {
          this.movItems.set(response.items);
          this.movMeta.set(response.meta);
          this.movLoading.set(false);
        },
        error: () => this.movLoading.set(false),
      });
  }

  changeMovPage(page: number): void {
    this.movPage = page;
    this.loadMovements();
  }

  changeMovLimit(limit: number): void {
    this.movLimit = limit;
    this.movPage = 1;
    this.loadMovements();
  }

  loadSessions(): void {
    this.sesLoading.set(true);
    this.cash.sessions({ page: this.sesPage, limit: this.sesLimit }).subscribe({
      next: (response) => {
        this.sesItems.set(response.items);
        this.sesMeta.set(response.meta);
        this.sesLoading.set(false);
      },
      error: () => this.sesLoading.set(false),
    });
  }

  changeSesPage(page: number): void {
    this.sesPage = page;
    this.loadSessions();
  }

  changeSesLimit(limit: number): void {
    this.sesLimit = limit;
    this.sesPage = 1;
    this.loadSessions();
  }

  openSessionDetail(sessionRow: CashSession): void {
    this.detailSession.set(sessionRow);
    this.detailOpen.set(true);
    this.cash.session(sessionRow.id).subscribe({
      next: (detail) => this.detailSession.set(detail),
    });
  }

  openMovementDetail(movement: CashMovement): void {
    this.movementDetail.set(movement);
    this.movementPhotoExpanded.set(false);
    this.movementDetailOpen.set(true);
  }

  toggleMovementPhoto(): void {
    this.movementPhotoExpanded.update((expanded) => !expanded);
  }

  closeMovementDetail(): void {
    this.movementDetailOpen.set(false);
    this.movementDetail.set(null);
    this.movementPhotoExpanded.set(false);
  }

  closeSessionDetail(): void {
    this.detailOpen.set(false);
    this.detailSession.set(null);
  }
}
