import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  OnDestroy,
  OnInit,
  Output,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { BASE_CURRENCY, CHARGE_RATE_KEY, RATE_META } from '../../core/constants/currency';
import {
  ORDER_TYPE_LABELS,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_CLASSES,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHOD_OPTIONS,
  PAYMENT_STATUS_CLASSES,
  PAYMENT_STATUS_LABELS,
  needsPaymentProof,
} from '../../core/constants/domain';
import type {
  Category,
  Customer,
  CustomerPayload,
  MenuCategoryRef,
  MenuOption,
  ProductOption,
} from '../../core/models/api.model';
import type {
  CashCurrentResponse,
  CashSession,
  Order,
  OrderItem,
  OrderItemPayload,
  OrderStatus,
  OrderType,
  PaymentMethod,
  SalePriceBreakdown,
} from '../../core/models/operations.model';
import type { RateKey } from '../../core/models/rates.model';
import { AuthService } from '../../core/services/auth.service';
import { CashService } from '../../core/services/cash.service';
import {
  CategoriesService,
  CustomersService,
  ProductsService,
} from '../../core/services/catalog.service';
import { LayoutService } from '../../core/services/layout.service';
import { MediaService } from '../../core/services/media.service';
import {
  MenuCategoriesService,
  MenusService,
} from '../../core/services/menu.service';
import { OrdersService } from '../../core/services/orders.service';
import {
  PreferencesService,
} from '../../core/services/preferences.service';
import { RatesService } from '../../core/services/rates.service';
import { ToastService } from '../../core/services/toast.service';
import { categoryOptionLabel, categoryScopeIds } from '../../core/utils/category-tree';
import { toPaymentProofFile } from '../../core/utils/image';
import { resolveMediaUrl } from '../../core/utils/media-url';
import {
  apiErrorMessage,
  dateTime,
  displayBaseCode,
  divMoney,
  money,
  moneyIn,
  moneyLoaded,
  mulMoney,
  payableAmount,
  rate,
  sumMoney,
  truncate,
} from '../../core/utils/format';
import {
  menuStockHint,
  menuStockLabel,
  menuTitle,
  menuUnavailableReason,
} from '../../core/utils/menu-availability';
import {
  InputUnit,
  PackDefinition,
  inputQuantity,
  inputUnits,
  normalizeUnit,
  stockQuantity,
  unitFactor,
} from '../../core/utils/pack-unit';
import {
  boxUnitsOf,
  enteredBoxPriceOf,
  enteredUnitPriceOf,
  isBoxProduct,
  loadedUnitPrice,
  soldUnitLabel,
  unitPriceOf,
} from '../../core/utils/product-pricing';
import { CurrencySelectComponent } from '../../shared/components/currency-select.component';
import { DialogComponent } from '../../shared/components/dialog.component';
import { RateConversionsComponent } from '../../shared/components/rate-conversions.component';
import { EmptyStateComponent, LoaderComponent } from '../../shared/components/feedback.component';
import { IconComponent } from '../../shared/components/icon.component';
import { MoneyComponent } from '../../shared/components/money.component';
import { SidebarComponent } from '../../shared/components/sidebar.component';
import { ConfirmService } from '../../shared/services/confirm.service';

/** Mesas que dibuja el mapa del salón al abrir la vista (se ajusta en pantalla). */
/** Campos del desglose congelado del pedido (`Order.priceBreakdown`). */
type SalePriceField = keyof SalePriceBreakdown;

const DEFAULT_TABLE_COUNT = 12;
/** Tope de mesas numeradas del mapa. */
const MAX_TABLE_COUNT = 60;
/** Artículos que muestra cada página de la vista de tabla del POS. */
const POS_TABLE_PAGE_SIZE = 20;
/** Artículos por columna en la vista de columnas del POS (sin fotos). */
const POS_COLUMN_ROWS = 10;

/**
 * Estados por los que pasa un pedido hasta darse por terminado. El backend solo
 * admite el avance paso a paso, así que cerrar una mesa los recorre en orden.
 */
const COMPLETE_CHAIN: OrderStatus[] = ['CONFIRMED', 'PREPARING', 'READY', 'COMPLETED'];

/** Línea del carrito: lo que el cajero está vendiendo. */
interface PosLine {
  /** Producto del inventario vendido (`null` cuando la línea es un menú). */
  productId: string | null;
  /** Menú (plato/combo) vendido (`null` cuando es un producto suelto). */
  menuId: string | null;
  name: string;
  /** Precio de UNA unidad de inventario: el de la unidad suelta del catálogo. */
  unitPrice: number;
  /**
   * Precio del catálogo de la presentación completa (caja/paquete). Se cobra
   * cuando la línea se vende por caja: el unitario puede ser mayor (la unidad
   * suelta casi siempre se vende más cara), así que la caja no se recalcula.
   * En un producto suelto (o un menú) es el mismo precio de la línea.
   */
  boxPrice: number;
  /**
   * Precio exacto de la presentacion, en la moneda en que se cargo el catalogo
   * (`priceEntered` / `priceCurrency`). `null` cuando el precio se cargo en USD
   * o el registro es anterior al contexto de moneda.
   */
  enteredBoxPrice?: number | null;
  /** Moneda de `enteredBoxPrice` y `enteredUnitPrice`. */
  enteredCurrency?: string | null;
  /**
   * Precio exacto de UNA unidad de inventario en `enteredCurrency` (reparte el
   * precio de la presentacion cuando no hay precio unitario explicito).
   */
  enteredUnitPrice?: number | null;
  /** Cantidad en unidades de inventario (el stock también está en unidades). */
  quantity: number;
  /**
   * Unidad con la que el cajero escribió la cantidad y con la que se le muestra
   * el precio: la unidad suelta (`UND`) o la presentación completa (`CAJA`,
   * `PAQUETE`). La caja de 24 se guarda como sus 24 unidades sueltas.
   */
  inputUnit: string;
  /**
   * Unidades disponibles en inventario; en un menú son las porciones que
   * alcanzan con el stock de sus ingredientes (0 = sin tope conocido).
   */
  stock: number;
  unit: string;
  /** Unidades que trae la presentacion (1 = producto suelto). */
  unitsPerBox: number;
  imageUrl?: string | null;
  /** Ingredientes de la receta (solo en las líneas de menú). */
  ingredientCount?: number;
}

/** Casilla del mapa de mesas: la mesa y el pedido que la ocupa (si lo hay). */
interface TableCell {
  number: string;
  order: Order | null;
}

/**
 * Fila del catálogo del POS. Unifica productos y menús para que las vistas de
 * tarjetas, tabla y columnas (y los resultados de la búsqueda global) pinten los
 * dos tipos con la misma estructura.
 */
interface PosCatalogRow {
  kind: 'product' | 'menu';
  id: string;
  name: string;
  code: string;
  category: string;
  imageUrl: string | null;
  /** Texto del tooltip de la tarjeta (nombre o motivo de no disponibilidad). */
  title: string;
  /** Precio que se cobra al tocar la fila (unidad suelta o menú). */
  priceText: string;
  /** Unidad de venta del precio (`UND`, `KG`...), vacía en los menús. */
  unitLabel: string;
  /** Línea secundaria: caja, ingredientes o aviso de presentación. */
  detail: string | null;
  /** Aviso inferior de las tarjetas (ej. elegir caja o unidad). */
  note: string | null;
  stockText: string;
  stockHint: string;
  /** Clases del distintivo de stock (agotado en rojo). */
  stockClass: string;
  available: boolean;
  kindLabel: string;
  orderedText: string | null;
  product?: ProductOption;
  menu?: MenuOption;
}

/**
 * Cuenta que se muestra en el carrito. Al agregar/cobrar una mesa no solo
 * entran las líneas nuevas: también los productos ya cargados del pedido, su
 * descuento, IGV y propina, y lo que el cliente ya pagó.
 */
interface BillTotals {
  subtotal: number;
  discount: number;
  tax: number;
  tip: number;
  /** Costo de delivery en USD (0 en pedidos sin costo y ventas nuevas sin él). */
  deliveryFee: number;
  total: number;
  /** Monto ya cobrado del pedido (0 en una venta nueva). */
  paid: number;
  /** Total − pagado: lo que falta cobrar. */
  balance: number;
}

/**
 * Linea editable de un cobro mixto o de un vuelto: metodo, moneda y monto.
 * El cajero puede agregar tantas como necesite (efectivo USD, transferencia VES,
 * tarjeta, y el vuelto en la forma que entregue).
 */
interface ChargeLineDraft {
  method: PaymentMethod;
  currency: string;
  amount: number;
}

/**
 * Punto de venta (POS) del cajero: grilla de productos con foto, carrito con
 * propina opcional, mapa de mesas y cobro con vuelto.
 *
 * La pantalla está pensada para caber en una sola vista: las tarjetas ocupan el
 * alto disponible y son la grilla de productos y el detalle de la venta los que
 * se desplazan por dentro (el resto —cabecera, totales, propina y cobro— queda
 * siempre a la vista, sin mover la página).
 *
 * Se abre desde Caja con el botón «Vista de cajero» y comparte los servicios de
 * pedidos y de caja, de modo que cada cobro impacta la sesión abierta igual que
 * en la pantalla de pedidos (el backend valida stock, caja y tasas).
 *
 * Los productos que se compran por presentación (caja de 24, paquete) obligan a
 * elegir la unidad de venta al agregarlos: la caja completa se cobra a su precio
 * del catálogo y la unidad suelta al precio repartido, así ninguna de las dos
 * sale al precio de la otra.
 */
@Component({
  selector: 'app-pos',
  standalone: true,
  imports: [
    FormsModule,
    IconComponent,
    MoneyComponent,
    CurrencySelectComponent,
    DialogComponent,
    RateConversionsComponent,
    LoaderComponent,
    EmptyStateComponent,
    SidebarComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pos.component.html',
})
export class PosComponent implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly orders = inject(OrdersService);
  private readonly cash = inject(CashService);
  private readonly rates = inject(RatesService);
  private readonly productsService = inject(ProductsService);
  private readonly menusService = inject(MenusService);
  private readonly menuCategoriesService = inject(MenuCategoriesService);
  private readonly categoriesService = inject(CategoriesService);
  private readonly customersService = inject(CustomersService);
  private readonly preferences = inject(PreferencesService);
  private readonly layout = inject(LayoutService);
  private readonly media = inject(MediaService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  /** Cierra la vista de cajero y vuelve al arqueo de Caja. */
  @Output() exit = new EventEmitter<void>();

  /** Presentación de los diálogos según la preferencia de la empresa. */
  readonly dialogView = this.preferences.dialogView;

  /**
   * `true` cuando la sesión activa es del personal de caja. El cajero solo
   * trabaja en el POS (no tiene acceso al arqueo del back-office), así que la
   * barra le muestra «Cerrar sesión» en lugar del enlace a Caja.
   */
  readonly isCashier = computed(() => this.auth.role() === 'CASHIER');

  /** Cómo lista el catálogo el POS: tarjetas, tabla (20/página) o columnas (10). */
  readonly posView = this.preferences.posView;
  readonly tablePageSize = POS_TABLE_PAGE_SIZE;
  readonly columnRows = POS_COLUMN_ROWS;
  /** Página de la vista de tabla (se reinicia al cambiar búsqueda o filtros). */
  readonly tablePage = signal(1);

  readonly money = money;
  readonly dateTime = dateTime;
  /** Base de las imagenes locales `/media/...` (ver `environment.mediaUrl`). */
  readonly mediaUrl = resolveMediaUrl;
  /** Presentacion del producto: precio por unidad y etiqueta de la unidad vendida. */
  readonly unitPriceOf = unitPriceOf;
  readonly soldUnitLabel = soldUnitLabel;
  readonly boxUnitsOf = boxUnitsOf;
  readonly isBoxProduct = isBoxProduct;
  /** Disponibilidad de la carta: porciones, agotado o receta con insumo inactivo. */
  readonly menuStockLabel = menuStockLabel;
  readonly menuTitle = menuTitle;
  readonly menuStockHint = menuStockHint;
  readonly typeLabels = ORDER_TYPE_LABELS;
  readonly methodOptions = PAYMENT_METHOD_OPTIONS;
  /** Monedas habilitadas para cobrar (las de Configuración → Monedas). */
  readonly currencies = this.rates.enabledCurrencies;
  readonly methodLabels = PAYMENT_METHOD_LABELS;
  readonly paymentStatusLabels = PAYMENT_STATUS_LABELS;
  readonly paymentStatusClasses = PAYMENT_STATUS_CLASSES;
  readonly orderStatusClasses = ORDER_STATUS_CLASSES;
  readonly orderTypes: OrderType[] = ['DINE_IN', 'TAKEAWAY', 'DELIVERY'];
  readonly maxTableCount = MAX_TABLE_COUNT;
  /** Billetes/monedas frecuentes para completar el efectivo recibido. */
  readonly receiptShortcuts = [5, 10, 20, 50, 100];
  /** Moneda base del sistema (el delivery y el desglose se muestran en USD). */
  readonly baseCurrency = BASE_CURRENCY;
  /**
   * Moneda con la que se están mostrando los montos: la que eligió el admin para
   * el cajero (Configuración → Cajero) o la base de la empresa. Las conversiones
   * del total se calculan sobre lo que se lee en pantalla, no sobre los dólares
   * guardados: si el total se ve en bolívares, el bloque de tasas también.
   */
  readonly moneyBaseCode = displayBaseCode;

  /**
   * **Tasa de cobro**: siempre la oficial del BCV.
   *
   * La tasa personalizada solo infla el precio de vitrina en bolívares; el cobro
   * (en Bs, USD o cualquier otra moneda) se calcula desde el monto en USD con la
   * tasa oficial, nunca con la personalizada.
   */
  readonly chargeRateKey = () => CHARGE_RATE_KEY;

  /** Etiqueta de la tasa de cobro para la línea del cobro. */
  chargeRateLabel(): string | null {
    return RATE_META[this.chargeRateKey()]?.label ?? null;
  }

  /**
   * Tasas oficiales del **BCV** del día (dólar y euro) para la barra del cajero.
   *
   * Son la referencia del cobro: la tasa personalizada del local solo infla el
   * precio de vitrina en bolívares, mientras que el cobro y las conversiones
   * oficiales van a estas dos. Se muestran como badges arriba para que el cajero
   * sepa a cuánto están sin entrar a Configuración; mientras las tasas no hayan
   * cargado, la lista va vacía y los badges no se pintan.
   */
  readonly bcvRates = computed(() => {
    const current = this.rates.bcv()?.current;
    const rows: { key: RateKey; rate: number }[] = [
      { key: 'BCV_USD', rate: Number(current?.usd ?? 0) },
      { key: 'BCV_EUR', rate: Number(current?.eur ?? 0) },
    ];
    return rows
      .filter((row) => row.rate > 0)
      .map((row) => ({
        key: row.key,
        label: RATE_META[row.key].shortLabel,
        badge: RATE_META[row.key].badge,
        // Dos decimales, como el resumen de tasas del cobro y el selector de monedas.
        text: rate(row.rate, 2),
        title: current?.date
          ? `${RATE_META[row.key].label}: Bs ${rate(row.rate)} · ${current.date}`
          : `${RATE_META[row.key].label}: Bs ${rate(row.rate)}`,
      }));
  });

  readonly loading = signal(false);
  readonly loadingTables = signal(false);
  readonly saving = signal(false);
  readonly formError = signal<string | null>(null);
  /** `true` mientras se comprime la foto del comprobante elegida por el cajero. */
  readonly paymentPhotoBusy = signal(false);
  readonly tab = signal<'sale' | 'tables' | 'saved'>('sale');
  /**
   * La tarjeta de cobro vive en un panel lateral que arranca cerrado y se abre
   * con el botón flotante de factura: así el catálogo usa todo el ancho.
   */
  readonly cartOpen = signal(false);
  readonly cashOpen = signal(false);
  /** Sesión de caja abierta (para el esperado y el cierre desde el POS). */
  readonly cashSession = signal<CashSession | null>(null);
  /** Diálogo de caja activo: abrir o cerrar el turno. */
  readonly cashDialog = signal<'open' | 'close' | null>(null);
  /** `true` mientras el API abre/cierra la caja. */
  readonly cashBusy = signal(false);
  /** Monto, moneda y notas del fondo inicial o del conteo de cierre. */
  cashForm: { amount: number; currency: string; notes: string } = {
    amount: 0,
    currency: BASE_CURRENCY.code as string,
    notes: '',
  };
  /**
   * Botón **Actualizar preferencias**: `true` mientras se están trayendo de nuevo
   * la propina, la moneda de los precios y las conversiones de la empresa.
   */
  readonly refreshingPreferences = signal(false);

  readonly products = signal<ProductOption[]>([]);
  readonly menus = signal<MenuOption[]>([]);
  readonly menuCategories = signal<MenuCategoryRef[]>([]);
  readonly categories = signal<Category[]>([]);
  /** Las subcategorias se pintan indentadas bajo su principal. */
  readonly categoryOptionLabel = categoryOptionLabel;
  readonly customers = signal<Customer[]>([]);
  readonly activeOrders = signal<Order[]>([]);
  readonly tableCount = signal(DEFAULT_TABLE_COUNT);
  readonly targetOrder = signal<Order | null>(null);
  /** Pedido guardado con su lista de productos desplegada para corregirla. */
  readonly expandedSavedOrderId = signal<string | null>(null);
  /** Línea o pedido que se está quitando/cancelando (bloquea sus acciones). */
  readonly savedItemBusyId = signal<string | null>(null);

  /** Cancelación de un cajero: OTP que el administrador recibe por Telegram. */
  readonly cancellationOpen = signal(false);
  readonly cancellationOrder = signal<Order | null>(null);
  readonly cancellationCode = signal('');
  readonly cancellationSending = signal(false);
  readonly cancellationExpiresAt = signal<string | null>(null);
  readonly cancellationRequesting = signal(false);
  readonly lines = signal<PosLine[]>([]);
  /**
   * Producto por presentacion (caja/paquete) esperando que el cajero elija la
   * unidad de venta: el selector se abre al tocarlo en la grilla y no agrega
   * nada hasta que se elija caja o unidad suelta.
   */
  readonly unitPicker = signal<ProductOption | null>(null);

  /** Grilla visible: productos sueltos o menús (platos/combos). */
  readonly gridKind = signal<'products' | 'menus'>('products');

  /** Filtros de la grilla de productos. */
  search = '';
  categoryId = '';
  onlyAvailable = true;
  /** Filtro de la grilla de menús. */
  menuCategoryId = '';

  /** Búsqueda global: recorre productos y menús a la vez. */
  get isSearching(): boolean {
    return this.search.trim().length > 0;
  }

  /** Cabecera de la venta nueva (no se usa al agregar a un pedido existente). */
  form: {
    customerId: string;
    /** Nombre con el que el cajero identifica el pedido (opcional). */
    name: string;
    type: OrderType;
    tableNumber: string;
    notes: string;
    discount: number;
    taxRate: number;
    /** Propina en porcentaje sobre el neto (la que configuró el admin). */
    tipRate: number;
    /** Si la venta lleva propina (Sí) o no (No). */
    tipEnabled: boolean;
    /** Costo de delivery en `deliveryFeeCurrency` (solo pedidos a domicilio). */
    deliveryFee: number;
    /** Moneda del costo de delivery (el POS lo captura en USD). */
    deliveryFeeCurrency: string;
  } = {
      customerId: '',
      name: '',
      type: 'DINE_IN',
      tableNumber: '',
      notes: '',
      discount: 0,
      taxRate: 0,
      tipRate: 0,
      tipEnabled: true,
      deliveryFee: 0,
      deliveryFeeCurrency: BASE_CURRENCY.code,
    };

  /** Cobro de la venta en curso. */
  charge: {
    method: PaymentMethod;
    currency: string;
    received: number;
    /** Partes del pago cuando el metodo es MIXED. */
    parts: ChargeLineDraft[];
    /** Vueltos entregados (pueden ser varias monedas/metodos). */
    changes: ChargeLineDraft[];
    /**
     * `true` mientras el vuelto se calcula solo con los pagos del cliente. Al
     * editarlo manualmente se apaga para no pisar lo que escribió el cajero;
     * «Recalcular» lo vuelve a encender.
     */
    changeAuto: boolean;
    /** Referencia bancaria del comprobante (4-6 digitos). */
    paymentReference: string;
    /** Foto opcional del comprobante: URL local `/media/...` (multipart). */
    paymentPhotoUrl: string | null;
    /** Nombre del archivo elegido (solo se muestra en el POS). */
    paymentPhotoName: string;
  } = {
    method: 'CASH',
    currency: BASE_CURRENCY.code,
    received: 0,
    parts: [],
    changes: [],
    changeAuto: true,
    paymentReference: '',
    paymentPhotoUrl: null,
    paymentPhotoName: '',
  };

  /** Registro rápido de cliente desde el POS. */
  readonly customerOpen = signal(false);
  readonly customerSaving = signal(false);
  readonly customerError = signal<string | null>(null);
  customerForm: CustomerPayload = { name: '', phone: '', docNumber: '' };

  /** Refresca las tarjetas mientras algun pedido esta en cola de cobro. */
  private orderRefreshTimer: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    // El punto de venta ocupa toda la pantalla: oculta la barra lateral y la
    // cabecera del back-office mientras está abierto.
    this.layout.setFullscreen(true);
    // La venta arranca limpia y con la propina configurada por el admin.
    this.resetSale();
    this.reload();
    this.orderRefreshTimer = setInterval(() => {
      if (!this.activeOrders().some((order) => order.status === 'PROCESSING')) {
        return;
      }
      this.orders.active().subscribe({
        next: (list) => this.activeOrders.set(list),
        error: () => undefined,
      });
    }, 2000);
  }

  ngOnDestroy(): void {
    // Al volver al arqueo (o salir de la ruta) se restaura el shell normal.
    if (this.orderRefreshTimer) clearInterval(this.orderRefreshTimer);
    this.orderRefreshTimer = null;
    this.layout.setFullscreen(false);
  }

  // ===========================================================================
  //  CARGA DE DATOS
  // ===========================================================================

  /**
   * Trae de nuevo lo que la empresa tiene configurado para el cajero (propina,
   * moneda de los precios y conversiones bajo cada monto) y lo aplica sin cerrar
   * sesión: el admin puede guardar en Configuración → Cajero mientras la caja
   * está abierta y el cajero solo tiene que pulsar este botón.
   *
   * La venta en curso no se toca: la propina de la venta ya empezada y lo que hay
   * en el carrito se quedan como están; lo que cambia es cómo se ven los montos.
   */
  refreshPreferences(): void {
    if (this.refreshingPreferences()) return;

    this.refreshingPreferences.set(true);
    this.preferences.refresh().subscribe({
      next: () => {
        this.refreshingPreferences.set(false);
        // Las conversiones y la moneda de los precios se pintan con las tasas en
        // curso: se vuelven a aplicar con la preferencia recién traída y se
        // refrescan por si el admin tocó la moneda base o alguna tasa.
        this.rates.applyDisplayPreference();
        this.rates.load();
        this.toast.success(
          'Ya ves la propina, la moneda y las conversiones que dejó el admin',
          'Preferencias actualizadas',
        );
      },
      error: () => this.refreshingPreferences.set(false),
    });
  }

  /** Recarga catálogos, caja y pedidos activos (mesas). */
  reload(): void {
    this.loadProducts();
    this.loadMenus();
    this.loadCategories();
    this.loadCustomers();
    this.loadCash();
    this.loadOrders();
  }

  private loadProducts(): void {
    this.loading.set(true);
    this.productsService.options().subscribe({
      next: (list) => {
        this.products.set(list);
        this.loading.set(false);
      },
      error: (error) => {
        this.loading.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  private loadCategories(): void {
    this.categoriesService.options().subscribe({
      next: (list) => this.categories.set(list),
      error: () => this.categories.set([]),
    });
  }

  /** Menús activos con su receta y disponibilidad (grilla de la carta). */
  private loadMenus(): void {
    this.menusService.options().subscribe({
      next: (list) => this.menus.set(list),
      error: () => this.menus.set([]),
    });
    this.menuCategoriesService.options().subscribe({
      next: (list) => this.menuCategories.set(list),
      error: () => this.menuCategories.set([]),
    });
  }

  private loadCustomers(): void {
    this.customersService.options().subscribe({
      next: (list) => this.customers.set(list),
      error: () => this.customers.set([]),
    });
  }

  /** La caja abierta habilita el cobro; sin sesión solo se guardan pedidos. */
  private loadCash(): void {
    this.cash.current().subscribe({
      next: (response) => {
        const session =
          response && 'status' in response
            ? (response as CashSession)
            : ((response as CashCurrentResponse | null)?.session ?? null);
        const open = session?.status === 'OPEN' ? session : null;
        this.cashOpen.set(open !== null);
        this.cashSession.set(open);
      },
      error: () => {
        this.cashOpen.set(false);
        this.cashSession.set(null);
      },
    });
  }

  // ===========================================================================
  //  APERTURA Y CIERRE DE CAJA DESDE EL POS
  // ===========================================================================

  /** Efectivo que debería haber en el cajón (arqueo en vivo). */
  get expectedCash(): number {
    const session = this.cashSession();
    return session?.summary?.expectedCash ?? session?.expectedAmount ?? 0;
  }

  /** Monto del diálogo llevado a la moneda base (USD) con la tasa del día. */
  get cashAmountBase(): number {
    const amount = Math.max(Number(this.cashForm.amount) || 0, 0);
    if (amount === 0) return 0;
    const currency = this.cashForm.currency || BASE_CURRENCY.code;
    const base = this.rates.toBase(amount, currency, CHARGE_RATE_KEY);
    return truncate(base ?? amount, 2);
  }

  /** Diferencia del cierre (contado − esperado), sin pintar `-0.00`. */
  get cashDifference(): number {
    const difference = truncate(this.cashAmountBase - this.expectedCash, 2);
    return difference === 0 ? 0 : difference;
  }

  /** Abre el diálogo para **abrir** la caja (fondo inicial). */
  startOpenCash(): void {
    this.cashForm = { amount: 0, currency: BASE_CURRENCY.code, notes: '' };
    this.cashDialog.set('open');
  }

  /** Abre el diálogo para **cerrar** la caja con el conteo del cajón. */
  startCloseCash(): void {
    this.cashForm = {
      amount: this.expectedCash,
      currency: BASE_CURRENCY.code,
      notes: '',
    };
    this.cashDialog.set('close');
  }

  dismissCashDialog(): void {
    if (this.cashBusy()) return;
    this.cashDialog.set(null);
  }

  /**
   * Abre o cierra la caja según el diálogo activo.
   *
   * El fondo se envía como línea de moneda (`openingLines`), igual que el
   * arqueo del back-office: el backend lo convierte a USD con la tasa del
   * momento. Al cerrar, el conteo se envía en la moneda elegida y el backend
   * calcula la diferencia contra el esperado.
   */
  submitCash(): void {
    const mode = this.cashDialog();
    if (!mode || this.cashBusy()) return;

    const amount = Math.max(Number(this.cashForm.amount) || 0, 0);
    const currency = this.cashForm.currency || BASE_CURRENCY.code;
    const notes = this.cashForm.notes.trim() || undefined;
    this.cashBusy.set(true);

    const request =
      mode === 'open'
        ? this.cash.open({
            openingAmount: this.cashAmountBase,
            openingCurrency: currency,
            openingLines: [{ currency, amount }],
            openingNotes: notes,
          })
        : this.cash.close({
            countedAmount: amount,
            countedCurrency: currency,
            closingNotes: notes,
          });

    request.subscribe({
      next: (session) => {
        this.cashBusy.set(false);
        this.cashDialog.set(null);
        const open = session.status === 'OPEN' ? session : null;
        this.cashOpen.set(open !== null);
        this.cashSession.set(open);
        if (mode === 'open') {
          this.toast.success(`Caja ${session.code} abierta`, 'Caja abierta');
        } else {
          this.toast.success('Turno cerrado y arqueo guardado', 'Caja cerrada');
        }
        // Trae el arqueo en vivo para el próximo cierre.
        this.loadCash();
      },
      error: (error) => {
        this.cashBusy.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  /** Cierra la sesión desde el POS (el cajero no entra al arqueo del panel). */
  async logout(): Promise<void> {
    const confirmed = await this.confirm.ask({
      title: 'Cerrar sesión',
      message: '¿Deseas salir del sistema?',
      confirmLabel: 'Cerrar sesión',
    });
    if (confirmed) this.auth.logout();
  }

  private loadOrders(): void {
    this.loadingTables.set(true);
    this.orders.active().subscribe({
      next: (list) => {
        this.activeOrders.set(list);
        this.loadingTables.set(false);
      },
      error: () => this.loadingTables.set(false),
    });
  }

  // ===========================================================================
  //  GRILLA DE PRODUCTOS
  // ===========================================================================

  /**
   * Deja un texto en minúsculas y sin tildes para que la búsqueda encuentre
   * «café» al escribir «cafe» y no dependa de mayúsculas.
   */
  private normalizeSearchText(value: string | null | undefined): string {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  /** Nombre de la categoría del producto (con su principal, si es subcategoría). */
  categoryOfProduct(product: ProductOption): string {
    const category = this.categories().find((item) => item.id === product.categoryId);
    return category ? categoryOptionLabel(category) : (product.category?.name ?? '');
  }

  /** Nombre de la categoría del menú (con su principal, si es subcategoría). */
  categoryOfMenu(menu: MenuOption): string {
    const category = this.menuCategories().find((item) => item.id === menu.categoryId);
    return category ? categoryOptionLabel(category) : (menu.category?.name ?? '');
  }

  /**
   * El buscador del POS recorre TODO lo que identifica a un producto: nombre,
   * SKU, descripción y categoría (incluida la principal de una subcategoría).
   */
  private productMatches(product: ProductOption, term: string): boolean {
    const haystack = this.normalizeSearchText(
      [
        product.name,
        product.sku,
        product.description ?? '',
        product.category?.name ?? '',
        this.categoryOfProduct(product),
      ].join(' '),
    );
    return haystack.includes(term);
  }

  /**
   * Un menú se encuentra por nombre, código, descripción, categoría o por
   * cualquiera de los productos de su receta: «carne» devuelve la parrilla.
   */
  private menuMatches(menu: MenuOption, term: string): boolean {
    const haystack = this.normalizeSearchText(
      [
        menu.name,
        menu.code,
        menu.description ?? '',
        menu.category?.name ?? '',
        this.categoryOfMenu(menu),
        ...menu.ingredients.map((ingredient) => ingredient.product?.name ?? ''),
      ].join(' '),
    );
    return haystack.includes(term);
  }

  /** Productos que cumplen la búsqueda, la categoría y el filtro de stock. */
  get filteredProducts(): ProductOption[] {
    const term = this.normalizeSearchText(this.search);
    // Al buscar, el filtro de categoría de la pestaña oculta (menús) no debe
    // limitar los productos: la búsqueda es global. El filtro visible sí manda.
    const categoryIds =
      this.isSearching && this.gridKind() === 'menus'
        ? []
        : categoryScopeIds(this.categories(), this.categoryId);
    return this.products()
      .filter((product) => (this.onlyAvailable ? product.stock > 0 : true))
      .filter(
        (product) =>
          categoryIds.length === 0 || categoryIds.includes(product.categoryId ?? ''),
      )
      .filter((product) => !term || this.productMatches(product, term))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Menús de la carta que cumplen la búsqueda, la categoría y el filtro de stock.
   * Un menú agotado solo se muestra si se desmarca "Con stock".
   */
  get filteredMenus(): MenuOption[] {
    const term = this.normalizeSearchText(this.search);
    // Igual que en los productos: el filtro de la otra pestaña no oculta los
    // menús cuando la búsqueda es global.
    const categoryIds =
      this.isSearching && this.gridKind() === 'products'
        ? []
        : categoryScopeIds(this.menuCategories(), this.menuCategoryId);
    return this.menus()
      .filter((menu) => (this.onlyAvailable ? menu.available : true))
      .filter(
        (menu) =>
          categoryIds.length === 0 || categoryIds.includes(menu.categoryId ?? ''),
      )
      .filter((menu) => !term || this.menuMatches(menu, term))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Filas del catálogo que pinta el POS. Sin búsqueda se ven los productos o los
   * menús de la pestaña activa; al buscar se mezclan ambos tipos, que es lo que
   * permite encontrar una parrilla escribiendo «carne» desde Productos.
   */
  get catalogRows(): PosCatalogRow[] {
    const rows = this.isSearching
      ? [
          ...this.filteredProducts.map((product) => this.productRow(product)),
          ...this.filteredMenus.map((menu) => this.menuRow(menu)),
        ].sort((a, b) => a.name.localeCompare(b.name))
      : this.gridKind() === 'menus'
        ? this.filteredMenus.map((menu) => this.menuRow(menu))
        : this.filteredProducts.map((product) => this.productRow(product));
    return rows;
  }

  /** Fila de tarjeta/tabla/columna de un producto del inventario. */
  private productRow(product: ProductOption): PosCatalogRow {
    const unit = soldUnitLabel(product);
    const ordered = this.orderedUnitsOf(product.id);
    const box = isBoxProduct(product);
    return {
      kind: 'product',
      id: product.id,
      name: product.name,
      code: product.sku,
      category: this.categoryOfProduct(product),
      imageUrl: product.imageUrl ?? null,
      title: product.stock > 0 ? product.name : `${product.name} (sin stock)`,
      priceText: this.looseUnitPriceText(product),
      unitLabel: unit,
      detail: box ? `Caja de ${boxUnitsOf(product)}: ${this.boxPriceText(product)}` : null,
      note: box ? 'Al agregarlo eliges caja o unidad' : null,
      stockText: `${product.stock} ${unit}`,
      stockHint: box ? `${unit} sueltas en inventario` : 'Stock disponible',
      stockClass: this.stockClass(product),
      available: product.stock > 0,
      kindLabel: 'Producto',
      orderedText: ordered > 0 ? `Ya en la mesa: ${ordered}` : null,
      product,
    };
  }

  /** Fila de tarjeta/tabla/columna de un menú de la carta. */
  private menuRow(menu: MenuOption): PosCatalogRow {
    const ordered = this.orderedMenusOf(menu.id);
    return {
      kind: 'menu',
      id: menu.id,
      name: menu.name,
      code: menu.code,
      category: this.categoryOfMenu(menu),
      imageUrl: menu.imageUrl ?? null,
      title: menuTitle(menu),
      priceText: money(menu.price),
      unitLabel: '',
      detail: `${menu.ingredients.length} ingrediente(s)`,
      note: null,
      stockText: menuStockLabel(menu),
      stockHint: menuStockHint(menu),
      stockClass: menu.available ? 'text-emerald-700' : 'text-rose-700',
      available: menu.available,
      kindLabel: 'Menú',
      orderedText: ordered > 0 ? `Ya en la mesa: ${ordered}` : null,
      menu,
    };
  }

  /** Mensaje del estado vacío según lo que se esté buscando o mirando. */
  get emptyCatalogMessage(): string {
    if (this.isSearching) {
      return 'Prueba con otro nombre, SKU, código, categoría o ingrediente: la búsqueda recorre productos y menús.';
    }
    return this.gridKind() === 'menus'
      ? 'Crea menús con su receta en Catálogo → Menús para venderlos aquí.'
      : 'Ajusta la búsqueda, la categoría o el filtro de stock y revisa el inventario.';
  }

  /** Filas de la página visible en la vista de tabla. */
  get pagedCatalogRows(): PosCatalogRow[] {
    const page = this.currentTablePage;
    return this.catalogRows.slice(
      (page - 1) * this.tablePageSize,
      page * this.tablePageSize,
    );
  }

  /** Página actual de la tabla, acotada al número de resultados. */
  get currentTablePage(): number {
    return Math.min(this.tablePage(), this.tablePageCount);
  }

  /** Páginas de 20 filas que necesita la vista de tabla. */
  get tablePageCount(): number {
    return Math.max(1, Math.ceil(this.catalogRows.length / this.tablePageSize));
  }

  /** Texto «1–20 de 35» del pie de la tabla. */
  get tableRangeLabel(): string {
    const total = this.catalogRows.length;
    if (total === 0) return 'Sin artículos';
    const start = (this.currentTablePage - 1) * this.tablePageSize + 1;
    const end = Math.min(this.currentTablePage * this.tablePageSize, total);
    return `${start}–${end} de ${total}`;
  }

  previousTablePage(): void {
    this.tablePage.set(Math.max(1, this.currentTablePage - 1));
  }

  nextTablePage(): void {
    this.tablePage.set(Math.min(this.tablePageCount, this.currentTablePage + 1));
  }

  /** Agrega la fila tocada: la caja pregunta unidad y el menú se vende directo. */
  addCatalogRow(row: PosCatalogRow): void {
    if (row.product) this.addProduct(row.product);
    else if (row.menu) this.addMenu(row.menu);
  }

  // ---------------------------- Filtros de la grilla -------------------------

  onSearchChange(value: string): void {
    this.search = value ?? '';
    this.tablePage.set(1);
  }

  setCategory(categoryId: string): void {
    this.categoryId = categoryId ?? '';
    this.tablePage.set(1);
  }

  setMenuCategory(categoryId: string): void {
    this.menuCategoryId = categoryId ?? '';
    this.tablePage.set(1);
  }

  setOnlyAvailable(onlyAvailable: boolean): void {
    this.onlyAvailable = onlyAvailable;
    this.tablePage.set(1);
  }

  setGridKind(kind: 'products' | 'menus'): void {
    this.gridKind.set(kind);
    this.tablePage.set(1);
  }

  clearSearch(): void {
    this.search = '';
    this.tablePage.set(1);
  }

  /** Clase del distintivo de stock: rojo cuando el producto está agotado. */
  stockClass(product: ProductOption): string {
    return product.stock > 0 ? 'text-slate-600' : 'text-rose-700';
  }

  /**
   * Precio de la unidad suelta del producto, en la moneda de visualización.
   *
   * Cuando el catálogo lo guardó como un monto escrito a mano (Bs 350,00 a 970)
   * se imprime ese monto y no su equivalente en USD redondeado a centavos, que
   * devolvía Bs 349,20. El consumo (carrito y factura) sigue cobrando el valor
   * guardado; esto solo alinea lo que ve el cajero con lo que cargó el operador.
   */
  looseUnitPriceText(product: ProductOption): string {
    const loaded = loadedUnitPrice(product);
    return (
      moneyLoaded(loaded?.amount, loaded?.currency) ?? money(unitPriceOf(product))
    );
  }

  /** Precio de la presentación completa (caja/paquete) en la moneda de visualización. */
  boxPriceText(product: ProductOption): string {
    return (
      moneyLoaded(product.priceEntered, product.priceCurrency) ?? money(product.price)
    );
  }

  // ===========================================================================
  //  CARRITO
  // ===========================================================================

  /**
   * Agrega al carrito lo que el cajero tocó en la grilla.
   *
   * Los productos con presentación (caja/paquete) no entran de una: abren el
   * selector de unidad, porque la caja completa y la unidad suelta se cobran
   * distinto y el cajero tiene que decir qué entrega.
   */
  addProduct(product: ProductOption): void {
    if (product.stock <= 0) {
      this.formError.set(`"${product.name}" no tiene stock disponible.`);
      return;
    }
    if (this.isBoxProduct(product)) {
      this.unitPicker.set(product);
      return;
    }
    this.addLine(product, normalizeUnit(product.unit) || 'UND');
  }

  /**
   * Agrega una presentación completa (caja/paquete): tantas unidades sueltas
   * como trae el empaque (los productos sueltos caen en `addProduct`).
   */
  addBox(product: ProductOption): void {
    if (!this.isBoxProduct(product)) {
      this.addProduct(product);
      return;
    }
    if (product.stock <= 0) {
      this.formError.set(`"${product.name}" no tiene stock disponible.`);
      return;
    }
    this.addLine(product, this.boxUnitOf(product));
  }

  /** Cierra el selector de unidad sin agregar nada. */
  closeUnitPicker(): void {
    this.unitPicker.set(null);
  }

  /**
   * Agrega el producto del selector con la unidad elegida: `UND` (unidad suelta)
   * o la unidad de la presentación (`CAJA`/`PAQUETE`).
   */
  pickSaleUnit(inputUnit: string): void {
    const product = this.unitPicker();
    if (!product) return;
    this.unitPicker.set(null);
    this.addLine(product, inputUnit);
  }

  /**
   * Suma una línea del producto en la unidad indicada: una caja de 24 entra al
   * carrito como sus 24 unidades sueltas, que es la unidad del inventario y la
   * que descuenta el backend.
   *
   * Las líneas se separan por producto Y unidad de venta, así la caja y las
   * unidades sueltas se ven (y se cobran) por separado.
   */
  private addLine(product: ProductOption, inputUnit: string, quantity = 1): void {
    const line = this.newLine(product, inputUnit, quantity);
    const existing = this.lines().find(
      (item) => this.lineKey(item) === this.lineKey(line),
    );
    const units = (existing?.quantity ?? 0) + line.quantity;
    if (line.stock > 0 && units > line.stock) {
      this.formError.set(
        line.quantity > line.stock
          ? `No alcanza el stock para una ${this.boxNameOf(line)} completa de "${product.name}" (quedan ${product.stock} unidades).`
          : `Stock insuficiente para "${product.name}" (disponible ${product.stock} unidades).`,
      );
      return;
    }
    if (existing) {
      existing.quantity = units;
      this.lines.set([...this.lines()]);
    } else {
      this.lines.set([...this.lines(), line]);
    }
    const priced = this.isBoxSaleUnit(line) ? line.boxPrice : line.unitPrice;
    this.formError.set(
      priced > 0
        ? null
        : `"${product.name}" no tiene precio de venta: revísalo en el inventario.`,
    );
  }

  /**
   * Línea del carrito con el precio de la unidad de inventario, la unidad de
   * venta elegida y la cantidad guardada en unidades de inventario.
   */
  private newLine(product: ProductOption, inputUnit: string, quantity: number): PosLine {
    const enteredBox = enteredBoxPriceOf(product);
    const enteredUnit = enteredUnitPriceOf(product);
    const enteredCurrency = enteredBox?.currency ?? enteredUnit?.currency ?? null;
    const line: PosLine = {
      productId: product.id,
      menuId: null,
      name: product.name,
      unitPrice: this.unitPriceOf(product),
      boxPrice: product.price,
      ...(enteredCurrency
        ? {
            enteredBoxPrice: enteredBox?.amount ?? null,
            enteredUnitPrice: enteredUnit?.amount ?? null,
            enteredCurrency,
          }
        : {}),
      inputUnit: normalizeUnit(inputUnit) || 'UND',
      quantity: 0,
      stock: product.stock,
      unit: product.unit,
      unitsPerBox: this.boxUnitsOf(product),
      imageUrl: product.imageUrl ?? null,
    };
    line.quantity = stockQuantity(quantity, line.inputUnit, line);
    return line;
  }

  /** Unidad de venta de la línea (`UND`, `CAJA`, `PAQUETE`…). */
  lineUnitOf(line: PosLine): string {
    return normalizeUnit(line.inputUnit) || 'UND';
  }

  /** Unidades de venta elegibles en la línea (solo en productos por presentación). */
  saleUnits(line: PosLine): InputUnit[] {
    return this.isBoxProduct(line) ? inputUnits(line) : [];
  }

  /**
   * Unidades de venta que lleva la línea (cajas o unidades sueltas). Es la
   * cantidad que el cajero escribe y ve; el carrito guarda unidades de
   * inventario para que el stock y el pedido no se desvíen.
   */
  saleQuantity(line: PosLine): number {
    return inputQuantity(line.quantity, line.inputUnit, line);
  }

  /**
   * `true` cuando la línea se está cobrando por la presentación completa (caja,
   * paquete): el catálogo manda y se cobra su precio tal cual.
   */
  private isBoxSaleUnit(line: PosLine): boolean {
    return this.isBoxProduct(line) && this.lineUnitOf(line) === this.boxUnitOf(line);
  }

  /**
   * Precio de la unidad de venta elegida: la presentación completa vale lo que
   * dice el catálogo (`boxPrice`) y la unidad suelta su precio unitario. El
   * carrito cuenta en unidades de inventario, así que la unidad suelta del POS
   * multiplica su precio por las unidades de la presentación (vender las 24
   * sueltas de una caja es cobrar 24 veces el precio unitario).
   */
  salePrice(line: PosLine): number {
    if (this.isBoxSaleUnit(line)) return line.boxPrice;
    return mulMoney(line.unitPrice, unitFactor(line.inputUnit, line));
  }

  /** Cómo se lee la unidad de venta de la línea ("cajas", "unidades sueltas"). */
  saleUnitLabel(line: PosLine): string {
    const unit = this.lineUnitOf(line);
    const option = inputUnits(line).find((item) => item.value === unit);
    return option?.label ?? this.soldUnitLabel(line);
  }

  /** Unidad de la presentación completa del producto (`CAJA` o `PAQUETE`). */
  boxUnitOf(pack: PackDefinition): string {
    const units = inputUnits(pack);
    return units.length > 1 ? units[units.length - 1].value : 'CAJA';
  }

  /** Nombre de la presentación completa del producto (`caja`, `paquete`). */
  private boxNameOf(pack: PackDefinition): string {
    return this.boxUnitOf(pack) === 'PAQUETE' ? 'paquete' : 'caja';
  }

  /**
   * Cambia la unidad con la que se escribe la línea (caja ↔ unidad suelta)
   * conservando las MISMAS unidades de inventario: una caja de 24 pasa a verse
   * como sus 24 unidades sueltas y el monto no cambia. Si la línea de la otra
   * unidad ya está en el carrito, se suman sus cantidades.
   */
  setLineUnit(line: PosLine, inputUnit: string): void {
    const unit = normalizeUnit(inputUnit);
    if (!unit || unit === this.lineUnitOf(line)) return;

    const moved: PosLine = { ...line, inputUnit: unit };
    const rest = this.lines().filter((item) => item !== line);
    const existing = rest.find((item) => this.lineKey(item) === this.lineKey(moved));
    if (existing) {
      existing.quantity += moved.quantity;
      this.lines.set([...rest]);
    } else {
      this.lines.set([...rest, moved]);
    }
    this.formError.set(null);
  }

  /**
   * Agrega un menú (plato/combo) al carrito. El menú se vende como una línea
   * propia: al guardar el pedido, el backend descuenta los ingredientes de su
   * receta. `stock` de la línea son las porciones que alcanzan con el inventario.
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
        // Un menú no tiene presentación: su precio de venta es el mismo.
        boxPrice: menu.price,
        quantity: 1,
        // Un menu se vende por porciones: no tiene presentacion que elegir.
        inputUnit: 'UND',
        // `0` = sin tope de inventario: no se limita la cantidad en el carrito.
        stock: menu.maxServings ?? 0,
        unit: 'UND',
        unitsPerBox: 1,
        imageUrl: menu.imageUrl ?? null,
        ingredientCount: menu.ingredients.length,
      },
    ]);
    this.formError.set(
      menu.price > 0
        ? null
        : `"${menu.name}" no tiene precio de venta: revísalo en Catálogo → Menús.`,
    );
  }

  /** Clave única de una línea del carrito (producto + unidad de venta, o menú). */
  lineKey(line: PosLine): string {
    if (line.menuId) return `m:${line.menuId}`;
    return `p:${line.productId}|${this.lineUnitOf(line)}`;
  }

  /** Agrega por SKU/código exacto (lector de códigos) o la primera coincidencia. */
  addBySearch(): void {
    const term = this.normalizeSearchText(this.search);
    if (!term) return;

    // Un lector de códigos manda el SKU/código exacto; si no, se agrega la
    // primera coincidencia de la búsqueda global (productos y menús juntos).
    const product =
      this.products().find(
        (option) =>
          this.normalizeSearchText(option.sku) === term ||
          this.normalizeSearchText(option.name) === term,
      ) ?? null;
    const menu =
      this.menus().find(
        (option) =>
          this.normalizeSearchText(option.code) === term ||
          this.normalizeSearchText(option.name) === term,
      ) ?? null;
    const row = this.catalogRows[0] ?? null;

    if (product) this.addProduct(product);
    else if (menu) this.addMenu(menu);
    else if (row) this.addCatalogRow(row);
    else {
      this.formError.set(
        `No se encontró ningún producto ni menú para "${this.search}" en el nombre, SKU, código, categoría o ingredientes.`,
      );
      return;
    }
    this.clearSearch();
  }

  /**
   * Cantidad que el cajero escribió, en la unidad de venta de la línea (cajas o
   * unidades sueltas). Se guarda convertida a unidades de inventario.
   */
  onQuantityChange(line: PosLine, value: number | string | null | undefined): void {
    this.setSaleQuantity(line, Number(value));
  }

  /** Suma una unidad de venta (en una caja de 24 suma sus 24 unidades). */
  incLine(line: PosLine): void {
    this.setSaleQuantity(line, this.saleQuantity(line) + 1);
  }

  /** Resta una unidad de venta (nunca baja de una). */
  decLine(line: PosLine): void {
    this.setSaleQuantity(line, this.saleQuantity(line) - 1);
  }

  /**
   * Ajusta la cantidad de la línea a un entero >= 1 de su unidad de venta, sin
   * pasarse del stock disponible (una caja cuenta por sus 24 unidades).
   */
  private setSaleQuantity(line: PosLine, value: number): void {
    let quantity = Number.isFinite(value) ? Math.floor(value) : 0;
    if (quantity < 1) quantity = 1;

    if (line.stock > 0) {
      const fits = Math.floor(inputQuantity(line.stock, line.inputUnit, line));
      if (quantity > fits) {
        quantity = Math.max(fits, 1);
        this.formError.set(
          `Stock insuficiente para "${line.name}" (disponible ${line.stock} unidades).`,
        );
      } else {
        this.formError.set(null);
      }
    } else {
      this.formError.set(null);
    }

    line.quantity = stockQuantity(quantity, line.inputUnit, line);
    this.lines.set([...this.lines()]);
  }

  removeLine(key: string): void {
    this.lines.set(this.lines().filter((line) => this.lineKey(line) !== key));
  }

  /**
   * Vacía todo el panel de la venta en curso: carrito, modo pedido y datos del
   * comprobante y del cobro. El panel queda abierto para empezar de nuevo.
   */
  clearSale(): void {
    this.resetSaleData();
    this.unitPicker.set(null);
  }

  /**
   * Monto de la línea: lo que se cobra por lo que el cajero escribió en la unidad
   * de venta elegida (1 caja al precio de la caja, 24 unidades sueltas a su
   * precio unitario).
   */
  lineTotal(line: PosLine): number {
    return mulMoney(this.salePrice(line), this.saleQuantity(line));
  }

  /**
   * Precio exacto de la unidad de venta, en la moneda en que se cargo el
   * catalogo, cuando esa moneda es la que se esta mostrando.
   *
   * Es el monto que vio el cliente (Bs 15.520,00). `null` si la linea no guarda
   * contexto o si el precio se cargo en otra moneda (ahi no hay nada que
   * recuperar: se usa el USD contable).
   */
  private enteredSalePrice(line: PosLine): number | null {
    const currency = displayBaseCode();
    if (!line.enteredCurrency || line.enteredCurrency !== currency) return null;
    return (
      (this.isBoxSaleUnit(line) ? line.enteredBoxPrice : line.enteredUnitPrice) ??
      null
    );
  }

  /** Total exacto de la linea en la moneda cargada (o `null` si no aplica). */
  lineEnteredTotal(line: PosLine): number | null {
    const price = this.enteredSalePrice(line);
    return price == null ? null : mulMoney(price, this.saleQuantity(line));
  }

  /** Total de la linea como se pinta: recupera el monto escrito en el catalogo. */
  lineTotalText(line: PosLine): string {
    const entered = this.lineEnteredTotal(line);
    if (entered != null && line.enteredCurrency) {
      return moneyIn(entered, line.enteredCurrency);
    }
    return money(this.lineTotal(line));
  }

  /**
   * Totales exactos de una venta NUEVA en la moneda de los precios (bolivares).
   *
   * Se calculan sobre los montos cargados en el catalogo, no sobre los USD ya
   * recortados a centavos: Bs 15.520,00 / 887,30 = $ 17,49, y volver a
   * multiplicar esos $ 17,49 daria Bs 15.518,88. `null` cuando no todas las
   * lineas tienen su precio exacto en la moneda de pantalla.
   */
  get exactSaleTotals(): {
    currency: string;
    subtotal: number;
    discount: number;
    tax: number;
    tip: number;
    deliveryFee: number;
    total: number;
  } | null {
    if (this.targetOrder()) return null;
    const currency = displayBaseCode();
    if (currency === BASE_CURRENCY.code) return null;

    const lines = this.lines();
    if (lines.length === 0) return null;
    const lineTotals = lines.map((line) => this.lineEnteredTotal(line));
    if (lineTotals.some((value) => value == null)) return null;

    const subtotal = sumMoney(lineTotals as number[]);
    // El descuento se captura en USD (moneda base): se lleva a la moneda de
    // pantalla con la precision completa.
    const discount = Math.min(
      this.rates.fromBase(this.discountAmount, currency) ?? this.discountAmount,
      subtotal,
    );
    const taxable = subtotal - discount;
    const tax = mulMoney(taxable, (Number(this.form.taxRate) || 0) / 100);
    const tip = this.form.tipEnabled
      ? mulMoney(taxable, (Number(this.form.tipRate) || 0) / 100)
      : 0;
    const deliveryFee = this.enteredDeliveryFee(currency);

    return {
      currency,
      subtotal,
      discount,
      tax,
      tip,
      deliveryFee,
      total: sumMoney([subtotal, -discount, tax, tip, deliveryFee]),
    };
  }

  /** Costo de delivery exacto en `currency` (monto escrito si ya viene en ella). */
  private enteredDeliveryFee(currency: string): number {
    if (this.form.type !== 'DELIVERY') return 0;
    const amount = Number(this.form.deliveryFee) || 0;
    if (!(amount > 0)) return 0;
    const written = this.form.deliveryFeeCurrency || BASE_CURRENCY.code;
    if (written === currency) return amount;
    return this.rates.fromBase(this.deliveryFeeAmount, currency) ?? this.deliveryFeeAmount;
  }

  /** Unidades totales del carrito (se muestra en la cabecera). */
  get totalUnits(): number {
    return this.lines().reduce((acc, line) => acc + line.quantity, 0);
  }

  /** Resumen que acompaña el título del panel de cobro. */
  get cartSubtitle(): string {
    const order = this.targetOrder();
    if (order) {
      return `${this.itemCount(order)} ya en la mesa · ${this.lines().length} por agregar · ${this.totalUnits} unidades`;
    }
    return `${this.lines().length} ítems · ${this.totalUnits} unidades`;
  }

  /**
   * Líneas que dejan la venta por encima del stock disponible. Un mismo producto
   * puede estar en dos líneas (una caja completa y unidades sueltas), así que las
   * unidades se suman por producto antes de compararlas con el inventario.
   */
  get stockIssues(): PosLine[] {
    const groups = new Map<string, PosLine[]>();
    for (const line of this.lines()) {
      if (!line.productId || line.stock <= 0) continue;
      groups.set(line.productId, [...(groups.get(line.productId) ?? []), line]);
    }

    const issues: PosLine[] = [];
    for (const group of groups.values()) {
      const units = group.reduce((acc, line) => acc + line.quantity, 0);
      if (units > group[0].stock) issues.push(...group);
    }
    return issues;
  }

  // ===========================================================================
  //  TOTALES
  // ===========================================================================

  get subtotal(): number {
    return sumMoney(this.lines().map((line) => this.lineTotal(line)));
  }

  get discountAmount(): number {
    return Math.min(Number(this.form.discount) || 0, this.subtotal);
  }

  get tax(): number {
    return mulMoney(this.subtotal - this.discountAmount, (Number(this.form.taxRate) || 0) / 100);
  }

  /**
   * Propina de la venta nueva: porcentaje sobre el neto (no paga IGV).
   * Al agregar productos a un pedido ya abierto no aplica: ahí se cobra el saldo
   * que ya tiene registrado el pedido.
   */
  get tipAmount(): number {
    if (this.targetOrder() || !this.form.tipEnabled) return 0;
    return mulMoney(
      this.subtotal - this.discountAmount,
      (Number(this.form.tipRate) || 0) / 100,
    );
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

  /**
   * Costo de delivery de la venta nueva en USD (moneda base). Solo aplica a
   * pedidos a domicilio y no paga IGV. Al trabajar sobre un pedido ya abierto se
   * cobra el costo que ese pedido tenga guardado (lo conserva el backend).
   */
  get deliveryFeeAmount(): number {
    if (this.targetOrder()) return 0;
    if (this.form.type !== 'DELIVERY') return 0;
    const amount = Number(this.form.deliveryFee) || 0;
    if (!(amount > 0)) return 0;
    const currency = this.form.deliveryFeeCurrency || BASE_CURRENCY.code;
    if (currency === BASE_CURRENCY.code) return amount;
    return this.rates.toBase(amount, currency) ?? amount;
  }

  /**
   * Cuenta que se cobra en el carrito. En una venta nueva son las líneas del
   * carrito tal cual. Al agregar/cobrar una mesa suma los productos ya cargados
   * del pedido con las líneas nuevas, conservando el descuento, el IGV y la
   * propina del pedido (misma matemática que usa el backend al recalcular).
   */
  get bill(): BillTotals {
    const order = this.targetOrder();
    const subtotal = sumMoney([order?.subtotal ?? 0, this.subtotal]);
    if (!order) {
      return {
        subtotal,
        discount: this.discountAmount,
        tax: this.tax,
        tip: this.tipAmount,
        deliveryFee: this.deliveryFeeAmount,
        total: this.total,
        paid: 0,
        balance: this.total,
      };
    }

    const discount = Math.min(order.discount, subtotal);
    const taxable = sumMoney([subtotal, -discount]);
    const tax = mulMoney(taxable, this.taxRateOf(order) / 100);
    const tip = order.tip;
    // El pedido ya trae su costo de delivery guardado: se conserva al agregar.
    const deliveryFee = order.deliveryFee ?? 0;
    const total = sumMoney([taxable, tax, tip, deliveryFee]);
    return {
      subtotal,
      discount,
      tax,
      tip,
      deliveryFee,
      total,
      paid: order.paidAmount,
      balance: sumMoney([total, -order.paidAmount]),
    };
  }

  /** IGV efectivo guardado en el pedido (el backend lo reusa al recalcular). */
  private taxRateOf(order: Order): number {
    const taxable = sumMoney([order.subtotal, -order.discount]);
    return taxable > 0 ? (order.tax / taxable) * 100 : 0;
  }

  // ===========================================================================
  //  PEDIDOS GUARDADOS
  // ===========================================================================

  /**
   * Pedidos activos que quedaron guardados desde el POS (con o sin mesa). Se
   * ordenan del más reciente al más antiguo: al guardar una venta, el cajero la
   * encuentra arriba sin tener que buscarla.
   */
  get savedOrders(): Order[] {
    return [...this.activeOrders()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  /** Resumen de los productos de un pedido guardado para identificarlo rápido. */
  savedOrderSummary(order: Order): string {
    const items = this.orderItems(order);
    if (items.length === 0) {
      const count = this.itemCount(order);
      return count === 1 ? '1 producto' : `${count} productos`;
    }
    return items
      .map((item) => `${item.quantity} × ${item.name}`)
      .join(' · ');
  }

  /** Abre o cierra la lista de productos de un pedido guardado. */
  toggleSavedOrder(orderId: string): void {
    this.expandedSavedOrderId.update((current) => (current === orderId ? null : orderId));
  }

  /** `true` cuando la tarjeta muestra la lista editable de sus productos. */
  isSavedOrderExpanded(order: Order): boolean {
    return this.expandedSavedOrderId() === order.id;
  }

  /**
   * Quita un producto cargado por error en un pedido guardado, en una mesa o en
   * el panel lateral de cobro. El backend devuelve su stock al inventario y
   * recalcula los totales. Si era la última línea, el pedido completo se cancela
   * (también devuelve todo el stock) para que el cajero pueda corregir incluso un
   * pedido de un solo producto sin quedarse con una venta vacía.
   */
  async removeOrderItem(order: Order, item: OrderItem): Promise<void> {
    if (this.savedItemBusyId() || this.saving()) return;

    const lastItem = this.orderItems(order).length <= 1;
    const confirmed = await this.confirm.ask({
      title: lastItem ? 'Cancelar pedido' : 'Quitar producto',
      message: lastItem
        ? `"${item.name}" es el único producto del pedido ${order.code}. Si lo quitas, se cancelará el pedido completo y su stock volverá al inventario.`
        : `¿Quitar "${item.name}" del pedido ${order.code}? El stock vuelve al inventario y se recalculan los totales.`,
      confirmLabel: lastItem ? 'Cancelar pedido' : 'Quitar',
      tone: 'danger',
    });
    if (!confirmed) return;

    if (lastItem) {
      this.startCancellation(order, item.id);
      return;
    }

    this.savedItemBusyId.set(item.id);
    this.orders.removeItem(order.id, item.id).subscribe({
      next: (updated) => {
        this.savedItemBusyId.set(null);
        this.activeOrders.update((orders) =>
          orders.map((current) => (current.id === updated.id ? updated : current)),
        );
        if (this.targetOrder()?.id === updated.id) this.targetOrder.set(updated);
        this.toast.success(`"${item.name}" quitado del pedido ${order.code}`);
      },
      error: (error) => {
        this.savedItemBusyId.set(null);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  /**
   * Cancela el pedido completo desde el panel lateral (mesa o pedido guardado):
   * sus productos vuelven al inventario y la mesa queda libre.
   */
  async cancelOrder(order: Order): Promise<void> {
    if (this.savedItemBusyId() || this.saving()) return;

    const pending = this.lines().length;
    const confirmed = await this.confirm.ask({
      title: 'Cancelar pedido',
      message:
        `¿Cancelar el pedido ${order.code}? Se quitarán todos sus productos y el stock volverá al inventario.` +
        (pending > 0 ? ' También se descartarán los productos que aún no has guardado.' : ''),
      confirmLabel: 'Cancelar pedido',
      tone: 'danger',
    });
    if (!confirmed) return;

    this.startCancellation(order, order.id);
  }

  /**
   * Un cajero no puede cancelar por su cuenta: el backend exige el OTP que
   * recibe el administrador. ADMIN/MANAGER cancelan directo.
   */
  private startCancellation(order: Order, busyId: string): void {
    if (this.auth.role() !== 'CASHIER') {
      this.cancelOrderRequest(order, busyId);
      return;
    }
    this.requestCancellationCode(order, busyId);
  }

  private requestCancellationCode(order: Order, busyId: string): void {
    if (this.cancellationRequesting()) return;
    this.cancellationRequesting.set(true);
    this.savedItemBusyId.set(busyId);
    this.orders.requestCancellationOtp(order.id).subscribe({
      next: (response) => {
        this.cancellationRequesting.set(false);
        this.savedItemBusyId.set(null);
        this.cancellationOrder.set(order);
        this.cancellationCode.set('');
        this.cancellationExpiresAt.set(response.expiresAt);
        this.cancellationOpen.set(true);
        this.toast.success(
          'El administrador recibió el código por Telegram.',
          'Código enviado',
        );
      },
      error: (error) => {
        this.cancellationRequesting.set(false);
        this.savedItemBusyId.set(null);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  /** Fuerza mayúsculas y descarta lo que no sea letra (el OTP es de 8 letras). */
  setCancellationCode(value: string): void {
    this.cancellationCode.set(
      String(value ?? '')
        .toUpperCase()
        .replace(/[^A-Z]/g, '')
        .slice(0, 8),
    );
  }

  submitCancellation(): void {
    const order = this.cancellationOrder();
    const code = this.cancellationCode();
    if (!order || code.length !== 8 || this.cancellationSending()) return;
    this.cancellationSending.set(true);
    this.cancelOrderRequest(order, order.id, code);
  }

  resendCancellationCode(): void {
    const order = this.cancellationOrder();
    if (order) this.requestCancellationCode(order, order.id);
  }

  closeCancellation(): void {
    if (this.cancellationSending()) return;
    this.cancellationOpen.set(false);
    this.cancellationOrder.set(null);
    this.cancellationCode.set('');
    this.cancellationExpiresAt.set(null);
    this.savedItemBusyId.set(null);
  }

  /** Envía la cancelación y limpia la venta en curso si era el pedido abierto. */
  private cancelOrderRequest(order: Order, busyId: string, code?: string): void {
    this.savedItemBusyId.set(busyId);
    this.orders.updateStatus(order.id, 'CANCELLED', code).subscribe({
      next: () => {
        this.savedItemBusyId.set(null);
        this.cancellationSending.set(false);
        this.cancellationOpen.set(false);
        this.cancellationOrder.set(null);
        this.cancellationCode.set('');
        this.cancellationExpiresAt.set(null);
        this.activeOrders.update((orders) =>
          orders.filter((current) => current.id !== order.id),
        );
        if (this.expandedSavedOrderId() === order.id) {
          this.expandedSavedOrderId.set(null);
        }
        // Al cancelar la mesa o el guardado que se estaba cobrando, el panel se
        // cierra y queda una venta nueva lista para el siguiente cliente.
        if (this.targetOrder()?.id === order.id) this.resetSale();
        this.toast.success(`Pedido ${order.code} cancelado y stock devuelto`);
      },
      error: (error) => {
        this.savedItemBusyId.set(null);
        this.cancellationSending.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  // ===========================================================================
  //  MESAS
  // ===========================================================================

  /** Mesas del salón con el pedido activo que las ocupa (si lo hay). */
  get tables(): TableCell[] {
    return Array.from({ length: this.tableCount() }, (_item, index) => {
      const number = String(index + 1);
      return {
        number,
        order: this.activeOrders().find((order) => order.tableNumber === number) ?? null,
      };
    });
  }

  /** Pedidos activos que ocupan una mesa. */
  get occupiedTables(): Order[] {
    return this.activeOrders().filter((order) => !!order.tableNumber);
  }

  incTables(): void {
    this.tableCount.update((count) => Math.min(count + 1, MAX_TABLE_COUNT));
  }

  decTables(): void {
    this.tableCount.update((count) => Math.max(count - 1, 1));
  }

  /** Abre la venta en modo salón con la mesa elegida. */
  startTableOrder(number: string): void {
    this.resetSale();
    this.tab.set('sale');
    this.form.type = 'DINE_IN';
    this.form.tableNumber = number;
    this.cartOpen.set(true);
    this.toast.info(`Mesa ${number} lista para tomar el pedido`);
  }

  /** Pasa al modo «agregar productos» de un pedido ya abierto. */
  startAddToOrder(order: Order): void {
    this.resetSale();
    this.tab.set('sale');
    this.targetOrder.set(order);
    this.cartOpen.set(true);
  }

  /** Pasa al modo «cobrar» del pedido de una mesa. */
  startChargeOrder(order: Order): void {
    if (this.isPaid(order)) {
      void this.closeTable(order);
      return;
    }
    this.resetSale();
    this.tab.set('sale');
    this.targetOrder.set(order);
    this.cartOpen.set(true);
  }

  /** Saldo pendiente de un pedido (en moneda base). */
  balance(order: Order): number {
    return sumMoney([order.total, -order.paidAmount]);
  }

  /** `true` cuando el pedido ya está cobrado en su totalidad. */
  isPaid(order: Order): boolean {
    return this.balance(order) <= 0;
  }

  /**
   * Termina el pedido de una mesa: lo recorre por los estados que le faltan hasta
   * `COMPLETED` (el backend solo admite el avance paso a paso) y libera la mesa.
   */
  async closeTable(order: Order): Promise<void> {
    if (this.saving() || order.status === 'COMPLETED') return;
    this.saving.set(true);
    try {
      for (const status of COMPLETE_CHAIN) {
        if (COMPLETE_CHAIN.indexOf(order.status) >= COMPLETE_CHAIN.indexOf(status)) continue;
        await firstValueFrom(this.orders.updateStatus(order.id, status));
      }
      this.toast.success(
        `Pedido ${order.code} terminado${order.tableNumber ? `: mesa ${order.tableNumber} libre` : ''}`,
      );
      this.backToSaleStart();
    } catch (error) {
      this.toast.error(apiErrorMessage(error));
      this.saving.set(false);
    }
  }

  // ===========================================================================
  //  CLIENTE RÁPIDO
  // ===========================================================================

  openCustomer(): void {
    this.customerForm = { name: '', phone: '', docNumber: '' };
    this.customerError.set(null);
    this.customerOpen.set(true);
  }

  closeCustomer(): void {
    this.customerOpen.set(false);
  }

  /** Registra el cliente y lo deja seleccionado en la venta en curso. */
  saveCustomer(): void {
    if (this.customerSaving()) return;
    const name = this.customerForm.name.trim();
    if (!name) {
      this.customerError.set('El nombre del cliente es obligatorio.');
      return;
    }
    this.customerSaving.set(true);
    this.customerError.set(null);
    this.customersService.create({ ...this.customerForm, name }).subscribe({
      next: (customer) => {
        this.customerSaving.set(false);
        this.customers.set([...this.customers(), customer]);
        this.form.customerId = customer.id;
        this.customerOpen.set(false);
        this.toast.success(`Cliente ${customer.name} registrado`);
      },
      error: (error) => {
        this.customerSaving.set(false);
        this.customerError.set(apiErrorMessage(error));
      },
    });
  }

  // ===========================================================================
  //  COBRO
  // ===========================================================================

  /**
   * Monto a cobrar en la moneda elegida: el saldo del pedido en USD convertido
   * con la **tasa oficial del BCV**, nunca con el precio de vitrina.
   *
   * La tasa personalizada solo infla el precio que se muestra en bolívares; el
   * cobro (en Bs, USD o cualquier otra moneda) sale siempre del monto en USD a la
   * tasa BCV. Se recorta a los decimales de la moneda: el cajero cobra el monto
   * que lee (Bs 15.520,00 al BCV -> `$ 17,56`, no `$ 17,57`).
   */
  get chargeAmount(): number {
    const bill = this.bill;
    const order = this.targetOrder();
    const currency = this.charge.currency || BASE_CURRENCY.code;

    // Saldo de un pedido ya abierto: cuando no se agregan lineas se cobra el
    // monto congelado en bolivares (15520), no el USD recortado (17,49).
    if (order && this.lines().length === 0) {
      const exact = this.orderSaleBalance(order);
      if (exact != null && currency === order.priceCurrency) return exact;
    }

    // Venta nueva: se cobra el total exacto calculado sobre los precios
    // cargados en el catalogo (15520 Bs), sin pasar por el USD recortado.
    const exactSale = this.exactSaleTotals;
    if (exactSale && currency === exactSale.currency) return exactSale.total;

    return payableAmount(
      this.rates.saleChargeAmount(
        sumMoney([bill.total, -bill.paid]),
        currency,
      ),
      currency,
    );
  }

  /**
   * Saldo de un pedido en la moneda de su ticket, con el monto original en
   * bolivares y la tasa congelada. `null` en pedidos sin snapshot (precio
   * cargado en USD): ahi el USD guardado es el exacto.
   */
  private orderSaleBalance(order: Order | null | undefined): number | null {
    const total = this.saleEntered(order, 'total');
    const rate = order?.priceRate;
    if (total == null || rate == null) return null;
    return Math.max(
      0,
      sumMoney([total, -mulMoney(order?.paidAmount ?? 0, rate)]),
    );
  }

  /** Total exacto de la venta en la moneda de los precios (o `null`). */
  private exactSaleTotal(): number | null {
    const sale = this.exactSaleTotals;
    return sale ? sale.total : null;
  }

  /**
   * `true` cuando el cobro incluye transferencia, Yape o Plin y por lo tanto
   * hay que pedir la referencia del comprobante (la foto es opcional).
   */
  get chargeNeedsProof(): boolean {
    if (this.charge.method === 'MIXED') {
      return this.charge.parts.some(
        (part) => Number(part.amount) > 0 && needsPaymentProof(part.method),
      );
    }
    return needsPaymentProof(this.charge.method);
  }

  /**
   * Total de la cuenta tal como se está mostrando (la moneda de los precios del
   * cajero): el bloque de conversiones del total tiene que hablar de la misma
   * moneda que el total que se lee arriba.
   */
  get displayTotal(): number {
    const exact = this.exactSaleTotal();
    if (exact != null) return exact;
    const order = this.targetOrder();
    const orderExact = this.orderSaleBalance(order);
    if (orderExact != null && displayBaseCode() === order?.priceCurrency) {
      return orderExact;
    }
    return this.rates.displayAmount(this.bill.total);
  }

  /** Vuelto a entregar en efectivo (en la moneda del cobro). */
  get change(): number {
    if (this.charge.method !== 'CASH') return 0;
    const received = Number(this.charge.received) || 0;
    return Math.max(0, sumMoney([received, -this.chargeAmount]));
  }

  /** Total que entrego el cliente en un pago mixto (equivalente en USD). */
  get mixedPaidBase(): number {
    return sumMoney(
      this.charge.parts.map(
        (part) =>
          this.rates.toBase(part.amount, part.currency, this.chargeRateKey()) ?? 0,
      ),
    );
  }

  /** Total del vuelto de un pago mixto (equivalente en USD). */
  get mixedChangeBase(): number {
    return sumMoney(
      this.charge.changes.map(
        (line) =>
          this.rates.toBase(line.amount, line.currency, this.chargeRateKey()) ?? 0,
      ),
    );
  }

  /** Lo que realmente se aplica al pedido: recibido menos vuelto. */
  get mixedAppliedBase(): number {
    return Math.max(0, sumMoney([this.mixedPaidBase, -this.mixedChangeBase]));
  }

  /** Total del pedido expresado en USD con la tasa de cobro. */
  get mixedTargetBase(): number {
    const display = this.displayTotal;
    const code = displayBaseCode();
    if (code === BASE_CURRENCY.code) return display;
    return (
      this.rates.toBase(display, code, this.chargeRateKey()) ??
      this.rates.saleChargeAmount(this.bill.balance, BASE_CURRENCY.code)
    );
  }

  /**
   * Convierte un monto de pago/vuelto a otra moneda con la tasa de cobro.
   *
   * Si las monedas coinciden NO se da la vuelta por USD: los bolívares que
   * escribe el cajero se suman tal cual (30.000 − 25.608 = 4.392 de vuelto), sin
   * perder bolívares por redondear dos veces.
   */
  private chargeIn(amount: number, from: string, to: string): number {
    const source = String(from ?? '').trim().toUpperCase();
    const target = String(to ?? '').trim().toUpperCase();
    const value = Number(amount ?? 0);
    if (source === target) return value;
    const base = this.rates.toBase(value, source, this.chargeRateKey());
    if (base === null) return 0;
    return this.rates.fromBase(base, target, this.chargeRateKey()) ?? 0;
  }

  /** Lo recibido por el cliente, en la moneda que se lee en pantalla. */
  get mixedPaidDisplay(): number {
    const code = displayBaseCode();
    return sumMoney(
      this.charge.parts.map((part) => this.chargeIn(part.amount, part.currency, code)),
    );
  }

  /** El vuelto, en la moneda que se lee en pantalla. */
  get mixedChangeDisplay(): number {
    const code = displayBaseCode();
    return sumMoney(
      this.charge.changes.map((line) => this.chargeIn(line.amount, line.currency, code)),
    );
  }

  /** Total del pedido en la moneda que se lee en pantalla. */
  get mixedTargetDisplay(): number {
    return this.displayTotal;
  }

  /** Lo que queda cubierto después de descontar el vuelto. */
  get mixedAppliedDisplay(): number {
    return sumMoney([this.mixedPaidDisplay, -this.mixedChangeDisplay]);
  }

  /** Cuánto falta para cubrir el total (0 cuando ya está cubierto). */
  get mixedMissingDisplay(): number {
    if (this.mixedSettled) return 0;
    return Math.max(0, sumMoney([this.mixedTargetDisplay, -this.mixedAppliedDisplay]));
  }

  /** Cuánto se entregó de más y todavía no está registrado como vuelto. */
  get mixedExcessDisplay(): number {
    if (this.mixedSettled) return 0;
    return Math.max(0, sumMoney([this.mixedAppliedDisplay, -this.mixedTargetDisplay]));
  }

  /** `true` cuando el mixto cubre el total (se toleran 2 centavos de redondeo). */
  get mixedSettled(): boolean {
    return Math.abs(sumMoney([this.mixedAppliedBase, -this.mixedTargetBase])) <= 0.02;
  }

  /** Atajo de mostrador: efectivo recibido = monto a cobrar + incremento. */
  setReceived(extra: number): void {
    this.charge.received = payableAmount(
      sumMoney([this.chargeAmount, extra]),
      this.charge.currency,
    );
  }

  /**
   * Vuelto que sale de los pagos actuales, en la moneda y forma de la última
   * parte (preferimos una parte en efectivo, que es como normalmente se devuelve).
   * No mira los vueltos ya escritos: es el cálculo limpio para no acumular ajustes.
   */
  private suggestedChange(): ChargeLineDraft | null {
    const parts = this.charge.parts.filter((part) => Number(part.amount) > 0);
    if (parts.length === 0) return null;

    const source =
      [...parts].reverse().find((part) => part.method === 'CASH') ?? parts[parts.length - 1];
    const currency = source.currency || BASE_CURRENCY.code;
    const paid = sumMoney(
      parts.map((part) => this.chargeIn(part.amount, part.currency, currency)),
    );
    // El vuelto se calcula contra lo que realmente se cobra (recortado a los
    // decimales de la moneda), no contra la conversion con fracciones de centavo.
    const target = payableAmount(
      this.rates.saleChargeAmount(this.bill.balance, currency),
      currency,
    );
    const amount = payableAmount(sumMoney([paid, -target]), currency);
    if (amount <= 0) return null;
    return { method: source.method, currency, amount };
  }

  /** Mantiene el vuelto automático al día (solo si el cajero no lo editó). */
  private syncAutoChange(): void {
    if (!this.charge.changeAuto) return;
    const suggested = this.suggestedChange();
    this.charge.changes = suggested ? [suggested] : [];
  }

  /** Recalcula el vuelto con los pagos actuales (botón «Recalcular»). */
  recalculateChange(): void {
    this.charge.changeAuto = true;
    this.syncAutoChange();
  }

  /** El cajero tocó un pago: se recalcula el vuelto si sigue en automático. */
  onChargePartChange(): void {
    this.syncAutoChange();
  }

  /** La referencia bancaria solo admite digitos (4 a 6). */
  onPaymentReferenceChange(value: string): void {
    this.charge.paymentReference = String(value ?? '')
      .replace(/\D/g, '')
      .slice(0, 6);
  }

  /** Comprime y sube la foto del comprobante elegida por el cajero. */
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
      this.charge.paymentPhotoUrl = uploaded.url;
      this.charge.paymentPhotoName = file.name;
    } catch {
      this.toast.error('No se pudo subir la foto del comprobante.');
      this.charge.paymentPhotoUrl = null;
      this.charge.paymentPhotoName = '';
    } finally {
      this.paymentPhotoBusy.set(false);
    }
  }

  /** Quita la foto del comprobante (la referencia se conserva). */
  removePaymentPhoto(): void {
    this.charge.paymentPhotoUrl = null;
    this.charge.paymentPhotoName = '';
  }

  /** El cajero editó el vuelto: se respeta y deja de calcularse solo. */
  onChangeLineChange(): void {
    this.charge.changeAuto = false;
  }

  /** Al elegir MIXTO se arranca con una parte por el total a cobrar. */
  onChargeMethodChange(method: PaymentMethod): void {
    this.charge.method = method;
    if (method !== 'MIXED') return;
    this.charge.changeAuto = true;
    if (this.charge.parts.length === 0) {
      this.charge.parts = [
        {
          method: 'CASH',
          currency: this.charge.currency || BASE_CURRENCY.code,
          amount: this.chargeAmount,
        },
      ];
    }
    this.charge.changes = [];
    this.syncAutoChange();
  }

  addChargePart(): void {
    const previous = this.charge.parts[this.charge.parts.length - 1];
    this.charge.parts = [
      ...this.charge.parts,
      {
        method: 'CASH',
        currency: previous?.currency || this.charge.currency || BASE_CURRENCY.code,
        amount: 0,
      },
    ];
    this.syncAutoChange();
  }

  removeChargePart(index: number): void {
    this.charge.parts = this.charge.parts.filter((_, i) => i !== index);
    this.syncAutoChange();
  }

  addChangePart(): void {
    // Agregar una línea a mano es una decisión del cajero: se deja de recalcular.
    this.charge.changeAuto = false;
    const last = this.charge.changes[this.charge.changes.length - 1];
    const lastPart = this.charge.parts[this.charge.parts.length - 1];
    this.charge.changes = [
      ...this.charge.changes,
      {
        method: 'CASH',
        currency: last?.currency || lastPart?.currency || BASE_CURRENCY.code,
        amount: 0,
      },
    ];
  }

  removeChangePart(index: number): void {
    this.charge.changeAuto = false;
    this.charge.changes = this.charge.changes.filter((_, i) => i !== index);
  }

  /**
   * Enciende o apaga la propina de la venta. Al encenderla se aplica el
   * porcentaje configurado por el admin; al apagarla la propina queda en cero.
   */
  setTip(enabled: boolean): void {
    this.form.tipEnabled = enabled;
    this.form.tipRate = enabled ? this.preferences.tipPercent() : 0;
  }

  /** Al cambiar de moneda el efectivo recibido deja de ser válido. */
  onChargeCurrencyChange(currency: string): void {
    this.charge.currency = currency;
    this.charge.received = 0;
  }

  onTypeChange(type: OrderType): void {
    if (type !== 'DINE_IN') this.form.tableNumber = '';
  }

  /** Formatea un monto en la moneda indicada (atajo para la plantilla). */
  /** Formatea un monto de un pedido guardado (ya en USD) a la tasa BCV. */
  orderMoney(value: number | null | undefined): string {
    const code = displayBaseCode();
    return moneyIn(this.rates.chargeAmount(value, code), code);
  }

  /**
   * Monto congelado del pedido (`priceBreakdown`) en su `priceCurrency`.
   *
   * Con el catálogo en bolívares a una tasa con recargo, reconvertir el USD
   * guardado devuelve otro monto (Bs 15.520,00 -> Bs 15.521,27): se pinta el
   * desglose de la venta. `null` sin recargo o en pedidos anteriores.
   */
  saleEntered(order: Order | null | undefined, field: SalePriceField): number | null {
    const value = order?.priceBreakdown?.[field];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  /** Moneda en la que se congeló el desglose (`null` sin snapshot). */
  saleCurrency(order: Order | null | undefined): string | null {
    return order?.priceCurrency ?? null;
  }

  /** Monto del pedido tal como se cobró, o su conversión contable si no hay snapshot. */
  saleMoney(order: Order | null | undefined, field: SalePriceField): string {
    const entered = this.saleEntered(order, field);
    if (entered != null) return moneyIn(entered, this.saleCurrency(order));
    return this.orderMoney(order?.[field]);
  }

  /** Descuento del pedido en negativo (como se pinta en el resumen). */
  saleDiscountMoney(order: Order | null | undefined): string {
    const entered = this.saleEntered(order, 'discount');
    if (entered != null) return moneyIn(-entered, this.saleCurrency(order));
    return this.orderMoney(-(order?.discount ?? 0));
  }

  /**
   * Total de la línea en la moneda de la vitrina (`unitPriceEntered` × cantidad),
   * o su conversión contable si el pedido no guardó el precio cargado.
   */
  orderItemMoney(order: Order | null | undefined, item: OrderItem): string {
    const unit = item.unitPriceEntered;
    if (unit != null && Number.isFinite(unit)) {
      return moneyIn(mulMoney(unit, item.quantity), this.saleCurrency(order));
    }
    return this.orderMoney(item.total);
  }

  /**
   * Saldo del pedido en la moneda de la vitrina: el total congelado menos lo
   * pagado (guardado en USD) pasado a la tasa del snapshot.
   */
  saleBalanceMoney(order: Order | null | undefined): string {
    const total = this.saleEntered(order, 'total');
    const rate = order?.priceRate;
    if (total != null && rate != null) {
      return moneyIn(total - mulMoney(order?.paidAmount ?? 0, rate), this.saleCurrency(order));
    }
    return order ? this.orderMoney(this.balance(order)) : this.orderMoney(0);
  }

  amountIn(value: number | null | undefined, currency?: string | null): string {
    return moneyIn(value, currency);
  }

  get canSave(): boolean {
    return this.lines().length > 0 && this.stockIssues.length === 0 && !this.saving();
  }

  get canCharge(): boolean {
    if (this.saving() || !this.cashOpen()) return false;
    const order = this.targetOrder();
    if (order) return this.lines().length > 0 || !this.isPaid(order);
    return this.lines().length > 0 && this.total > 0;
  }

  /** Etiqueta del botón principal: cobrar la venta nueva o el saldo de la mesa. */
  get chargeLabel(): string {
    const order = this.targetOrder();
    if (!order) return 'Cobrar';
    return this.lines().length > 0 ? 'Agregar y cobrar' : 'Cobrar saldo';
  }

  /**
   * Guarda la venta y, con `withCharge`, registra el cobro del saldo.
   * Al agregar a un pedido existente primero se suman las líneas nuevas, porque
   * ellas cambian el saldo que se va a cobrar.
   */
  submitSale(withCharge: boolean): void {
    if (this.saving()) return;
    const order = this.targetOrder();
    const willCharge = withCharge && this.cashOpen();

    if (this.lines().length === 0 && !order) {
      this.formError.set('Agrega al menos un producto.');
      return;
    }
    if (this.stockIssues.length > 0) {
      this.formError.set('Hay líneas con cantidad mayor al stock disponible.');
      return;
    }
    if (!order && this.total <= 0) {
      this.formError.set('El total debe ser mayor a 0: revisa los precios del inventario.');
      return;
    }
    if (willCharge && !this.validateCharge()) return;

    const received = Number(this.charge.received) || 0;
    if (willCharge && this.charge.method === 'CASH' && received > 0 && received < this.chargeAmount) {
      this.formError.set('El efectivo recibido es menor al total a cobrar.');
      return;
    }

    this.saving.set(true);
    this.formError.set(null);
    // El monto que el cajero ve antes de crear el pedido: se cobra tal cual para
    // no perder los bolívares exactos de la vitrina al redondear el USD.
    const pendingCharge =
      this.charge.method === 'MIXED' ? null : this.chargeAmount;

    if (order) {
      if (this.lines().length === 0) {
        this.payOrder(order);
        return;
      }
      this.orders
        .addItems(
          order.id,
          this.lines().map((line) => this.itemsPayloadOf(line)),
        )
        .subscribe({
          next: (updated) => (willCharge ? this.payOrder(updated) : this.finishSale(updated)),
          error: (error) => this.failSale(error),
        });
      return;
    }

    const deliveryFee = this.deliveryFeeAmount;
    this.orders
      .create({
        customerId: this.form.customerId || null,
        name: this.form.name.trim() || undefined,
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
        items: this.lines().map((line) => this.itemsPayloadOf(line)),
      })
      .subscribe({
        next: (created) =>
          willCharge ? this.payOrder(created, pendingCharge) : this.finishSale(created),
        error: (error) => this.failSale(error),
      });
  }

  /** Valida el cobro antes de tocar el backend (tasas y pago mixto completo). */
  private validateCharge(): boolean {
    if (this.paymentPhotoBusy()) {
      this.formError.set('Espera a que termine de procesarse la foto del comprobante.');
      return false;
    }
    if (
      this.chargeNeedsProof &&
      !/^\d{4,6}$/.test(this.charge.paymentReference.trim())
    ) {
      this.formError.set(
        'Escribe la referencia del comprobante: de 4 a 6 dígitos.',
      );
      return false;
    }

    const currencies = new Set<string>();
    if (this.charge.method === 'MIXED') {
      const parts = this.charge.parts.filter((part) => Number(part.amount) > 0);
      if (parts.length === 0) {
        this.formError.set('Agrega al menos una forma de pago del cliente.');
        return false;
      }
      parts.forEach((part) => currencies.add(part.currency));
      this.charge.changes.forEach((line) => {
        if (Number(line.amount) > 0) currencies.add(line.currency);
      });
      if (!this.mixedSettled) {
        this.formError.set(
          this.mixedMissingDisplay > 0
            ? `Faltan ${this.amountIn(this.mixedMissingDisplay, displayBaseCode())} por cobrar.`
            : `El cliente entregó de más: registra ${this.amountIn(
                this.mixedExcessDisplay,
                displayBaseCode(),
              )} de vuelto.`,
        );
        return false;
      }
    } else {
      currencies.add(this.charge.currency || BASE_CURRENCY.code);
    }

    for (const currency of currencies) {
      if (currency !== BASE_CURRENCY.code && this.rates.bsPerUnit(currency) === null) {
        this.formError.set(
          `Falta la tasa de ${currency}. Configúrala en Configuración → Monedas.`,
        );
        return false;
      }
    }
    return true;
  }

  private itemsPayloadOf(line: PosLine): OrderItemPayload {
    // La linea vende un producto O un menu: la referencia que no aplica no viaja.
    // `quantity`/`unitPrice` viajan en unidades de inventario —una caja de 24 va
    // como 24 unidades sueltas—, que es como el backend descuenta el stock y como
    // quedan guardadas las lineas del pedido.
    const entered = this.chargeUnitPriceEntered(line);
    return {
      ...(line.productId ? { productId: line.productId } : {}),
      ...(line.menuId ? { menuId: line.menuId } : {}),
      quantity: line.quantity,
      unitPrice: this.chargeUnitPrice(line),
      ...(entered != null ? { unitPriceEntered: entered } : {}),
    };
  }

  /**
   * Precio unitario exacto que viaja al pedido (en la moneda de vitrina), por
   * unidad de inventario. Se calcula sobre el monto cargado en el catalogo
   * (`enteredBoxPrice`/`enteredUnitPrice`), no sobre el USD recortado.
   */
  private chargeUnitPriceEntered(line: PosLine): number | null {
    const price = this.enteredSalePrice(line);
    if (price == null || line.quantity <= 0) return null;
    return divMoney(mulMoney(price, this.saleQuantity(line)), line.quantity);
  }

  /**
   * Precio por unidad de inventario que viaja al pedido (el backend recalcula el
   * monto como `unitPrice × quantity`).
   *
   * En una línea de unidad suelta es el precio unitario del catálogo. En una caja
   * completa se reparte el precio DE LA CAJA entre sus unidades (72 / 24 = 3), así
   * el pedido cobra exactamente lo que muestra el carrito aunque el precio de la
   * unidad suelta sea distinto (una suelta más cara que la caja es lo normal).
   */
  private chargeUnitPrice(line: PosLine): number {
    if (!this.isBoxSaleUnit(line) || line.quantity <= 0) return line.unitPrice;
    return divMoney(this.lineTotal(line), line.quantity);
  }

  /** Cobra el saldo pendiente del pedido en la moneda elegida. */
  private payOrder(order: Order, visibleCharge?: number | null): void {
    const mixed = this.charge.method === 'MIXED';
    const currency = mixed ? BASE_CURRENCY.code : this.charge.currency || BASE_CURRENCY.code;
    // El cobro se calcula desde el saldo en USD con la tasa oficial del BCV. Si
    // el pedido guarda su ticket en bolivares se usa ese monto exacto: Bs
    // 15.520,00 no se vuelve a derivar de los $ 17,49 recortados.
    const exactOrder = this.orderSaleBalance(order);
    const exact =
      exactOrder != null && currency === order.priceCurrency
        ? exactOrder
        : visibleCharge;
    const amount = payableAmount(
      mixed
        ? this.mixedAppliedBase
        : exact ?? this.rates.chargeAmount(this.balance(order), currency),
      currency,
    );

    if (!(amount > 0)) {
      this.toast.info(`El pedido ${order.code} ya está pagado en su totalidad`);
      this.backToSaleStart();
      return;
    }

    /**
     * El cobro siempre viaja con la tasa oficial del BCV. El backend la vuelve a
     * aplicar sobre cada parte en su moneda; la tasa personalizada no participa.
     */
    const chargeRate = () => ({ rateKey: CHARGE_RATE_KEY });

    const payload = mixed
      ? {
          amount,
          method: 'MIXED' as PaymentMethod,
          currency,
          ...this.paymentProofPayload(),
          parts: this.charge.parts
            .filter((part) => Number(part.amount) > 0)
            .map((part) => ({
              amount: payableAmount(Number(part.amount), part.currency),
              method: part.method,
              currency: part.currency,
              ...chargeRate(),
            })),
          change: this.charge.changes
            .filter((line) => Number(line.amount) > 0)
            .map((line) => ({
              amount: payableAmount(Number(line.amount), line.currency),
              method: line.method,
              currency: line.currency,
              ...chargeRate(),
            })),
        }
      : this.singlePaymentPayload(
          amount,
          currency,
          this.rates.chargeKeyFor(currency),
        );

    this.orders
      .pay(order.id, payload)
      .subscribe({
        next: () => {
          this.toast.success(
            `Cobro de ${order.code} en cola. El pedido pasó a Procesando.`,
            'Cobro en proceso',
          );
          this.backToSaleStart();
        },
        error: (error) => {
          // El pedido ya quedó registrado: se avisa y se deja cobrar de nuevo.
          this.saving.set(false);
          this.toast.error(
            `El pedido ${order.code} quedó guardado, pero el cobro falló: ${apiErrorMessage(error)}`,
          );
          this.targetOrder.set(order);
          this.charge.received = 0;
          this.reload();
        },
      });
  }

  /**
   * Cobro de una sola forma de pago. El backend registra el efectivo RECIBIDO y
   * el vuelto como movimientos separados; por eso se envian `parts`/`change`
   * aunque el metodo no sea MIXTO.
   */
  private singlePaymentPayload(amount: number, currency: string, rateKey: string | null) {
    const method = this.charge.method;
    const received = payableAmount(Number(this.charge.received) || 0, currency);
    const tendered = payableAmount(
      method === 'CASH' && received > amount ? received : amount,
      currency,
    );
    const change =
      method === 'CASH'
        ? payableAmount(Math.max(0, sumMoney([tendered, -amount])), currency)
        : 0;
    return {
      amount,
      method,
      currency,
      ...(rateKey ? { rateKey } : {}),
      ...this.paymentProofPayload(),
      parts: [{ amount: tendered, method, currency }],
      change: change > 0 ? [{ amount: change, method, currency }] : [],
    };
  }

  /**
   * Comprobante que viaja con el cobro. Solo se envia cuando algun metodo lo
   * exige (transferencia / Yape / Plin) y la referencia ya se valido.
   */
  private paymentProofPayload(): {
    paymentReference?: string;
    paymentPhotoUrl?: string;
  } {
    if (!this.chargeNeedsProof) return {};
    return {
      paymentReference: this.charge.paymentReference.trim(),
      ...(this.charge.paymentPhotoUrl
        ? { paymentPhotoUrl: this.charge.paymentPhotoUrl }
        : {}),
    };
  }

  /** Cierra la venta en curso (sin cobro) y vuelve al inicio. */
  private finishSale(order: Order): void {
    this.toast.success(`Pedido ${order.code} guardado`);
    this.backToSaleStart();
  }

  private failSale(error: unknown): void {
    this.saving.set(false);
    this.formError.set(apiErrorMessage(error));
  }

  /** Reinicia el POS con una venta nueva y refresca mesas, caja y stock. */
  private backToSaleStart(): void {
    this.saving.set(false);
    this.resetSale();
    this.reload();
  }

  /** Limpia el carrito, el modo pedido y los datos de la venta. */
  private resetSale(): void {
    this.resetSaleData();
    this.search = '';
    // Terminada (o reiniciada) la venta, el panel de cobro vuelve a cerrarse.
    this.cartOpen.set(false);
  }

  /** Deja la venta en blanco sin tocar los filtros ni el estado del panel. */
  private resetSaleData(): void {
    this.targetOrder.set(null);
    this.lines.set([]);
    this.form = {
      customerId: '',
      name: '',
      type: 'DINE_IN',
      tableNumber: '',
      notes: '',
      discount: 0,
      taxRate: 0,
      // Cada venta nueva arranca con la propina configurada; el cajero puede
      // apagarla con «No».
      tipRate: this.preferences.tipPercent(),
      tipEnabled: this.preferences.tipPercent() > 0,
      deliveryFee: 0,
      deliveryFeeCurrency: BASE_CURRENCY.code,
    };
    this.charge = {
      method: 'CASH',
      currency: BASE_CURRENCY.code,
      received: 0,
      parts: [],
      changes: [],
      changeAuto: true,
      paymentReference: '',
      paymentPhotoUrl: null,
      paymentPhotoName: '',
    };
    this.formError.set(null);
  }

  /** Sale del modo «agregar a un pedido» sin guardar nada. */
  cancelAddMode(): void {
    this.targetOrder.set(null);
    this.lines.set([]);
    this.formError.set(null);
    this.cartOpen.set(false);
    this.reload();
  }

  // ===========================================================================
  //  AYUDAS DE PRESENTACIÓN
  // ===========================================================================

  /** Cantidad de líneas de un pedido (el listado solo trae `_count`). */
  itemCount(order: Order): number {
    return order._count?.items ?? order.items?.length ?? 0;
  }

  /**
   * Productos ya cargados en un pedido. El mapa de mesas los recibe dentro del
   * pedido activo (`items`); si el payload no los trae, queda la lista vacía.
   */
  orderItems(order: Order): OrderItem[] {
    return order.items ?? [];
  }

  /**
   * Unidades de un producto que el cliente ya pidió en la mesa (0 si no hay
   * pedido en curso o el producto todavía no está en él). Se usa en la grilla y
   * en las líneas del carrito para no perder de vista cuánto se pidió antes de
   * agregar más.
   */
  orderedUnitsOf(productId: string): number {
    const order = this.targetOrder();
    if (!order) return 0;
    return this.orderItems(order)
      .filter((item) => item.productId === productId)
      .reduce((acc, item) => acc + item.quantity, 0);
  }

  /** Menús del mismo plato que ya están cargados en el pedido de la mesa. */
  orderedMenusOf(menuId: string): number {
    const order = this.targetOrder();
    if (!order) return 0;
    return this.orderItems(order)
      .filter((item) => item.menuId === menuId)
      .reduce((acc, item) => acc + item.quantity, 0);
  }

  /** Unidades ya pedidas de una línea del carrito (producto o menú). */
  orderedForLine(line: PosLine): number {
    if (line.menuId) return this.orderedMenusOf(line.menuId);
    return line.productId ? this.orderedUnitsOf(line.productId) : 0;
  }

  /** Nombre del cliente del pedido (o «Cliente general»). */
  customerLabel(order: Order): string {
    return order.customer?.name || 'Cliente general';
  }

  /** Etiqueta del estado del pago (se muestra en el mapa de mesas). */
  statusLabel(order: Order): string {
    return PAYMENT_STATUS_LABELS[order.paymentStatus] ?? order.paymentStatus;
  }

  /** Etiqueta del estado del pedido (se muestra en el mapa de mesas). */
  orderStatusLabel(order: Order): string {
    return ORDER_STATUS_LABELS[order.status] ?? order.status;
  }
}
