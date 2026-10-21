import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { PaginationMeta } from '../../core/models/api.model';
import type {
  CashCurrentResponse,
  CashMovement,
  CashMovementPartPayload,
  CashMovementPayload,
  CashOpeningLine,
  CashSession,
  CashSummary,
  CurrencyBreakdown,
} from '../../core/models/operations.model';
import {
  CASH_CATEGORY_LABELS,
  CASH_IN_CATEGORIES,
  CASH_OUT_CATEGORIES,
  PAYMENT_METHOD_LABELS,
  needsPaymentProof,
} from '../../core/constants/domain';
import { BASE_CURRENCY, MIXED_CURRENCY_CODE } from '../../core/constants/currency';
import { CurrencySelectComponent } from '../../shared/components/currency-select.component';
import { RateConversionsComponent } from '../../shared/components/rate-conversions.component';
import { RatesService, BCV_USD_RATE_KEY } from '../../core/services/rates.service';
import { CashService } from '../../core/services/cash.service';
import { MediaService } from '../../core/services/media.service';
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
import { toPaymentProofFile } from '../../core/utils/image';
import { resolveMediaUrl } from '../../core/utils/media-url';
import { EmptyStateComponent, LoaderComponent } from '../../shared/components/feedback.component';
import { IconComponent } from '../../shared/components/icon.component';
import { DialogComponent } from '../../shared/components/dialog.component';
import { MoneyComponent } from '../../shared/components/money.component';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { PaginationComponent } from '../../shared/components/pagination.component';
import { StatCardComponent } from '../../shared/components/stat-card.component';

type CashCategory = CashMovementPayload['category'];
type CashDirection = 'IN' | 'OUT';

/** Tarjeta de categoria del movimiento manual con su efecto en la caja. */
interface CashCategoryCard {
  value: CashCategory;
  label: string;
  hint: string;
  icon: string;
  group: 'IN' | 'OUT' | 'MANUAL';
}

/** Grupo visual de categorias (entradas, salidas o movimientos manuales). */
interface CashCategoryGroup {
  key: 'IN' | 'OUT' | 'MANUAL';
  title: string;
  hint: string;
  items: CashCategoryCard[];
}

/** Metodo de pago con su efecto sobre el efectivo del cajon. */
interface CashMethodCard {
  value: string;
  label: string;
  icon: string;
}

/** Parte de un pago mixto tal como se captura en el formulario. */
interface CashMovementPartDraft {
  method: string;
  currency: string;
  amount: number;
}

const EMPTY_META: PaginationMeta = {
  total: 0,
  page: 1,
  limit: 20,
  totalPages: 0,
  hasNextPage: false,
  hasPreviousPage: false,
};

/** Segundos minimos entre dos recargas manuales de la caja. */
const REFRESH_COOLDOWN_MS = 10_000;

/**
 * Pagina de caja: arqueo de la sesion actual, movimientos e historial. La vista
 * del cajero (POS) es una ruta aparte, `/panel/caja/pos`.
 */
@Component({
  selector: 'app-cash',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    IconComponent,
    PageHeaderComponent,
    PaginationComponent,
    DialogComponent,
    StatCardComponent,
    MoneyComponent,
    CurrencySelectComponent,
    RateConversionsComponent,
    EmptyStateComponent,
    LoaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './cash.page.html',
})
export class CashPage implements OnInit, OnDestroy {
  private readonly cash = inject(CashService);
  private readonly toast = inject(ToastService);
  private readonly rates = inject(RatesService);
  private readonly confirm = inject(ConfirmService);
  private readonly preferences = inject(PreferencesService);
  private readonly media = inject(MediaService);

  readonly dateTime = dateTime;
  readonly moneyIn = moneyIn;
  /** Código de la moneda base con la que se muestran los montos (USD por defecto). */
  readonly moneyBaseCode = displayBaseCode;
  /** Nombre de esa moneda: los equivalentes que pinta la pantalla van en ella. */
  readonly moneyBaseLabel = displayBaseLabel;
  readonly rate = rate;
  readonly baseCurrency = BASE_CURRENCY;
  /** Base de las imagenes locales `/media/...` (ver `environment.mediaUrl`). */
  readonly mediaUrl = resolveMediaUrl;
  /**
   * Cómo presenta la caja sus formularios (modal o panel lateral). El usuario lo
   * elige en Configuración → «Formularios de caja y pedidos».
   */
  readonly dialogView = this.preferences.dialogView;
  /** Monedas configuradas (para el filtro del historial). */
  readonly currencies = this.rates.currencies;
  /** Monedas habilitadas para cobrar/pagar (incluye la base). */
  readonly enabledCurrencies = this.rates.enabledCurrencies;

  readonly categoryLabels = CASH_CATEGORY_LABELS;
  /**
   * Categorias presentadas como tarjetas: la descripcion explica que implica
   * cada una y el grupo deja claro si el dinero entra o sale del cajon.
   */
  readonly categoryCards: CashCategoryCard[] = [
    {
      value: 'SALE',
      label: CASH_CATEGORY_LABELS['SALE'],
      hint: 'Cobro de una venta o pedido',
      icon: 'shopping-cart',
      group: 'IN',
    },
    {
      value: 'DEPOSIT',
      label: CASH_CATEGORY_LABELS['DEPOSIT'],
      hint: 'Efectivo que ingresa al cajón',
      icon: 'download',
      group: 'IN',
    },
    {
      value: 'EXPENSE',
      label: CASH_CATEGORY_LABELS['EXPENSE'],
      hint: 'Compra o gasto operativo',
      icon: 'receipt',
      group: 'OUT',
    },
    {
      value: 'WITHDRAWAL',
      label: CASH_CATEGORY_LABELS['WITHDRAWAL'],
      hint: 'Efectivo que sale del cajón',
      icon: 'upload',
      group: 'OUT',
    },
    {
      value: 'REFUND',
      label: CASH_CATEGORY_LABELS['REFUND'],
      hint: 'Reembolso a un cliente',
      icon: 'exchange',
      group: 'OUT',
    },
    {
      value: 'PAYMENT',
      label: CASH_CATEGORY_LABELS['PAYMENT'],
      hint: 'Abono a una cuenta por pagar',
      icon: 'building',
      group: 'OUT',
    },
    {
      value: 'ADJUSTMENT',
      label: CASH_CATEGORY_LABELS['ADJUSTMENT'],
      hint: 'Corrige el saldo de la caja',
      icon: 'settings',
      group: 'MANUAL',
    },
    {
      value: 'OTHER',
      label: CASH_CATEGORY_LABELS['OTHER'],
      hint: 'Otro ingreso o egreso manual',
      icon: 'info',
      group: 'MANUAL',
    },
  ];
  /** Categorias agrupadas por el efecto que tienen en el arqueo. */
  readonly categoryGroups: CashCategoryGroup[] = [
    {
      key: 'IN',
      title: 'Entradas',
      hint: 'El efectivo esperado sube.',
      items: this.categoryCards.filter((card) => card.group === 'IN'),
    },
    {
      key: 'OUT',
      title: 'Salidas',
      hint: 'El efectivo esperado baja.',
      items: this.categoryCards.filter((card) => card.group === 'OUT'),
    },
    {
      key: 'MANUAL',
      title: 'Movimientos manuales',
      hint: 'Elige tú si entra o sale dinero.',
      items: this.categoryCards.filter((card) => card.group === 'MANUAL'),
    },
  ];
  readonly methodLabels = PAYMENT_METHOD_LABELS;
  /**
   * Solo el efectivo mueve el cajón. Los demas metodos quedan registrados en el
   * arqueo por metodo, pero no cambian el efectivo esperado.
   */
  readonly methodCards: CashMethodCard[] = [
    { value: 'CASH', label: PAYMENT_METHOD_LABELS['CASH'], icon: 'money' },
    { value: 'CARD', label: PAYMENT_METHOD_LABELS['CARD'], icon: 'receipt' },
    {
      value: 'TRANSFER',
      label: PAYMENT_METHOD_LABELS['TRANSFER'],
      icon: 'exchange',
    },
    { value: 'YAPE', label: PAYMENT_METHOD_LABELS['YAPE'], icon: 'keypad' },
    { value: 'PLIN', label: PAYMENT_METHOD_LABELS['PLIN'], icon: 'keypad' },
    { value: 'CREDIT', label: PAYMENT_METHOD_LABELS['CREDIT'], icon: 'clock' },
    { value: 'MIXED', label: PAYMENT_METHOD_LABELS['MIXED'], icon: 'table' },
  ];
  readonly movementTypeOptions: { value: CashDirection; label: string; icon: string }[] = [
    { value: 'IN', label: 'Entrada', icon: 'trend-up' },
    { value: 'OUT', label: 'Salida', icon: 'trend-down' },
  ];
  /** Motivos sugeridos por categoria: aceleran la captura sin limitar el texto. */
  private readonly descriptionSuggestionsByCategory: Record<
    string,
    readonly string[]
  > = {
    SALE: ['Venta de mostrador', 'Cobro de pedido', 'Venta adicional'],
    DEPOSIT: ['Depósito de ventas', 'Fondo adicional', 'Reposición de cambio'],
    EXPENSE: [
      'Compra de insumos',
      'Servicios del local',
      'Mantenimiento',
      'Transporte',
    ],
    WITHDRAWAL: [
      'Retiro a banco',
      'Entrega a administración',
      'Pago a proveedor',
    ],
    REFUND: ['Devolución a cliente', 'Anulación de venta'],
    PAYMENT: ['Abono a proveedor', 'Pago de cuenta por pagar'],
    ADJUSTMENT: [
      'Corrección de arqueo',
      'Diferencia de cambio',
      'Error de registro',
    ],
    OTHER: ['Movimiento manual', 'Otro ingreso', 'Otro egreso'],
  };

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
  /** `true` mientras se comprime la foto del comprobante elegida. */
  readonly paymentPhotoBusy = signal(false);
  /** Maximo de partes de un pago mixto (igual que el limite del backend). */
  readonly maxMovementParts = 8;
  movForm: {
    category: CashCategory;
    type: 'IN' | 'OUT';
    paymentMethod: string;
    amount: number;
    currency: string;
    description: string;
    /** Partes del pago cuando el metodo es MIXED. */
    parts: CashMovementPartDraft[];
    /** Referencia bancaria del comprobante (transferencia / Yape / Plin). */
    paymentReference: string;
    /** Foto opcional del comprobante: URL local `/media/...` (multipart). */
    paymentPhotoUrl: string | null;
    /** Nombre del archivo elegido (solo se muestra en el formulario). */
    paymentPhotoName: string;
  } = {
    category: 'SALE',
    type: 'IN',
    paymentMethod: 'CASH',
    amount: 0,
    currency: BASE_CURRENCY.code as string,
    description: '',
    parts: [],
    paymentReference: '',
    paymentPhotoUrl: null,
    paymentPhotoName: '',
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

  /**
   * `true` mientras la recarga manual tiene alguna petición en vuelo: desactiva
   * el botón «Actualizar» para no lanzar la misma tanda dos veces.
   */
  readonly refreshing = computed(
    () =>
      this.loading() ||
      this.movLoading() ||
      this.sesLoading() ||
      this.rates.loading(),
  );

  /** Segundos que faltan para poder volver a actualizar la caja. */
  readonly refreshCooldown = signal(0);
  /** Momento de la última recarga manual, para mostrarlo en la cabecera. */
  readonly lastRefreshAt = signal<Date | null>(null);
  /** Hora local (con segundos) de la última recarga manual. */
  readonly lastRefreshTime = computed(() => {
    const at = this.lastRefreshAt();
    if (!at) return '';
    return new Intl.DateTimeFormat('es-PE', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(at);
  });
  /** Nombre accesible del botón: cambia con la recarga y el cooldown. */
  readonly refreshAriaLabel = computed(() => {
    if (this.refreshing()) return 'Actualizando datos de caja';
    const seconds = this.refreshCooldown();
    return seconds > 0
      ? `Actualizar datos de caja, disponible en ${seconds} segundos`
      : 'Actualizar datos de caja';
  });
  /** Tooltip del botón, útil sobre todo cuando está deshabilitado. */
  readonly refreshTitle = computed(() => {
    if (this.refreshing()) return 'Actualizando…';
    const seconds = this.refreshCooldown();
    return seconds > 0 ? `Espera ${seconds} s para volver a actualizar` : 'Actualizar datos de caja';
  });
  /** Deshabilita «Actualizar» mientras recarga o durante el cooldown. */
  readonly refreshDisabled = computed(
    () => this.refreshing() || this.refreshCooldown() > 0,
  );
  private refreshAvailableAt = 0;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

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

  ngOnDestroy(): void {
    this.clearRefreshTimer();
  }

  /**
   * Recarga en sitio todo lo que muestra la caja: tasas, sesión y arqueo,
   * movimientos e historial de sesiones. No toca filtros ni paginación, y evita
   * que el operador tenga que recargar la página completa. Solo se permite una
   * vez cada 10 segundos.
   *
   * Las tasas se piden sin `force`: el backend ya las cachea 15 minutos y no
   * tiene sentido consultar el BCV en cada clic.
   */
  refresh(): void {
    if (this.refreshDisabled()) return;
    this.rates.load();
    // La hora se marca cuando terminan las recargas de la caja, no al hacer clic.
    const settled = this.refreshSettled(3);
    this.load(settled);
    this.loadMovements(settled);
    this.loadSessions(settled);
    this.startRefreshCooldown();
  }

  /** Callback que marca `lastRefreshAt` cuando terminó la última recarga. */
  private refreshSettled(pending: number): () => void {
    let remaining = pending;
    return () => {
      remaining -= 1;
      if (remaining === 0) this.lastRefreshAt.set(new Date());
    };
  }

  /** Arranca la cuenta regresiva que bloquea el botón durante 10 segundos. */
  private startRefreshCooldown(): void {
    this.clearRefreshTimer();
    this.refreshAvailableAt = Date.now() + REFRESH_COOLDOWN_MS;
    this.refreshCooldown.set(Math.ceil(REFRESH_COOLDOWN_MS / 1000));
    this.refreshTimer = setInterval(() => {
      const remaining = this.refreshAvailableAt - Date.now();
      if (remaining <= 0) {
        this.clearRefreshTimer();
        this.refreshCooldown.set(0);
        return;
      }
      this.refreshCooldown.set(Math.ceil(remaining / 1000));
    }, 250);
  }

  private clearRefreshTimer(): void {
    if (!this.refreshTimer) return;
    clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }

  load(onSettled?: () => void): void {
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
        onSettled?.();
      },
      error: () => {
        this.session.set(null);
        this.summary.set(null);
        this.loading.set(false);
        onSettled?.();
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

  /** Dirección real del movimiento: la deduce la categoría salvo en los manuales. */
  get movementType(): CashDirection {
    if (this.needsManualType) return this.movForm.type;
    return CASH_IN_CATEGORIES.includes(this.movForm.category) ? 'IN' : 'OUT';
  }

  /** `true` cuando el movimiento se cobra con varias formas de pago. */
  get isMixedMovement(): boolean {
    return this.movForm.paymentMethod === 'MIXED';
  }

  /** Partes del pago mixto que realmente tienen monto. */
  get movementParts(): CashMovementPartDraft[] {
    return this.movForm.parts.filter((part) => (Number(part.amount) || 0) > 0);
  }

  /** Partes del pago mixto que se entregan en efectivo. */
  get movementCashPartCount(): number {
    return this.movementParts.filter((part) => part.method === 'CASH').length;
  }

  get movementAmount(): number {
    const amount = Number(this.movForm.amount);
    return Number.isFinite(amount) && amount > 0 ? amount : 0;
  }

  /** `true` si hay algo que registrar (monto simple o alguna parte del mixto). */
  get movementHasAmount(): boolean {
    return this.isMixedMovement
      ? this.movementParts.length > 0
      : this.movementAmount > 0;
  }

  /**
   * Equivalente del movimiento en la moneda base contable (USD).
   * En un pago mixto es la suma de todas las partes, cada una convertida desde
   * su propia moneda.
   */
  get movementBase(): number | null {
    if (this.isMixedMovement) return this.movementPartsBase;
    if (this.movementAmount <= 0) return 0;
    return this.rates.toBase(
      this.movementAmount,
      this.movForm.currency,
      BCV_USD_RATE_KEY,
    );
  }

  /** Total del pago mixto en la moneda base (USD). */
  get movementPartsBase(): number | null {
    const parts = this.movementParts;
    if (parts.length === 0) return 0;

    let total = 0;
    for (const part of parts) {
      const base = this.movementPartBase(part);
      if (base == null) return null;
      total = sumMoney([total, base]);
    }
    return total;
  }

  /** Equivalente en USD de una parte del pago mixto. */
  movementPartBase(part: CashMovementPartDraft): number | null {
    const amount = Number(part.amount) || 0;
    if (amount <= 0) return 0;
    return this.rates.toBase(amount, part.currency, BCV_USD_RATE_KEY);
  }

  /** Equivalente de una parte en la moneda de visualización. */
  movementPartBaseText(part: CashMovementPartDraft): string {
    const base = this.movementPartBase(part);
    if (base == null) return 'Sin tasa disponible';
    const display = this.aggregateDisplay(base);
    return this.moneyIn(display == null ? base : display, displayBaseCode());
  }

  /**
   * Efecto del movimiento sobre el efectivo del cajón, en moneda base.
   * En un pago mixto solo cuentan las partes cobradas en efectivo.
   */
  get movementCashBase(): number | null {
    if (!this.isMixedMovement) {
      return this.movementAffectsCash ? this.movementBase : 0;
    }

    const cashParts = this.movementParts.filter((part) => part.method === 'CASH');
    if (cashParts.length === 0) return 0;

    let total = 0;
    for (const part of cashParts) {
      const base = this.movementPartBase(part);
      if (base == null) return null;
      total = sumMoney([total, base]);
    }
    return total;
  }

  /** Efecto firmado del movimiento sobre el arqueo, en la moneda base. */
  get movementSignedBase(): number | null {
    if (!this.movementAffectsCash) return 0;
    const base = this.movementCashBase;
    if (base == null) return null;
    return this.movementType === 'IN' ? base : -base;
  }

  /** Efectivo esperado después de registrar el movimiento, en moneda base. */
  get expectedAfterBase(): number {
    const signed = this.movementSignedBase;
    return signed == null ? this.expectedCash : this.expectedCash + signed;
  }

  /** Efectivo esperado después del movimiento, en la moneda de visualización. */
  get expectedAfterDisplay(): number | null {
    return this.aggregateDisplay(this.expectedAfterBase);
  }

  /** Efecto del movimiento en la moneda de visualización. */
  get movementAmountDisplay(): number | null {
    if (this.isMixedMovement) {
      const base = this.movementBase;
      if (base == null) return null;
      const display = this.aggregateDisplay(base);
      if (display == null) return null;
      return this.movementType === 'IN' ? display : -display;
    }

    const signed =
      this.movementType === 'IN' ? this.movementAmount : -this.movementAmount;
    return this.toDisplay(signed, this.movForm.currency);
  }

  /** Monto con signo, listo para el resumen. */
  get movementAmountText(): string {
    if (this.isMixedMovement) {
      if (this.movementParts.length === 0) return '—';
      const display = this.movementAmountDisplay;
      if (display == null) return '—';
      return `${this.movementType === 'IN' ? '+' : '−'} ${this.moneyIn(
        Math.abs(display),
        displayBaseCode(),
      )}`;
    }

    if (this.movementAmount <= 0) return '—';
    return `${this.movementType === 'IN' ? '+' : '−'} ${this.moneyIn(
      this.movementAmount,
      this.movForm.currency,
    )}`;
  }

  /** Detalle del monto (equivalente, pagos o moneda original). */
  get movementBaseText(): string {
    if (this.isMixedMovement) {
      const count = this.movementParts.length;
      if (count === 0) return 'Agrega al menos un pago';
      const cash = this.movementCashPartCount;
      return `${count} ${count === 1 ? 'pago' : 'pagos'} · ${
        cash > 0 ? `${cash} en efectivo` : 'sin efectivo'
      }`;
    }

    const display = this.movementAmountDisplay;
    if (display == null) return 'Sin tasa disponible';
    return `${this.movementType === 'IN' ? '+' : '−'} ${this.moneyIn(
      Math.abs(display),
      displayBaseCode(),
    )}`;
  }

  /** `true` si alguna parte del movimiento mueve el efectivo del cajón. */
  get movementAffectsCash(): boolean {
    if (this.isMixedMovement) {
      return this.movementParts.some((part) => part.method === 'CASH');
    }
    return this.movForm.paymentMethod === 'CASH';
  }

  /** `true` si el movimiento exige referencia bancaria (transferencia/Yape/Plin). */
  get movementNeedsProof(): boolean {
    if (this.isMixedMovement) {
      return this.movementParts.some((part) => needsPaymentProof(part.method));
    }
    return needsPaymentProof(this.movForm.paymentMethod);
  }

  /** Monedas del movimiento que no tienen tasa configurada. */
  get movementMissingRates(): string[] {
    const codes = this.isMixedMovement
      ? this.movementParts.map((part) => part.currency)
      : this.movementAmount > 0
        ? [this.movForm.currency]
        : [];
    return Array.from(new Set(codes)).filter(
      (code) => this.rates.toBase(1, code, BCV_USD_RATE_KEY) === null,
    );
  }

  get movementStatus(): { label: string; classes: string } {
    return this.movementType === 'IN'
      ? { label: 'Entrada', classes: 'bg-emerald-100 text-emerald-700' }
      : { label: 'Salida', classes: 'bg-rose-100 text-rose-700' };
  }

  get movementSubmitLabel(): string {
    return this.movementType === 'IN' ? 'Registrar entrada' : 'Registrar salida';
  }

  /** Motivos frecuentes de la categoría elegida. */
  get descriptionSuggestions(): readonly string[] {
    return this.descriptionSuggestionsByCategory[this.movForm.category] ?? [];
  }

  get paymentMethodHint(): string {
    if (this.isMixedMovement) {
      return this.movementAffectsCash
        ? 'Solo la parte en efectivo actualiza el cajón; el resto queda en el arqueo por método.'
        : 'Ninguna parte es en efectivo: el cajón no cambia y todo queda en el arqueo por método.';
    }
    if (this.movementAffectsCash) {
      return 'El efectivo del cajón se actualiza al registrar el movimiento.';
    }
    const label =
      PAYMENT_METHOD_LABELS[this.movForm.paymentMethod] ??
      this.movForm.paymentMethod;
    return `${label} no mueve el efectivo del cajón: queda registrado en el arqueo por método.`;
  }

  /** Error que impide registrar el movimiento; `null` si todo está correcto. */
  get movementError(): string | null {
    if (this.paymentPhotoBusy()) {
      return 'Espera a que termine de procesarse la foto del comprobante.';
    }

    if (this.isMixedMovement) {
      if (this.movForm.parts.some((part) => Number(part.amount) < 0)) {
        return 'Los montos de las partes no pueden ser negativos.';
      }
      if (this.movementParts.length === 0) {
        return 'Agrega al menos una forma de pago con monto.';
      }
      if (this.movementMissingRates.length > 0) {
        return `No hay tasa configurada para ${this.movementMissingRates.join(
          ', ',
        )}. Configúrala en Configuración → Monedas.`;
      }
    } else {
      if (!(this.movementAmount > 0)) {
        return 'Indica un monto mayor a 0.';
      }
      if (this.movementBase == null) {
        return `No hay tasa configurada para ${this.movForm.currency}. Configúrala en Configuración → Monedas.`;
      }
    }

    if (
      this.movementNeedsProof &&
      !/^\d{4,6}$/.test(this.movForm.paymentReference.trim())
    ) {
      return 'Escribe la referencia del comprobante: de 4 a 6 dígitos.';
    }

    const cashBase = this.movementCashBase;
    if (
      this.movementAffectsCash &&
      this.movementType === 'OUT' &&
      cashBase != null &&
      cashBase > Math.max(this.expectedCash, 0) + 0.005
    ) {
      const available = this.aggregateDisplay(Math.max(this.expectedCash, 0));
      const amount =
        available == null ? '0' : this.moneyIn(available, displayBaseCode());
      return `La salida en efectivo supera lo disponible en caja (${amount}). Ajusta el monto o registra el movimiento con otro método.`;
    }
    return null;
  }

  get canSubmitMovement(): boolean {
    return !this.saving() && this.movementError === null;
  }

  /** Texto de apoyo del pie del formulario. */
  get movementFooterHint(): string {
    if (this.saving()) return 'Registrando movimiento…';
    if (this.movementError) return this.movementError;
    if (!this.movementAffectsCash) {
      return 'Se guardará como referencia; el efectivo del cajón no cambia.';
    }
    const after = this.expectedAfterDisplay;
    return after == null
      ? 'Se actualizará el efectivo esperado del cajón.'
      : `Caja después del movimiento: ${this.moneyIn(
          after,
          displayBaseCode(),
        )}.`;
  }

  categoryCardClass(card: CashCategoryCard): string {
    const base =
      'flex w-full items-start gap-2 rounded-xl border p-2.5 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400';
    if (this.movForm.category !== card.value) {
      return `${base} border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50`;
    }
    if (card.group === 'IN') {
      return `${base} border-emerald-300 bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200`;
    }
    if (card.group === 'OUT') {
      return `${base} border-rose-300 bg-rose-50 text-rose-800 ring-1 ring-rose-200`;
    }
    return `${base} border-sky-300 bg-sky-50 text-sky-800 ring-1 ring-sky-200`;
  }

  typeCardClass(type: CashDirection): string {
    const base =
      'flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400';
    if (this.movForm.type !== type) {
      return `${base} border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50`;
    }
    return type === 'IN'
      ? `${base} border-emerald-300 bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200`
      : `${base} border-rose-300 bg-rose-50 text-rose-700 ring-1 ring-rose-200`;
  }

  methodCardClass(method: string): string {
    const base =
      'flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400';
    return this.movForm.paymentMethod === method
      ? `${base} border-brand-300 bg-brand-50 text-brand-700 ring-1 ring-brand-200`
      : `${base} border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50`;
  }

  selectCategory(category: CashCategory): void {
    this.movForm.category = category;
    this.onCategoryChange();
  }

  setMovementType(type: CashDirection): void {
    this.movForm.type = type;
  }

  setPaymentMethod(method: string): void {
    const previous = this.movForm.paymentMethod;
    if (previous === method) return;
    this.movForm.paymentMethod = method;

    if (method === 'MIXED') {
      // Se arranca con una parte por el monto que ya estaba escrito: en la
      // mayoria de los casos el cajero solo agrega la segunda forma de pago.
      if (this.movForm.parts.length === 0) {
        const amount = this.movementAmount;
        this.movForm.parts = [
          {
            method: 'CASH',
            currency: this.movForm.currency || BASE_CURRENCY.code,
            amount: amount > 0 ? amount : 0,
          },
        ];
      }
      return;
    }

    // Al volver a un pago simple se conserva la primera parte como monto y
    // moneda del movimiento; el resto del desglose queda descartado.
    if (previous === 'MIXED') {
      const first = this.movForm.parts[0];
      if (first) {
        this.movForm.amount = Number(first.amount) || 0;
        this.movForm.currency = first.currency || this.movForm.currency;
      }
    }
  }

  /** Agrega una parte al pago mixto (hasta el limite del backend). */
  addMovementPart(): void {
    if (this.movForm.parts.length >= this.maxMovementParts) {
      this.toast.error(
        `Un pago mixto admite hasta ${this.maxMovementParts} partes.`,
      );
      return;
    }
    const previous = this.movForm.parts[this.movForm.parts.length - 1];
    this.movForm.parts = [
      ...this.movForm.parts,
      {
        method: 'CASH',
        currency: previous?.currency || this.movForm.currency || BASE_CURRENCY.code,
        amount: 0,
      },
    ];
  }

  /** Quita una parte del pago mixto (siempre queda al menos una). */
  removeMovementPart(index: number): void {
    if (this.movForm.parts.length <= 1) return;
    this.movForm.parts = this.movForm.parts.filter((_, i) => i !== index);
  }

  /** La referencia bancaria solo admite digitos (4 a 6). */
  onPaymentReferenceChange(value: string): void {
    this.movForm.paymentReference = String(value ?? '')
      .replace(/\D/g, '')
      .slice(0, 6);
  }

  /** Comprime y sube la foto del comprobante elegida. */
  async onPaymentPhotoSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Permite volver a elegir el mismo archivo despues de quitarlo.
    input.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      this.toast.error('El comprobante debe ser una imagen (JPG, PNG o WebP).');
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      this.toast.error('La foto del comprobante no puede superar los 12 MB.');
      return;
    }

    this.paymentPhotoBusy.set(true);
    try {
      const image = await toPaymentProofFile(file);
      const uploaded = await firstValueFrom(
        this.media.upload(image, 'payments', file.name),
      );
      this.movForm.paymentPhotoUrl = uploaded.url;
      this.movForm.paymentPhotoName = file.name;
    } catch {
      this.toast.error('No se pudo subir la foto del comprobante.');
      this.movForm.paymentPhotoUrl = null;
      this.movForm.paymentPhotoName = '';
    } finally {
      this.paymentPhotoBusy.set(false);
    }
  }

  /** Quita la foto del comprobante (la referencia se conserva). */
  removePaymentPhoto(): void {
    this.movForm.paymentPhotoUrl = null;
    this.movForm.paymentPhotoName = '';
  }

  /** Marca o desmarca un motivo sugerido sin pisar un texto libre. */
  toggleDescription(suggestion: string): void {
    this.movForm.description =
      this.movForm.description === suggestion ? '' : suggestion;
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
      parts: [],
      paymentReference: '',
      paymentPhotoUrl: null,
      paymentPhotoName: '',
    };
    this.movOpen.set(true);
  }

  closeMovement(): void {
    this.movOpen.set(false);
  }

  submitMovement(): void {
    if (this.saving()) return;
    const error = this.movementError;
    if (error) {
      this.toast.error(error);
      return;
    }
    this.saving.set(true);

    const payload: CashMovementPayload = {
      category: this.movForm.category,
      description: this.movForm.description || undefined,
    };
    if (this.needsManualType) payload.type = this.movForm.type;

    // El comprobante viaja una sola vez: el backend lo adjunta a las partes que
    // se cobran por transferencia / Yape / Plin.
    if (this.movementNeedsProof) {
      payload.paymentReference = this.movForm.paymentReference.trim();
      if (this.movForm.paymentPhotoUrl) {
        payload.paymentPhotoUrl = this.movForm.paymentPhotoUrl;
      }
    }

    if (this.isMixedMovement) {
      payload.paymentMethod = 'MIXED';
      payload.parts = this.movementParts.map((part) => ({
        paymentMethod:
          part.method as CashMovementPartPayload['paymentMethod'],
        amount: Number(part.amount),
        currency: part.currency || undefined,
      }));
    } else {
      payload.paymentMethod =
        this.movForm.paymentMethod as CashMovementPayload['paymentMethod'];
      payload.amount = this.movementAmount;
      payload.currency = this.movForm.currency || undefined;
    }

    this.cash.addMovement(payload).subscribe({
      next: () => {
        this.saving.set(false);
        this.toast.success(
          this.isMixedMovement
            ? 'Movimiento mixto registrado'
            : 'Movimiento registrado',
        );
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

  loadMovements(onSettled?: () => void): void {
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
          onSettled?.();
        },
        error: () => {
          this.movLoading.set(false);
          onSettled?.();
        },
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

  loadSessions(onSettled?: () => void): void {
    this.sesLoading.set(true);
    this.cash.sessions({ page: this.sesPage, limit: this.sesLimit }).subscribe({
      next: (response) => {
        this.sesItems.set(response.items);
        this.sesMeta.set(response.meta);
        this.sesLoading.set(false);
        onSettled?.();
      },
      error: () => {
        this.sesLoading.set(false);
        onSettled?.();
      },
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
