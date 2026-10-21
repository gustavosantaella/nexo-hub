import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { Customer, MenuOption, PaginationMeta, ProductOption } from '../../core/models/api.model';
import type {
  Order,
  OrderItem,
  OrderPayment,
  OrderStatus,
  OrderType,
  PaymentMethod,
  PaymentStatus,
  SalePriceBreakdown,
} from '../../core/models/operations.model';
import type { RateKey } from '../../core/models/rates.model';
import {
  ORDER_STATUS_CLASSES,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_OPTIONS,
  ORDER_TYPE_LABELS,
  ORDER_TYPE_OPTIONS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHOD_OPTIONS,
  PAYMENT_STATUS_CLASSES,
  PAYMENT_STATUS_LABELS,
} from '../../core/constants/domain';
import { BASE_CURRENCY, CHARGE_RATE_KEY, RATE_META, type RateMeta } from '../../core/constants/currency';
import { AuthService } from '../../core/services/auth.service';
import { CashService } from '../../core/services/cash.service';
import { CustomersService, ProductsService } from '../../core/services/catalog.service';
import { MenusService } from '../../core/services/menu.service';
import { OrdersService } from '../../core/services/orders.service';
import { RatesService } from '../../core/services/rates.service';
import { ToastService } from '../../core/services/toast.service';
import { CurrencySelectComponent } from '../../shared/components/currency-select.component';
import {
  apiErrorMessage,
  dateTime,
  displayBaseCode,
  money,
  moneyIn,
  mulMoney,
  payableAmount,
  rate,
  sumMoney,
} from '../../core/utils/format';
import {
  menuStockLabel,
  menuTitle,
  menuUnavailableReason,
} from '../../core/utils/menu-availability';
import {
  boxUnitsOf,
  isBoxProduct,
  soldUnitLabel,
  unitPriceOf,
} from '../../core/utils/product-pricing';
import { DialogComponent } from '../../shared/components/dialog.component';
import { EmptyStateComponent, LoaderComponent } from '../../shared/components/feedback.component';
import { IconComponent } from '../../shared/components/icon.component';
import { MoneyComponent } from '../../shared/components/money.component';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { PaginationComponent } from '../../shared/components/pagination.component';
import { RateConversionsComponent } from '../../shared/components/rate-conversions.component';
import { PreferencesService, TIP_PERCENT_PRESETS } from '../../core/services/preferences.service';
import { ConfirmService } from '../../shared/services/confirm.service';
import type { CashSession } from '../../core/models/operations.model';

interface OrderLine {
  /** Producto del inventario vendido (`null` cuando la línea es un menú). */
  productId: string | null;
  /** Menú (plato/combo) vendido (`null` cuando es un producto suelto). */
  menuId: string | null;
  name: string;
  /**
   * Precio de UNA unidad de inventario: el unitario del catálogo y, si el
   * operador no lo definió, el repartido del precio de la presentación.
   */
  unitPrice: number;
  /** Cantidad en unidades individuales del inventario. */
  quantity: number;
  /**
   * Unidades disponibles en inventario; en un menú, las porciones que alcanzan
   * con el stock de sus ingredientes (0 = sin tope conocido).
   */
  stock: number;
  /** Unidad que se cobra (`UND` en productos por caja). */
  unit: string;
  /** Unidades que trae la presentación (1 = producto suelto). */
  unitsPerBox: number;
}

/** Campos del desglose congelado del pedido (`Order.priceBreakdown`). */
type SalePriceField = keyof SalePriceBreakdown;

const EMPTY_META: PaginationMeta = {
  total: 0,
  page: 1,
  limit: 20,
  totalPages: 0,
  hasNextPage: false,
  hasPreviousPage: false,
};

const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  PENDING: 'CONFIRMED',
  CONFIRMED: 'PREPARING',
  PREPARING: 'READY',
  READY: 'COMPLETED',
};

/** Pagina de pedidos: tablero operativo + historial de ventas. */
@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    IconComponent,
    PageHeaderComponent,
    PaginationComponent,
    DialogComponent,
    MoneyComponent,
    CurrencySelectComponent,
    RateConversionsComponent,
    EmptyStateComponent,
    LoaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './orders.page.html',
})
export class OrdersPage implements OnInit {
  readonly auth = inject(AuthService);
  private readonly orders = inject(OrdersService);
  private readonly cash = inject(CashService);
  private readonly rates = inject(RatesService);
  private readonly productsService = inject(ProductsService);
  private readonly menusService = inject(MenusService);
  private readonly customersService = inject(CustomersService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly preferences = inject(PreferencesService);

  /**
   * Presentación de los formularios (ventana modal o panel lateral), según la
   * preferencia de la empresa en Configuración.
   */
  readonly dialogView = this.preferences.dialogView;

  readonly dateTime = dateTime;
  /** Formato de montos para los textos del catalogo de productos (tooltips). */
  readonly money = money;
  /** Presentación del producto: precio por unidad suelta y unidad que se cobra. */
  readonly unitPriceOf = unitPriceOf;
  readonly soldUnitLabel = soldUnitLabel;
  readonly boxUnitsOf = boxUnitsOf;
  readonly isBoxProduct = isBoxProduct;
  readonly baseCurrency = BASE_CURRENCY;
  /**
   * Moneda con la que se están mostrando los montos: la que eligió el admin para
   * el cajero (Configuración → Cajero) o la base de la empresa. Los bloques de
   * tasas de cada total se calculan sobre lo que se lee en la pantalla, no sobre
   * los dólares guardados.
   */
  readonly moneyBaseCode = displayBaseCode;
  /** Disponibilidad de la carta: porciones, agotado o receta con insumo inactivo. */
  readonly menuStockLabel = menuStockLabel;
  readonly menuTitle = menuTitle;
  readonly menuUnavailableReason = menuUnavailableReason;
  readonly statusLabels = ORDER_STATUS_LABELS;
  readonly statusClasses = ORDER_STATUS_CLASSES;
  readonly typeLabels = ORDER_TYPE_LABELS;
  readonly paymentStatusLabels = PAYMENT_STATUS_LABELS;
  readonly paymentStatusClasses = PAYMENT_STATUS_CLASSES;
  readonly statusOptions = ORDER_STATUS_OPTIONS;
  readonly typeOptions = ORDER_TYPE_OPTIONS;
  readonly paymentStatusOptions = Object.entries(PAYMENT_STATUS_LABELS).map(
    ([value, label]) => ({ value: value as PaymentStatus, label }),
  );
  /**
   * Metodos del cobro simple de esta pantalla. El pago **mixto** se captura en la
   * vista de cajero (POS), donde se desglosa por metodo/moneda y se registra el
   * vuelto; aqui se evita ofrecerlo sin ese desglose.
   */
  readonly paymentMethodOptions = PAYMENT_METHOD_OPTIONS.filter(
    (option) => option.value !== 'MIXED',
  );
  readonly methodLabels = PAYMENT_METHOD_LABELS;

  readonly tab = signal<'board' | 'history'>('board');
  readonly activeTabClass = 'border-b-2 border-brand-600 text-brand-700';
  readonly inactiveTabClass =
    'border-b-2 border-transparent text-slate-500 hover:text-slate-700';

  readonly board = signal<Order[]>([]);
  readonly boardLoading = signal(false);
  readonly cashOpen = signal(false);

  readonly items = signal<Order[]>([]);
  readonly meta = signal<PaginationMeta>(EMPTY_META);
  readonly loading = signal(false);

  fStatus = '';
  fPaymentStatus = '';
  fType = '';
  fSearch = '';
  fFrom = '';
  fTo = '';
  private page = 1;
  private limit = 20;

  readonly createOpen = signal(false);
  readonly saving = signal(false);
  readonly customers = signal<Customer[]>([]);
  readonly products = signal<ProductOption[]>([]);
  readonly menus = signal<MenuOption[]>([]);
  readonly lines = signal<OrderLine[]>([]);
  readonly formError = signal<string | null>(null);
  /** Buscador del POS (nombre o SKU/código). Enter agrega la primera coincidencia. */
  productSearch = '';
  /** Catálogo que muestra el buscador: productos sueltos o menús. */
  readonly lineKind = signal<'products' | 'menus'>('products');
  /** Oculta de la grilla rapida los productos agotados. */
  onlyAvailable = true;
  /** Cobro inmediato al crear el pedido (venta de mostrador). */
  chargeNow = true;
  chargeMethod: PaymentMethod = 'CASH';
  /** Moneda en la que se cobra la venta de mostrador. */
  chargeCurrency: string = BASE_CURRENCY.code;
  /** Efectivo entregado por el cliente (en `chargeCurrency`). */
  receivedAmount = 0;
  /**
   * **Tasa de cobro**: siempre la oficial del BCV. La tasa personalizada solo
   * define el precio de vitrina en bolívares y nunca se usa para cobrar.
   */
  readonly chargeRateKey = () => CHARGE_RATE_KEY;
  readonly taxRatePresets = [0, 10, 18];
  /** Propinas de atajo del formulario (0 % = sin propina). */
  readonly tipRatePresets = TIP_PERCENT_PRESETS;
  form = {
    customerId: '',
    type: 'DINE_IN' as OrderType,
    tableNumber: '',
    notes: '',
    discount: 0,
    taxRate: 0,
    /** Propina en porcentaje sobre el neto (opcional). */
    tipRate: 0,
    /** Costo de delivery escrito en `deliveryFeeCurrency` (solo pedidos a domicilio). */
    deliveryFee: 0,
    /** Moneda del costo de delivery (los formularios lo capturan en USD). */
    deliveryFeeCurrency: BASE_CURRENCY.code as string,
  };

  readonly detailOpen = signal(false);
  readonly detailOrder = signal<Order | null>(null);

  /** "Agregar productos" a un pedido existente (reutiliza el buscador y el carrito `lines` del POS). */
  readonly addOpen = signal(false);
  readonly addOrder = signal<Order | null>(null);
  /** Item del detalle que se esta guardando (bloquea clicks dobles en esa linea). */
  readonly itemBusyId = signal<string | null>(null);

  readonly payOpen = signal(false);
  readonly payOrder = signal<Order | null>(null);
  payForm = {
    amount: 0,
    method: 'CASH' as PaymentMethod,
    currency: BASE_CURRENCY.code as string,
    note: '',
    received: 0,
  };

  /** Cancelación de un cajero: espera el OTP que recibió el administrador. */
  readonly cancelOpen = signal(false);
  readonly cancelOrder = signal<Order | null>(null);
  readonly cancelCode = signal('');
  readonly cancelSending = signal(false);
  readonly cancelExpiresAt = signal<string | null>(null);
  readonly cancelRequesting = signal(false);

  ngOnInit(): void {
    this.loadCash();
    this.loadBoard();
    this.load();
  }

  private loadCash(): void {
    this.cash.current().subscribe({
      next: (response) => {
        const session =
          response && 'status' in response
            ? (response as CashSession)
            : ((response as { session?: CashSession | null } | null)?.session ?? null);
        this.cashOpen.set(session?.status === 'OPEN');
      },
      error: () => this.cashOpen.set(false),
    });
  }

  loadBoard(): void {
    this.boardLoading.set(true);
    this.orders.active().subscribe({
      next: (list) => {
        this.board.set(list);
        this.boardLoading.set(false);
      },
      error: () => this.boardLoading.set(false),
    });
  }

  nextStatus(status: OrderStatus): OrderStatus | null {
    return NEXT_STATUS[status] ?? null;
  }

  load(): void {
    this.loading.set(true);
    this.orders
      .list({
        page: this.page,
        limit: this.limit,
        status: this.fStatus || undefined,
        paymentStatus: this.fPaymentStatus || undefined,
        type: this.fType || undefined,
        search: this.fSearch || undefined,
        from: this.fFrom || undefined,
        to: this.fTo || undefined,
      })
      .subscribe({
        next: (response) => {
          this.items.set(response.items);
          this.meta.set(response.meta);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  applyFilters(): void {
    this.page = 1;
    this.load();
  }

  clearFilters(): void {
    this.fStatus = '';
    this.fPaymentStatus = '';
    this.fType = '';
    this.fSearch = '';
    this.fFrom = '';
    this.fTo = '';
    this.applyFilters();
  }

  changePage(page: number): void {
    this.page = page;
    this.load();
  }

  changeLimit(limit: number): void {
    this.limit = limit;
    this.page = 1;
    this.load();
  }

  private reload(): void {
    this.loadBoard();
    this.load();
    this.loadCash();
  }

  advance(order: Order): void {
    const next = this.nextStatus(order.status);
    if (!next) return;
    this.orders.updateStatus(order.id, next).subscribe({
      next: () => {
        this.toast.success(`Pedido ${order.code} → ${ORDER_STATUS_LABELS[next]}`);
        this.reload();
      },
    });
  }

  async cancel(order: Order): Promise<void> {
    const cashier = this.auth.role() === 'CASHIER';
    const confirmed = await this.confirm.ask({
      title: 'Cancelar pedido',
      message: cashier
        ? `¿Cancelar el pedido ${order.code}? Se enviará un código al administrador por Telegram y deberás escribirlo para confirmar.`
        : `¿Cancelar el pedido ${order.code}? Esta acción no se puede revertir.`,
      confirmLabel: cashier ? 'Solicitar código' : 'Cancelar pedido',
      tone: 'danger',
    });
    if (!confirmed) return;

    if (cashier) {
      this.requestCancellationCode(order);
      return;
    }

    this.orders.updateStatus(order.id, 'CANCELLED').subscribe({
      next: () => {
        this.toast.success(`Pedido ${order.code} cancelado`);
        this.reload();
      },
    });
  }

  /** Envía al administrador el OTP y abre el formulario para escribirlo. */
  private requestCancellationCode(order: Order): void {
    if (this.cancelRequesting()) return;
    this.cancelRequesting.set(true);
    this.orders.requestCancellationOtp(order.id).subscribe({
      next: (response) => {
        this.cancelRequesting.set(false);
        this.cancelOrder.set(order);
        this.cancelCode.set('');
        this.cancelExpiresAt.set(response.expiresAt);
        this.cancelOpen.set(true);
        this.toast.success(
          'El administrador recibió el código por Telegram.',
          'Código enviado',
        );
      },
      error: () => this.cancelRequesting.set(false),
    });
  }

  /** Fuerza mayúsculas y descarta lo que no sea letra (el OTP es de 8 letras). */
  setCancelCode(value: string): void {
    this.cancelCode.set(
      String(value ?? '')
        .toUpperCase()
        .replace(/[^A-Z]/g, '')
        .slice(0, 8),
    );
  }

  submitCancellation(): void {
    const order = this.cancelOrder();
    const code = this.cancelCode();
    if (!order || code.length !== 8 || this.cancelSending()) return;

    this.cancelSending.set(true);
    this.orders.updateStatus(order.id, 'CANCELLED', code).subscribe({
      next: () => {
        this.cancelSending.set(false);
        this.closeCancellation();
        this.toast.success(`Pedido ${order.code} cancelado y stock devuelto`);
        this.reload();
      },
      error: () => this.cancelSending.set(false),
    });
  }

  resendCancellationCode(): void {
    const order = this.cancelOrder();
    if (order) this.requestCancellationCode(order);
  }

  closeCancellation(): void {
    if (this.cancelSending()) return;
    this.cancelOpen.set(false);
    this.cancelOrder.set(null);
    this.cancelCode.set('');
    this.cancelExpiresAt.set(null);
  }

  async remove(order: Order): Promise<void> {
    const confirmed = await this.confirm.ask({
      title: 'Eliminar pedido',
      message: `¿Eliminar el pedido ${order.code}?`,
      confirmLabel: 'Eliminar',
      tone: 'danger',
    });
    if (!confirmed) return;
    this.orders.remove(order.id).subscribe({
      next: () => {
        this.toast.success('Pedido eliminado');
        this.reload();
      },
    });
  }

  openDetail(order: Order): void {
    this.detailOrder.set(order);
    this.detailOpen.set(true);
    this.orders.get(order.id).subscribe({
      next: (detail) => this.detailOrder.set(detail),
    });
  }

  closeDetail(): void {
    this.detailOpen.set(false);
    this.detailOrder.set(null);
  }

  /** `true` mientras el pedido admita seguir agregando productos. */
  canAddItems(order: Order): boolean {
    return order.status !== 'COMPLETED' && order.status !== 'CANCELLED';
  }

  /** Abre "Agregar productos" reutilizando el buscador y el carrito del POS. */
  openAdd(order: Order): void {
    this.addOrder.set(order);
    this.lines.set([]);
    this.productSearch = '';
    this.onlyAvailable = true;
    this.formError.set(null);
    if (this.products().length === 0) {
      this.productsService.options().subscribe({
        next: (list) => this.products.set(list),
      });
    }
    if (this.menus().length === 0) {
      this.menusService.options().subscribe({
        next: (list) => this.menus.set(list),
        error: () => this.menus.set([]),
      });
    }
    this.addOpen.set(true);
  }

  closeAdd(): void {
    this.addOpen.set(false);
    this.addOrder.set(null);
    this.lines.set([]);
    this.formError.set(null);
  }

  /** Envia los productos nuevos; el backend los fusiona con las lineas del pedido. */
  submitAdd(): void {
    const order = this.addOrder();
    if (!order || this.saving()) return;
    if (this.lines().length === 0) {
      this.formError.set('Agrega al menos un producto.');
      return;
    }
    if (this.lines().some((line) => line.quantity < 1 || line.unitPrice < 0)) {
      this.formError.set('Revisa las cantidades y precios de las lineas.');
      return;
    }
    if (this.stockIssues.length > 0) {
      this.formError.set('Hay lineas con cantidad mayor al stock disponible.');
      return;
    }

    this.saving.set(true);
    this.formError.set(null);
    this.orders
      .addItems(
        order.id,
        this.lines().map((line) => ({
          ...(line.productId ? { productId: line.productId } : {}),
          ...(line.menuId ? { menuId: line.menuId } : {}),
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        })),
      )
      .subscribe({
        next: (updated) => {
          this.saving.set(false);
          this.toast.success(`Productos agregados al pedido ${updated.code}`);
          this.closeAdd();
          this.reload();
          // Si el detalle sigue abierto, se refresca con los totales nuevos.
          if (this.detailOpen()) {
            this.orders.get(updated.id).subscribe({
              next: (detail) => this.detailOrder.set(detail),
            });
          }
        },
        error: (error) => {
          this.saving.set(false);
          this.formError.set(apiErrorMessage(error));
        },
      });
  }

  /**
   * Corrige la cantidad de una linea del detalle (error de captura). El backend
   * ajusta el stock por la diferencia y devuelve el pedido con los totales ya
   * recalculados.
   */
  changeItemQuantity(order: Order, item: OrderItem, quantity: number): void {
    if (this.itemBusyId()) return;
    if (quantity < 1 || quantity === item.quantity) return;
    this.itemBusyId.set(item.id);
    this.orders.updateItem(order.id, item.id, quantity).subscribe({
      next: (updated) => {
        this.itemBusyId.set(null);
        this.detailOrder.set(updated);
        this.reload();
      },
      error: (error) => {
        this.itemBusyId.set(null);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  /** Quita un producto del pedido devolviendo su stock al inventario. */
  async removeItem(order: Order, item: OrderItem): Promise<void> {
    const confirmed = await this.confirm.ask({
      title: 'Quitar producto',
      message: `¿Quitar "${item.name}" del pedido ${order.code}? El stock vuelve al inventario.`,
      confirmLabel: 'Quitar',
      tone: 'danger',
    });
    if (!confirmed) return;

    this.itemBusyId.set(item.id);
    this.orders.removeItem(order.id, item.id).subscribe({
      next: (updated) => {
        this.itemBusyId.set(null);
        this.detailOrder.set(updated);
        this.toast.success(`"${item.name}" quitado del pedido`);
        this.reload();
      },
      error: (error) => {
        this.itemBusyId.set(null);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  balance(order: Order): number {
    return sumMoney([order.total, -order.paidAmount]);
  }

  /**
   * Saldo pendiente expresado en la moneda indicada, con la **tasa de cobro** de la
   * empresa: es el precio que el cajero lee en pantalla pasado a la moneda con la
   * que paga el cliente.
   */
  balanceIn(currency: string): number {
    const order = this.payOrder();
    const balance = order ? this.balance(order) : 0;
    return this.rates.chargeAmount(balance, currency);
  }

  /** Saldo pendiente tal como se lee en pantalla, a la tasa oficial del BCV. */
  get payDisplayBalance(): number {
    const order = this.payOrder();
    return order
      ? this.rates.chargeAmount(this.balance(order), displayBaseCode())
      : 0;
  }

  /**
   * Monto expresado en la moneda con la que se están mostrando los montos: lo que
   * necesitan los bloques de conversiones para hablar de la misma moneda que el
   * total que se lee arriba.
   */
  amountInDisplay(value: number): number {
    const code = displayBaseCode();
    if (code === BASE_CURRENCY.code) return value;
    return this.rates.fromBase(value, code) ?? value;
  }

  /** Monto de venta (USD) en la moneda de pantalla a la tasa oficial del BCV. */
  orderDisplayAmount(value: number): number {
    return this.rates.chargeAmount(value, displayBaseCode());
  }

  /** Formatea un monto de venta (ya en USD) en la moneda de pantalla a la tasa BCV. */
  orderMoney(value: number | null | undefined): string {
    const code = displayBaseCode();
    return moneyIn(this.rates.chargeAmount(value, code), code);
  }

  /** Formatea un monto en la moneda indicada. */
  amountIn(value: number | null | undefined, currency?: string | null): string {
    return moneyIn(value, currency);
  }

  /**
   * Monto del pedido tal como se cobró en la vitrina (`priceBreakdown`), en
   * `order.priceCurrency`.
   *
   * El pedido se guarda en USD redondeado a centavos, así que reconvertirlo da
   * otro monto (Bs 15.520,00 -> Bs 15.521,27). `null` en pedidos sin recargo o
   * anteriores al snapshot: ahí el monto en USD es el exacto.
   */
  saleEntered(order: Order | null | undefined, field: SalePriceField): number | null {
    const value = order?.priceBreakdown?.[field];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  /** Moneda en la que se congeló el desglose (`null` sin snapshot). */
  saleCurrency(order: Order | null | undefined): string | null {
    return order?.priceCurrency ?? null;
  }

  /**
   * Tasa forzada con la que se pinta un monto del pedido: sin snapshot se lee a
   * la tasa oficial del cobro (`BCV_USD`); con snapshot manda el monto en
   * bolívares que vio el cajero.
   */
  saleDisplayKey(order: Order | null | undefined): string | null {
    return order?.priceBreakdown ? null : CHARGE_RATE_KEY;
  }

  /** Descuento congelado en negativo: la línea se pinta con signo. */
  saleDiscount(order: Order | null | undefined): number | null {
    const discount = this.saleEntered(order, 'discount');
    return discount == null ? null : -discount;
  }

  /**
   * Saldo del pedido en la moneda de la vitrina: total congelado menos lo pagado
   * (guardado en USD) a la tasa del snapshot.
   */
  saleBalance(order: Order | null | undefined): number | null {
    const total = this.saleEntered(order, 'total');
    const rate = order?.priceRate;
    if (total == null || rate == null) return null;
    return total - mulMoney(order?.paidAmount ?? 0, rate);
  }

  /**
   * Total de la línea en la moneda de la vitrina: el unitario congelado por la
   * cantidad, que es la misma cuenta con la que el backend armó el desglose.
   */
  itemEnteredTotal(item: OrderItem): number | null {
    const unit = item.unitPriceEntered;
    if (unit == null || !Number.isFinite(unit)) return null;
    return mulMoney(unit, item.quantity);
  }

  /**
   * Ficha de la tasa con la que se cobro un pago (etiqueta corta y color). Los
   * cobros viejos, guardados antes de que la tasa de cobro se registrara, no
   * tienen clave: se etiquetan con la tasa del BCV, que es la activa por defecto.
   */
  rateMetaOf(key: RateKey | null | undefined): RateMeta {
    return RATE_META[key ?? 'BCV_USD'];
  }

  /**
   * TODAS las tasas que estaban vigentes cuando se registro el cobro
   * (`ratesHistory`), para el detalle del pedido: es el historial que permite
   * auditar el cobro aunque hoy las tasas sean otras. Sin historial (cobros
   * viejos o guardado degradado) devuelve cadena vacia y no se pinta la linea.
   */
  ratesHistoryHint(payment: OrderPayment): string {
    const rates = payment.ratesHistory?.rates ?? [];
    if (rates.length === 0) return '';
    return rates
      .map((item) => `${RATE_META[item.key].shortLabel} ${rate(item.rate, 2)}`)
      .join(' · ');
  }

  /** Equivalente en la moneda base del monto que se esta cobrando. */
  get payBaseHint(): string | null {
    return this.rates.baseHint(
      this.payForm.amount,
      this.payForm.currency,
      this.chargeRateKey(),
    );
  }

  openPay(order: Order): void {
    this.payOrder.set(order);
    const currency = this.payForm.currency || BASE_CURRENCY.code;
    this.payForm = {
      // El monto arranca con el saldo tal como lo cobra el cajero: el precio que
      // lee en pantalla pasado a la moneda del pago con la tasa de cobro.
      amount: this.balanceIn(currency),
      method: 'CASH',
      currency,
      note: '',
      received: 0,
    };
    this.payOpen.set(true);
  }

  /** Al cambiar de moneda el monto se recalcula con el saldo pendiente. */
  onPayCurrencyChange(currency: string): void {
    this.payForm.currency = currency;
    this.payForm.received = 0;
    const order = this.payOrder();
    this.payForm.amount = order ? this.balanceIn(currency) : 0;
  }

  /** Vuelto que corresponde entregar en el cobro actual (misma moneda). */
  get payChange(): number {
    const received = Number(this.payForm.received) || 0;
    return Math.max(0, sumMoney([received, -Number(this.payForm.amount) || 0]));
  }

  setPayAmount(amount: number): void {
    this.payForm.amount = Math.max(0, sumMoney([amount]));
  }

  /** Fija el efectivo recibido como monto + incremento (atajo de mostrador). */
  setPayReceived(extra: number): void {
    this.payForm.received = sumMoney([Number(this.payForm.amount) || 0, extra]);
  }

  closePay(): void {
    this.payOpen.set(false);
    this.payOrder.set(null);
  }

  submitPay(): void {
    const order = this.payOrder();
    if (!order || this.saving()) return;
    const currency = this.payForm.currency || BASE_CURRENCY.code;
    // Lo cobrado es un monto pagable: se recorta a los decimales de la moneda
    // (nunca se redondea hacia arriba).
    const amount = payableAmount(Number(this.payForm.amount), currency);
    if (!(amount > 0)) {
      this.toast.error('El monto debe ser mayor a 0');
      return;
    }

    if (
      currency !== BASE_CURRENCY.code &&
      this.rates.bsPerUnit(currency) === null
    ) {
      this.toast.error(
        `Falta la tasa de ${currency}. Configúrala en Configuración → Monedas.`,
      );
      return;
    }
    // El saldo con el que se compara es el que cobra el cajero: el precio que lee
    // en pantalla pasado a la moneda del pago con la tasa de cobro. Se tolera la
    // diferencia por redondeo al convertir.
    const limit = this.rates.chargeAmount(
      this.balance(order),
      currency,
    );
    if (amount > limit + 0.02) {
      this.toast.error('El monto excede el saldo pendiente');
      return;
    }

    this.saving.set(true);
    // La tasa de cobro solo viaja si el pago va en una moneda distinta a la que
    // se ve en pantalla: en la misma moneda el monto ya es el precio final.
    const rateKey = this.rates.chargeKeyFor(currency);
    // Una sola forma de pago: se envia el efectivo RECIBIDO y el vuelto como
    // lineas separadas para que la caja muestre ambos movimientos.
    const received = payableAmount(Number(this.payForm.received) || 0, currency);
    const tendered = payableAmount(
      this.payForm.method === 'CASH' && received > amount ? received : amount,
      currency,
    );
    const change =
      this.payForm.method === 'CASH'
        ? payableAmount(Math.max(0, sumMoney([tendered, -amount])), currency)
        : 0;
    this.orders
      .pay(order.id, {
        amount,
        method: this.payForm.method,
        currency,
        // La tasa de cobro solo viaja cuando la empresa tiene una fijada.
        ...(rateKey ? { rateKey } : {}),
        parts: [{ amount: tendered, method: this.payForm.method, currency }],
        change: change > 0
          ? [{ amount: change, method: this.payForm.method, currency }]
          : [],
        note: this.payForm.note || undefined,
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.toast.success('Pago registrado');
          this.closePay();
          this.reload();
        },
        error: (error) => {
          this.saving.set(false);
          this.toast.error(apiErrorMessage(error));
        },
      });
  }

  openCreate(): void {
    this.form = {
      customerId: '',
      type: 'DINE_IN',
      tableNumber: '',
      notes: '',
      discount: 0,
      taxRate: 0,
      // La propina arranca con la sugerencia configurada en Configuración → Cajero.
      tipRate: this.preferences.tipPercent(),
      deliveryFee: 0,
      deliveryFeeCurrency: BASE_CURRENCY.code,
    };
    this.lines.set([]);
    this.productSearch = '';
    this.onlyAvailable = true;
    this.chargeMethod = 'CASH';
    this.chargeCurrency = BASE_CURRENCY.code;
    this.receivedAmount = 0;
    this.chargeNow = this.cashOpen();
    this.formError.set(null);
    if (this.products().length === 0) {
      this.productsService.options().subscribe({
        next: (list) => this.products.set(list),
      });
    }
    if (this.menus().length === 0) {
      this.menusService.options().subscribe({
        next: (list) => this.menus.set(list),
        error: () => this.menus.set([]),
      });
    }
    if (this.customers().length === 0) {
      this.customersService.options().subscribe({
        next: (list) => this.customers.set(list),
      });
    }
    this.createOpen.set(true);
  }

  closeCreate(): void {
    this.createOpen.set(false);
  }

  get subtotal(): number {
    return sumMoney(this.lines().map((line) => mulMoney(line.unitPrice, line.quantity)));
  }

  get discountAmount(): number {
    return Math.min(Number(this.form.discount) || 0, this.subtotal);
  }

  get tax(): number {
    return mulMoney(this.subtotal - this.discountAmount, (Number(this.form.taxRate) || 0) / 100);
  }

  /** Propina de la venta: porcentaje sobre el neto (no paga IGV). */
  get tipAmount(): number {
    return mulMoney(
      this.subtotal - this.discountAmount,
      (Number(this.form.tipRate) || 0) / 100,
    );
  }

  /** `true` mientras el pedido en curso es a domicilio (habilita el delivery). */
  get isDeliveryOrder(): boolean {
    return this.form.type === 'DELIVERY';
  }

  /**
   * Costo de delivery del pedido en USD (moneda base). Solo aplica a pedidos a
   * domicilio; se convierte con la tasa activa cuando se escribe en otra moneda y
   * no paga IGV.
   */
  get deliveryFeeAmount(): number {
    if (!this.isDeliveryOrder) return 0;
    const amount = Number(this.form.deliveryFee) || 0;
    if (!(amount > 0)) return 0;
    const currency = this.form.deliveryFeeCurrency || BASE_CURRENCY.code;
    if (currency === BASE_CURRENCY.code) return amount;
    return this.rates.toBase(amount, currency) ?? amount;
  }

  get total(): number {
    return sumMoney([
      this.subtotal,
      -this.discountAmount,
      this.tax,
      this.tipAmount,
      this.deliveryFeeAmount,
    ]);
  }

  lineTotal(line: OrderLine): number {
    return mulMoney(line.unitPrice, line.quantity);
  }

  /** Productos del inventario que coinciden con la busqueda y el filtro de stock. */
  get filteredProducts(): ProductOption[] {
    const term = this.productSearch.trim().toLowerCase();
    return this.products()
      .filter((product) => (this.onlyAvailable ? product.stock > 0 : true))
      .filter(
        (product) =>
          !term ||
          product.name.toLowerCase().includes(term) ||
          product.sku.toLowerCase().includes(term),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Menús de la carta que coinciden con la búsqueda y el filtro de stock. */
  get filteredMenus(): MenuOption[] {
    const term = this.productSearch.trim().toLowerCase();
    return this.menus()
      .filter((menu) => (this.onlyAvailable ? menu.available : true))
      .filter(
        (menu) =>
          !term ||
          menu.name.toLowerCase().includes(term) ||
          menu.code.toLowerCase().includes(term),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Lineas cuya cantidad supera el stock disponible en inventario. */
  get stockIssues(): OrderLine[] {
    return this.lines().filter((line) => line.stock > 0 && line.quantity > line.stock);
  }

  get createButtonLabel(): string {
    return this.chargeNow && this.cashOpen() ? 'Crear y cobrar' : 'Crear pedido';
  }

  /**
   * Total del pedido expresado en la moneda del cobro, con la **tasa de cobro** de
   * la empresa: el cajero cobra el total que lee en pantalla (en su moneda de
   * precios) pasado a la moneda con la que paga el cliente.
   *
   * Se recorta a los decimales de la moneda: se cobra el monto visible
   * (Bs 15.520,00 al BCV -> `$ 17,56`), nunca una fraccion de centavo.
   */
  get chargeTotal(): number {
    return payableAmount(
      this.rates.saleChargeAmount(this.total, this.chargeCurrency),
      this.chargeCurrency,
    );
  }

  /** Etiqueta de la tasa de cobro (`null` cuando se cobra con la activa). */
  chargeRateLabel(): string | null {
    const key = this.chargeRateKey();
    return key ? (RATE_META[key]?.label ?? key) : null;
  }

  /** Al cambiar de moneda se recalcula el efectivo recibido. */
  onChargeCurrencyChange(currency: string): void {
    this.chargeCurrency = currency;
    this.receivedAmount = 0;
  }

  /** Vuelto del cobro inmediato (solo efectivo, en la moneda del cobro). */
  get change(): number {
    if (this.chargeMethod !== 'CASH') return 0;
    const received = Number(this.receivedAmount) || 0;
    return Math.max(0, sumMoney([received, -this.chargeTotal]));
  }

  /** Atajo de mostrador: efectivo recibido = total + incremento. */
  setReceived(extra: number): void {
    this.receivedAmount = sumMoney([this.chargeTotal, extra]);
  }

  setTaxRate(rate: number): void {
    this.form.taxRate = rate;
  }

  /** Atajo de propina del formulario (0 % deja la venta sin propina). */
  setTipRate(rate: number): void {
    this.form.tipRate = rate;
  }

  /**
   * Monto de una caja completa en el pedido: sus unidades cobradas al precio
   * unitario del catálogo. En el pedido la caja entra como unidades sueltas
   * (el inventario y las líneas se llevan por unidad), así que es lo que suma el
   * botón «Caja» y lo que muestra la grilla.
   */
  boxCharge(product: ProductOption): number {
    return mulMoney(this.unitPriceOf(product), this.boxUnitsOf(product));
  }

  /** Agrega una unidad suelta del inventario al pedido (o incrementa su cantidad). */
  addProduct(product: ProductOption): void {
    if (product.stock <= 0) {
      this.formError.set(`"${product.name}" no tiene stock disponible.`);
      return;
    }
    const existing = this.lines().find((line) => line.productId === product.id);
    if (existing) {
      this.incLine(existing);
      return;
    }
    this.lines.set([...this.lines(), this.newLine(product, 1)]);
    this.formError.set(
      product.price > 0
        ? null
        : `"${product.name}" no tiene precio de venta: edita el precio de la línea.`,
    );
  }

  /**
   * Agrega una caja completa: tantas unidades como trae la presentación, cobradas
   * al precio unitario del catálogo (los productos sueltos caen en
   * `addProduct`).
   */
  addBox(product: ProductOption): void {
    const units = this.boxUnitsOf(product);
    if (!this.isBoxProduct(product)) {
      this.addProduct(product);
      return;
    }
    if (product.stock < units) {
      this.formError.set(
        `No alcanza el stock para una caja completa de "${product.name}" (quedan ${product.stock} unidades).`,
      );
      return;
    }
    const existing = this.lines().find((line) => line.productId === product.id);
    if (existing) {
      if (existing.stock > 0 && existing.quantity + units > existing.stock) {
        this.formError.set(
          `Stock insuficiente para "${product.name}" (disponible ${existing.stock}).`,
        );
        return;
      }
      existing.quantity += units;
      this.lines.set([...this.lines()]);
    } else {
      this.lines.set([...this.lines(), this.newLine(product, units)]);
    }
    this.formError.set(null);
  }

  /** Línea del pedido con el precio por unidad y la presentación del producto. */
  private newLine(product: ProductOption, quantity: number): OrderLine {
    return {
      productId: product.id,
      menuId: null,
      name: product.name,
      unitPrice: this.unitPriceOf(product),
      quantity,
      stock: product.stock,
      unit: product.unit,
      unitsPerBox: this.boxUnitsOf(product),
    };
  }

  /**
   * Agrega un menú (plato/combo) al pedido. Al guardarlo, el backend descuenta
   * los ingredientes de su receta; `stock` de la línea son las porciones que
   * alcanzan con el inventario actual.
   */
  addMenu(menu: MenuOption): void {
    if (!menu.available) {
      // Puede ser falta de stock o una receta con un producto desactivado: el
      // cajero necesita saber cual de las dos para resolverlo.
      const reason = menuUnavailableReason(menu);
      this.formError.set(
        reason === 'Agotado'
          ? `"${menu.name}" no tiene stock suficiente para prepararse.`
          : `"${menu.name}": ${reason}.`,
      );
      return;
    }
    const existing = this.lines().find((line) => line.menuId === menu.id);
    if (existing) {
      this.incLine(existing);
      return;
    }
    this.lines.set([
      ...this.lines(),
      {
        productId: null,
        menuId: menu.id,
        name: menu.name,
        unitPrice: menu.price,
        quantity: 1,
        // `0` = sin tope de inventario: no se limita la cantidad.
        stock: menu.maxServings ?? 0,
        unit: 'UND',
        unitsPerBox: 1,
      },
    ]);
    this.formError.set(
      menu.price > 0
        ? null
        : `"${menu.name}" no tiene precio de venta: edita el precio de la línea.`,
    );
  }

  /** Clave única de una línea del detalle (producto o menú). */
  lineKey(line: OrderLine): string {
    return line.menuId ? `m:${line.menuId}` : `p:${line.productId}`;
  }

  /** Agrega por SKU/código exacto (lector de codigos) o por la primera coincidencia. */
  addBySearch(): void {
    const term = this.productSearch.trim().toLowerCase();
    if (!term) return;

    if (this.lineKind() === 'menus') {
      const menu =
        this.menus().find((option) => option.code.toLowerCase() === term) ??
        this.filteredMenus[0];
      if (!menu) {
        this.formError.set(`No se encontró ningún menú para "${this.productSearch}".`);
        return;
      }
      this.addMenu(menu);
      this.productSearch = '';
      return;
    }

    const list = this.products();
    const match =
      list.find((product) => product.sku.toLowerCase() === term) ?? this.filteredProducts[0];
    if (!match) {
      this.formError.set(`No se encontró ningún producto para "${this.productSearch}".`);
      return;
    }
    this.addProduct(match);
    this.productSearch = '';
  }

  /** Normaliza la cantidad escrita a mano: entero >= 1 y <= stock disponible. */
  onQuantityChange(line: OrderLine): void {
    let quantity = Math.floor(Number(line.quantity) || 0);
    if (quantity < 1) quantity = 1;
    if (line.stock > 0 && quantity > line.stock) {
      quantity = line.stock;
      this.formError.set(`Stock insuficiente para "${line.name}" (disponible ${line.stock}).`);
    } else {
      this.formError.set(null);
    }
    line.quantity = quantity;
    this.lines.set([...this.lines()]);
  }

  clearLines(): void {
    this.lines.set([]);
    this.formError.set(null);
  }

  incLine(line: OrderLine): void {
    if (line.stock > 0 && line.quantity + 1 > line.stock) {
      this.formError.set(`Stock insuficiente para "${line.name}" (disponible ${line.stock})`);
      return;
    }
    line.quantity += 1;
    this.lines.set([...this.lines()]);
    this.formError.set(null);
  }

  decLine(line: OrderLine): void {
    if (line.quantity <= 1) return;
    line.quantity -= 1;
    this.lines.set([...this.lines()]);
  }

  removeLine(key: string): void {
    this.lines.set(this.lines().filter((line) => this.lineKey(line) !== key));
  }

  submitCreate(): void {
    if (this.saving()) return;
    if (this.lines().length === 0) {
      this.formError.set('Agrega al menos un producto.');
      return;
    }
    if (this.lines().some((line) => line.quantity < 1 || line.unitPrice < 0)) {
      this.formError.set('Revisa las cantidades y precios de las líneas.');
      return;
    }
    if (this.stockIssues.length > 0) {
      this.formError.set('Hay líneas con cantidad mayor al stock disponible.');
      return;
    }
    if (this.total <= 0) {
      this.formError.set('El total debe ser mayor a 0: asigna un precio a las líneas.');
      return;
    }

    const charge = this.chargeNow && this.cashOpen();
    const received = Number(this.receivedAmount) || 0;
    const chargeTotal = this.chargeTotal;
    if (charge && this.chargeMethod === 'CASH' && received > 0 && received < chargeTotal) {
      this.formError.set('El efectivo recibido es menor al total a cobrar.');
      return;
    }
    if (
      charge &&
      this.chargeCurrency !== BASE_CURRENCY.code &&
      this.rates.bsPerUnit(this.chargeCurrency) === null
    ) {
      this.formError.set(
        `Falta la tasa de ${this.chargeCurrency}. Configúrala en Configuración → Monedas.`,
      );
      return;
    }

    this.saving.set(true);
    this.formError.set(null);
    const deliveryFee = this.deliveryFeeAmount;
    this.orders
      .create({
        customerId: this.form.customerId || null,
        type: this.form.type,
        tableNumber: this.form.tableNumber || undefined,
        notes: this.form.notes || undefined,
        discount: Number(this.form.discount) || undefined,
        taxRate: Number(this.form.taxRate) || 0,
        tip: this.tipAmount || undefined,
        // Solo los pedidos a domicilio llevan costo de delivery (sin IGV).
        ...(deliveryFee > 0
          ? {
              deliveryFee: Number(this.form.deliveryFee) || 0,
              deliveryFeeCurrency: this.form.deliveryFeeCurrency || BASE_CURRENCY.code,
            }
          : {}),
        items: this.lines().map((line) => ({
          ...(line.productId ? { productId: line.productId } : {}),
          ...(line.menuId ? { menuId: line.menuId } : {}),
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        })),
      })
      .subscribe({
        next: (order) => {
          if (!charge) {
            this.saving.set(false);
            this.toast.success(`Pedido ${order.code} creado`);
            this.closeCreate();
            this.reload();
            return;
          }
          this.payCreatedOrder(order, chargeTotal);
        },
        error: (error) => {
          this.saving.set(false);
          this.formError.set(apiErrorMessage(error));
        },
      });
  }

  /** Cobra de inmediato la venta recien creada (monto = total del pedido). */
  private payCreatedOrder(order: Order, visibleCharge?: number | null): void {
    const currency = this.chargeCurrency || BASE_CURRENCY.code;
    // El monto se envia en la moneda del cobro; el backend guarda ademas el
    // equivalente en USD y lo valida contra el saldo. Se conserva el monto visible
    // antes de crear el pedido para no perder los bolívares exactos de la vitrina.
    const amount = payableAmount(
      visibleCharge ?? this.rates.chargeAmount(order.total, currency),
      currency,
    );
    const rateKey = this.rates.chargeKeyFor(currency);
    // Igual que en el cobro de un pedido abierto: se envia lo recibido y el
    // vuelto para que la caja registre ambos movimientos.
    const received = payableAmount(Number(this.receivedAmount) || 0, currency);
    const tendered = payableAmount(
      this.chargeMethod === 'CASH' && received > amount ? received : amount,
      currency,
    );
    const change =
      this.chargeMethod === 'CASH'
        ? payableAmount(Math.max(0, sumMoney([tendered, -amount])), currency)
        : 0;

    this.orders
      .pay(order.id, {
        amount,
        method: this.chargeMethod,
        currency,
        // La tasa de cobro solo viaja cuando la empresa tiene una fijada.
        ...(rateKey ? { rateKey } : {}),
        parts: [{ amount: tendered, method: this.chargeMethod, currency }],
        change: change > 0 ? [{ amount: change, method: this.chargeMethod, currency }] : [],
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.toast.success(
            `Pedido ${order.code} cobrado con ${this.methodLabels[this.chargeMethod]}`,
          );
          this.closeCreate();
          this.reload();
        },
        error: (error) => {
          // La venta ya quedo registrada: se avisa y se reabre el cobro para reintentar.
          this.saving.set(false);
          this.toast.error(
            `Pedido ${order.code} creado, pero el cobro falló: ${apiErrorMessage(error)}`,
          );
          this.closeCreate();
          this.reload();
          this.openPay(order);
        },
      });
  }
}
