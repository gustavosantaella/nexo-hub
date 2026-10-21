import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { PaginationMeta } from '../../core/models/api.model';
import type {
  MovementPayload,
  StockLevel,
  StockMovement,
  StockMovementType,
} from '../../core/models/operations.model';
import {
  PRODUCT_UNIT_LABELS,
  STOCK_MOVEMENT_LABELS,
  STOCK_MOVEMENT_OPTIONS,
} from '../../core/constants/domain';
import { BASE_CURRENCY_CODE } from '../../core/constants/currency';
import { AuthService } from '../../core/services/auth.service';
import { InventoryService } from '../../core/services/inventory.service';
import { ToastService } from '../../core/services/toast.service';
import {
  apiErrorMessage,
  dateTime,
  money,
  moneyIn,
  moneyLoaded,
  number,
  quantity,
} from '../../core/utils/format';
import {
  InputUnit,
  inputQuantity,
  inputUnits,
  isBoxPack,
  normalizeUnit,
  packDetail,
  packText,
  stockQuantity,
  stockUnitLabel,
} from '../../core/utils/pack-unit';
import { boxUnitsOf, loadedUnitPrice, unitPriceOf } from '../../core/utils/product-pricing';
import { CurrencyAmountInputComponent } from '../../shared/components/currency-amount-input.component';
import { EmptyStateComponent, LoaderComponent } from '../../shared/components/feedback.component';
import { IconComponent } from '../../shared/components/icon.component';
import { ModalComponent } from '../../shared/components/modal.component';
import { MoneyComponent } from '../../shared/components/money.component';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { PaginationComponent } from '../../shared/components/pagination.component';
import { StatCardComponent } from '../../shared/components/stat-card.component';

const EMPTY_META: PaginationMeta = {
  total: 0,
  page: 1,
  limit: 20,
  totalPages: 0,
  hasNextPage: false,
  hasPreviousPage: false,
};

/** Opcion del selector de tipo del formulario de movimiento. */
interface MovementTypeOption {
  value: StockMovementType;
  label: string;
  hint: string;
  icon: string;
}

/** Los tres tipos de movimiento, con el lenguaje de la operacion. */
const MOVEMENT_TYPES: MovementTypeOption[] = [
  {
    value: 'IN',
    label: 'Entrada',
    hint: 'Suma al stock',
    icon: 'trend-up',
  },
  {
    value: 'OUT',
    label: 'Salida',
    hint: 'Resta del stock',
    icon: 'trend-down',
  },
  {
    value: 'ADJUSTMENT',
    label: 'Ajuste',
    hint: 'Fija el stock final',
    icon: 'refresh',
  },
];

/** Motivos sugeridos por tipo (el operador puede escribir otro). */
const MOVEMENT_REASONS: Record<StockMovementType, string[]> = {
  IN: ['Compra a proveedor', 'Devolución de cliente', 'Carga inicial', 'Otro ingreso'],
  OUT: ['Merma', 'Vencimiento', 'Consumo interno', 'Devolución a proveedor'],
  ADJUSTMENT: ['Conteo físico', 'Corrección de error', 'Merma'],
};

/** Formulario del movimiento de inventario. */
interface MovementForm {
  productId: string;
  type: StockMovementType;
  /** Cantidad tal como se escribe, en `inputUnit`. */
  quantity: number;
  /** Unidad con la que se piensa el movimiento (cajas, unidades, kg, g...). */
  inputUnit: string;
  unitCost: number;
  /** Moneda en la que se escribio el costo unitario. */
  unitCostCurrency: string;
  /** Precio de venta de la unidad suelta (0 = no se cambia). */
  unitPrice: number;
  /** Moneda en la que se escribio el precio unitario. */
  unitPriceCurrency: string;
  reason: string;
}

/** Formulario del ajuste de stock (conteo fisico). */
interface AdjustForm {
  /** Stock final tal como se conto, en `inputUnit`. */
  newStock: number;
  inputUnit: string;
  reason: string;
}

/** Pagina de inventario: niveles de stock y movimientos. */
@Component({
  selector: 'app-inventory',
  standalone: true,
  imports: [
    FormsModule,
    IconComponent,
    PageHeaderComponent,
    PaginationComponent,
    ModalComponent,
    MoneyComponent,
    CurrencyAmountInputComponent,
    StatCardComponent,
    EmptyStateComponent,
    LoaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './inventory.page.html',
})
export class InventoryPage implements OnInit {
  readonly auth = inject(AuthService);
  private readonly inventory = inject(InventoryService);
  private readonly toast = inject(ToastService);

  readonly dateTime = dateTime;
  readonly number = number;
  /** Montos del producto en la ficha del formulario. */
  readonly money = money;
  /** Cantidades/existencias: hasta 3 decimales, sin ceros de relleno. */
  readonly quantity = quantity;
  readonly movementOptions = STOCK_MOVEMENT_OPTIONS;
  readonly movementLabels = STOCK_MOVEMENT_LABELS;
  readonly unitLabels = PRODUCT_UNIT_LABELS;
  /** `true` cuando el producto se maneja por presentacion (cajas/paquetes). */
  readonly isBoxPack = isBoxPack;

  readonly tab = signal<'stock' | 'movements'>('stock');
  readonly activeTabClass = 'border-b-2 border-brand-600 text-brand-700';
  readonly inactiveTabClass =
    'border-b-2 border-transparent text-slate-500 hover:text-slate-700';

  readonly stockItems = signal<StockLevel[]>([]);
  readonly stockLoading = signal(false);
  search = '';
  lowOnly = false;

  readonly productCount = computed(() => this.stockItems().length);
  readonly inventoryValue = computed(() =>
    this.stockItems().reduce((acc, item) => acc + (item.stockValue || 0), 0),
  );
  readonly lowStockCount = computed(
    () => this.stockItems().filter((item) => item.isLowStock).length,
  );

  readonly movOpen = signal(false);
  readonly movSaving = signal(false);
  readonly movementTypes = MOVEMENT_TYPES;
  /** Desplegable del buscador de productos. */
  readonly productOpen = signal(false);
  /** Texto del buscador (independiente del producto elegido). */
  readonly productQuery = signal('');
  movForm: MovementForm = {
    productId: '',
    type: 'IN' as StockMovementType,
    quantity: 1,
    inputUnit: '',
    unitCost: 0,
    unitCostCurrency: BASE_CURRENCY_CODE,
    unitPrice: 0,
    unitPriceCurrency: BASE_CURRENCY_CODE,
    reason: '',
  };

  readonly adjOpen = signal(false);
  readonly adjSaving = signal(false);
  readonly adjProduct = signal<StockLevel | null>(null);
  adjForm: AdjustForm = { newStock: 0, inputUnit: '', reason: '' };

  readonly movItems = signal<StockMovement[]>([]);
  readonly movMeta = signal<PaginationMeta>(EMPTY_META);
  readonly movLoading = signal(false);
  mProduct = '';
  mType = '';
  mFrom = '';
  mTo = '';
  private page = 1;
  private limit = 20;

  ngOnInit(): void {
    this.loadStock();
    this.loadMovements();
  }

  // ======================== Stock ========================
  loadStock(): void {
    this.stockLoading.set(true);
    this.inventory
      .stock({ lowOnly: this.lowOnly || undefined, search: this.search || undefined })
      .subscribe({
        next: (list) => {
          this.stockItems.set(list);
          this.stockLoading.set(false);
        },
        error: () => this.stockLoading.set(false),
      });
  }

  applySearch(): void {
    this.loadStock();
  }

  // ======================== Unidades del movimiento ========================
  /** Producto elegido en el formulario de movimiento. */
  get selectedProduct(): StockLevel | undefined {
    return this.stockItems().find((item) => item.id === this.movForm.productId);
  }

  /**
   * Productos que ofrece el buscador: filtra por nombre o SKU mientras se
   * escribe. Con el campo vacio (o mostrando el producto ya elegido) lista las
   * existencias cargadas, para poder cambiar de producto sin borrar el texto.
   */
  get productMatches(): StockLevel[] {
    const term = this.productQuery().trim().toLowerCase();
    const selected = this.selectedProduct?.name.toLowerCase();
    const items =
      !term || term === selected
        ? this.stockItems()
        : this.stockItems().filter(
            (item) =>
              item.name.toLowerCase().includes(term) ||
              (item.sku ?? '').toLowerCase().includes(term),
          );
    return items.slice(0, 40);
  }

  /** Escribe en el buscador; seguir escribiendo invalida el producto elegido. */
  onProductQuery(value: string): void {
    this.productQuery.set(value);
    this.productOpen.set(true);
    const selected = this.selectedProduct;
    if (!selected || selected.name !== value) {
      this.movForm.productId = '';
    }
  }

  /** Elige el producto desde el desplegable. */
  selectProduct(product: StockLevel): void {
    this.productQuery.set(product.name);
    this.productOpen.set(false);
    this.onProductChange(product.id);
  }

  /** Quita el producto elegido y deja el buscador listo para otro. */
  clearProduct(): void {
    this.movForm.productId = '';
    this.productQuery.set('');
    this.productOpen.set(true);
  }

  /** Cierra el desplegable al salir del buscador (salvo hacia una opcion). */
  onProductFocusOut(event: FocusEvent): void {
    const host = event.currentTarget as HTMLElement | null;
    const next = event.relatedTarget as Node | null;
    if (!host || !next || !host.contains(next)) {
      this.productOpen.set(false);
    }
  }

  /** Enter en el buscador: elige la primera coincidencia. */
  selectFirstProductMatch(): void {
    const first = this.productMatches[0];
    if (first) this.selectProduct(first);
  }

  /** Unidades con las que se puede escribir el movimiento (cajas, g, ml...). */
  get movementUnits(): InputUnit[] {
    const product = this.selectedProduct;
    return product ? inputUnits(product) : [];
  }

  /** Unidades con las que se puede contar el stock final del ajuste. */
  get adjustUnits(): InputUnit[] {
    const product = this.adjProduct();
    return product ? inputUnits(product) : [];
  }

  /** Cantidad del movimiento convertida a la unidad de stock. */
  private movementStockQuantity(product: StockLevel): number {
    return stockQuantity(this.movForm.quantity, this.movForm.inputUnit, product);
  }

  /** Como queda el stock tras el movimiento, en el idioma del negocio. */
  get movementPreview(): { text: string } | null {
    const product = this.selectedProduct;
    if (!product) return null;
    const quantity = this.movementStockQuantity(product);
    if (!quantity) return null;
    const after =
      this.movForm.type === 'IN'
        ? product.stock + quantity
        : this.movForm.type === 'OUT'
          ? product.stock - quantity
          : quantity;
    const detail = packDetail(after, product);
    return {
      text: `Quedará ${packText(after, product)}${detail ? ` · ${detail}` : ''}`,
    };
  }

  /** Avisos del movimiento: stock insuficiente y aviso de reposición. */
  get movementAlerts(): string[] {
    const product = this.selectedProduct;
    if (!product) return [];
    const quantity = this.movementStockQuantity(product);
    const alerts: string[] = [];

    if (this.movForm.type === 'OUT' && quantity > product.stock) {
      alerts.push(
        `Stock insuficiente: solo hay ${packText(product.stock, product)}.`,
      );
    }

    const after =
      this.movForm.type === 'IN'
        ? product.stock + quantity
        : this.movForm.type === 'OUT'
          ? product.stock - quantity
          : quantity;
    if (quantity > 0 && after > 0 && after <= product.minStock) {
      alerts.push(
        `Quedará bajo el mínimo (${packText(product.minStock, product)}).`,
      );
    }
    return alerts;
  }

  /** Stock resultante del movimiento en curso, en la unidad de stock. */
  get movementStockAfter(): number | null {
    const product = this.selectedProduct;
    if (!product) return null;
    const moved = this.movementStockQuantity(product);
    if (this.movForm.type === 'IN') return product.stock + moved;
    if (this.movForm.type === 'OUT') return product.stock - moved;
    return moved;
  }

  /**
   * Primer problema del formulario. Mientras exista, no se envia nada: el
   * operador ve el motivo al lado del campo y el boton queda deshabilitado.
   */
  get movementError(): string | null {
    const product = this.selectedProduct;
    if (!product) return 'Selecciona un producto para continuar.';
    const typed = Number(this.movForm.quantity);
    if (!Number.isFinite(typed) || typed < 0) {
      return 'La cantidad no puede ser negativa.';
    }
    const moved = this.movementStockQuantity(product);
    if (this.movForm.type !== 'ADJUSTMENT' && moved <= 0) {
      return 'Indica una cantidad mayor que cero.';
    }
    if (this.movForm.type === 'OUT' && moved > product.stock) {
      return 'La salida supera el stock disponible.';
    }
    return null;
  }

  /** `true` cuando el movimiento se puede registrar. */
  get canSubmitMovement(): boolean {
    return !this.movementError && !this.movSaving();
  }

  /** Posicion de la barra de stock (resultante sobre la escala del producto). */
  get movementBarPercent(): number {
    const product = this.selectedProduct;
    const after = this.movementStockAfter;
    if (!product || after === null) return 0;
    const scale = Math.max(product.stock, after, product.minStock * 2, 1);
    return Math.max(0, Math.min(100, (after / scale) * 100));
  }

  /** Marca del minimo dentro de la barra de stock. */
  get movementMinPercent(): number {
    const product = this.selectedProduct;
    if (!product) return 0;
    const scale = Math.max(
      product.stock,
      this.movementStockAfter ?? 0,
      product.minStock * 2,
      1,
    );
    return Math.max(0, Math.min(100, (product.minStock / scale) * 100));
  }

  /** Semáforo del stock resultante. */
  get movementStatus(): { label: string; classes: string } | null {
    const product = this.selectedProduct;
    const after = this.movementStockAfter;
    if (!product || after === null) return null;
    if (after <= 0) {
      return { label: 'Sin stock', classes: 'bg-rose-100 text-rose-700' };
    }
    if (after <= product.minStock) {
      return { label: 'Bajo mínimo', classes: 'bg-amber-100 text-amber-700' };
    }
    return { label: 'Disponible', classes: 'bg-emerald-100 text-emerald-700' };
  }

  /** Color de la barra de stock segun el resultado. */
  get movementBarClass(): string {
    const product = this.selectedProduct;
    const after = this.movementStockAfter;
    if (!product || after === null || after <= 0) return 'bg-rose-500';
    return after <= product.minStock ? 'bg-amber-500' : 'bg-emerald-500';
  }

  /** Valor del ingreso (cantidad × costo unitario) en la moneda escrita. */
  get movementTotalCost(): string | null {
    if (!this.showUnitCost) return null;
    const product = this.selectedProduct;
    const unitCost = Number(this.movForm.unitCost) || 0;
    if (!product || unitCost <= 0) return null;
    const moved = this.movementStockQuantity(product);
    if (moved <= 0) return null;
    return moneyIn(moved * unitCost, this.movForm.unitCostCurrency);
  }

  /** Etiqueta de la unidad con la que se esta escribiendo la cantidad. */
  get movementInputUnitLabel(): string {
    const option = this.movementUnits.find(
      (item) => item.value === this.movForm.inputUnit,
    );
    return option?.label ?? this.movForm.inputUnit;
  }

  /** Stock final en el idioma del negocio ("3 cajas · 72 UND"). */
  get movementStockAfterLabel(): string | null {
    const product = this.selectedProduct;
    const after = this.movementStockAfter;
    if (!product || after === null) return null;
    const detail = packDetail(after, product);
    return `${packText(after, product)}${detail ? ` · ${detail}` : ''}`;
  }

  /** Titulo del modal segun el tipo elegido. */
  get movementTitle(): string {
    if (this.movForm.type === 'OUT') return 'Registrar salida';
    if (this.movForm.type === 'ADJUSTMENT') return 'Ajustar stock';
    return 'Registrar entrada';
  }

  /** Subtitulo del modal: explica el efecto del movimiento. */
  get movementSubtitle(): string {
    if (this.movForm.type === 'OUT') {
      return 'La cantidad se descuenta del stock y queda en la trazabilidad';
    }
    if (this.movForm.type === 'ADJUSTMENT') {
      return 'Escribe el stock final contado: reemplaza las existencias actuales';
    }
    return 'La cantidad se suma al stock y queda en la trazabilidad';
  }

  /** Texto del boton principal del modal. */
  get movementSubmitLabel(): string {
    if (this.movForm.type === 'OUT') return 'Registrar salida';
    if (this.movForm.type === 'ADJUSTMENT') return 'Fijar stock final';
    return 'Registrar entrada';
  }

  /** Motivos sugeridos para el tipo elegido. */
  get reasonSuggestions(): string[] {
    return MOVEMENT_REASONS[this.movForm.type] ?? [];
  }

  /** Estilo de la tarjeta de tipo (activa con el color de su efecto). */
  typeCardClass(type: StockMovementType): string {
    const base =
      'flex flex-col items-start gap-0.5 rounded-xl border px-3 py-2.5 text-left transition focus:outline-none focus:ring-2';
    if (this.movForm.type !== type) {
      return `${base} border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 focus:ring-slate-300`;
    }
    if (type === 'IN') {
      return `${base} border-emerald-500 bg-emerald-50 text-emerald-700 ring-1 ring-emerald-500 focus:ring-emerald-300`;
    }
    if (type === 'OUT') {
      return `${base} border-rose-500 bg-rose-50 text-rose-700 ring-1 ring-rose-500 focus:ring-rose-300`;
    }
    return `${base} border-sky-500 bg-sky-50 text-sky-700 ring-1 ring-sky-500 focus:ring-sky-300`;
  }

  /** Cambia el tipo y ajusta la cantidad al nuevo significado. */
  setMovementType(type: StockMovementType): void {
    if (this.movForm.type === type) return;
    this.movForm.type = type;
    const product = this.selectedProduct;
    if (!product) return;
    if (type === 'ADJUSTMENT') {
      // "Stock final" arranca en lo que hay hoy: el operador corrige el conteo.
      this.movForm.quantity = inputQuantity(
        product.stock,
        this.movForm.inputUnit,
        product,
      );
    } else if (!(Number(this.movForm.quantity) > 0)) {
      this.movForm.quantity = 1;
    }
  }

  /** Marca/desmarca un motivo sugerido. */
  toggleReason(reason: string): void {
    this.movForm.reason = this.movForm.reason === reason ? '' : reason;
  }

  /** Botones − / + de la cantidad (respetando 3 decimales). */
  stepQuantity(delta: number): void {
    const current = Number(this.movForm.quantity) || 0;
    this.movForm.quantity = Math.max(0, Math.round((current + delta) * 1000) / 1000);
  }

  /** Resumen del stock final del ajuste. */
  get adjustPreview(): { text: string } | null {
    const product = this.adjProduct();
    if (!product) return null;
    const target = stockQuantity(
      this.adjForm.newStock,
      this.adjForm.inputUnit,
      product,
    );
    const detail = packDetail(target, product);
    return {
      text: `Quedará ${packText(target, product)}${detail ? ` · ${detail}` : ''}`,
    };
  }

  /** Existencias descritas en el idioma del negocio ("3 cajas + 5 unidades"). */
  stockLabel(item: StockLevel): string {
    return packText(item.stock, item);
  }

  /**
   * A cuanto se cobra la unidad suelta de una presentacion ("Bs 350,00 por
   * unidad suelta"). `null` en los productos que se venden enteros (precio
   * unico).
   *
   * Se imprime el monto que se cargo a mano cuando la moneda de visualizacion es
   * la misma en la que se escribio; asi no aparece el equivalente en USD
   * redondeado a centavos (Bs 349,20 en lugar de los Bs 350,00 cargados).
   */
  unitPriceLabel(item: StockLevel): string | null {
    if (boxUnitsOf(item) <= 1) return null;
    const loaded = loadedUnitPrice(item);
    const text =
      moneyLoaded(loaded?.amount, loaded?.currency) ??
      money(unitPriceOf(item));
    return `${text} por unidad suelta`;
  }

  /**
   * Como se escribio el movimiento cuando no fue en la unidad de stock
   * (ej. "= 2 cajas", "= 750 gramos (g)").
   */
  movementInputLabel(movement: StockMovement): string | null {
    const pack = {
      unit: movement.product?.unit ?? 'UND',
      unitsPerBox: movement.product?.unitsPerBox,
    };
    if (!movement.inputUnit || movement.inputUnit === stockUnitLabel(pack)) {
      return null;
    }
    const option = inputUnits(pack).find(
      (item) => item.value === movement.inputUnit,
    );
    if (!option || movement.inputQuantity == null) return null;
    return `= ${quantity(movement.inputQuantity)} ${option.label}`;
  }

  /** Unidad por defecto del producto (su presentacion: cajas, kg o unidades). */
  private defaultUnit(product: StockLevel): string {
    const options = inputUnits(product);
    const declared = normalizeUnit(product.unit);
    return options.some((option) => option.value === declared)
      ? declared
      : (options[0]?.value ?? '');
  }

  onProductChange(productId: string): void {
    this.movForm.productId = productId;
    this.movForm.quantity = 1;
    const product = this.selectedProduct;
    this.movForm.inputUnit = product ? this.defaultUnit(product) : '';
    // El precio unitario se fija por producto: no se arrastra al cambiar de uno
    // a otro (0 = "no lo cambies").
    this.movForm.unitPrice = 0;
    this.movForm.unitPriceCurrency = BASE_CURRENCY_CODE;
  }

  onUnitChange(unit: string): void {
    this.movForm.inputUnit = unit;
  }

  onAdjustUnitChange(unit: string): void {
    this.adjForm.inputUnit = unit;
  }

  get quantityLabel(): string {
    return this.movForm.type === 'ADJUSTMENT' ? 'Stock final' : 'Cantidad';
  }

  get showUnitCost(): boolean {
    return this.movForm.type === 'IN';
  }

  /** `true` cuando la entrada puede ajustar el precio de la unidad suelta. */
  get showUnitPrice(): boolean {
    return this.movForm.type === 'IN' && this.movPresentation != null;
  }

  /**
   * Producto de presentacion (caja/paquete con varias unidades) del movimiento en
   * curso: es el unico caso en el que la unidad suelta tiene precio propio.
   */
  private get movPresentation(): StockLevel | null {
    const product = this.selectedProduct;
    if (!product || boxUnitsOf(product) <= 1) return null;
    return product;
  }

  /** Como se cobra hoy la unidad suelta del producto del movimiento. */
  get unitPriceReference(): string | null {
    const product = this.movPresentation;
    if (!product) return null;
    const units = boxUnitsOf(product);
    const loose = loadedUnitPrice(product);
    const looseText =
      moneyLoaded(loose?.amount, loose?.currency) ?? money(unitPriceOf(product));
    const packPrice =
      moneyLoaded(product.priceEntered, product.priceCurrency) ??
      money(product.price);
    return (
      `Actual: ${looseText} por unidad suelta` +
      ` · la presentación (${units} ${units === 1 ? 'unidad' : 'unidades'}) se cobra en el catálogo a ${packPrice}`
    );
  }

  openMovement(product?: StockLevel): void {
    this.movForm = {
      productId: product?.id ?? '',
      type: 'IN',
      quantity: 1,
      inputUnit: product ? this.defaultUnit(product) : '',
      unitCost: 0,
      unitCostCurrency: BASE_CURRENCY_CODE,
      unitPrice: 0,
      unitPriceCurrency: BASE_CURRENCY_CODE,
      reason: '',
    };
    // El buscador abre con el producto de la fila (si se abrio desde la tabla).
    this.productQuery.set(product?.name ?? '');
    this.productOpen.set(!product);
    this.movOpen.set(true);
  }

  closeMovement(): void {
    this.movOpen.set(false);
    this.productOpen.set(false);
  }

  submitMovement(): void {
    if (this.movSaving()) return;
    // Una sola fuente de verdad para el formulario: el modal deshabilita el
    // boton con `canSubmitMovement`, y aqui se vuelve a comprobar el motivo.
    const error = this.movementError;
    if (error) {
      this.toast.error(error);
      return;
    }
    const product = this.selectedProduct;
    if (!product) return;
    const inputQuantity = Number(this.movForm.quantity) || 0;
    this.movSaving.set(true);
    // La cantidad viaja tal como se escribio, con su unidad (`inputUnit`): el
    // backend la convierte a la unidad de stock del producto.
    const payload: MovementPayload = {
      productId: this.movForm.productId,
      type: this.movForm.type,
      inputUnit: this.movForm.inputUnit || undefined,
      inputQuantity,
      reason: this.movForm.reason || undefined,
    };
    if (this.movForm.type === 'IN') {
      payload.unitCost = Number(this.movForm.unitCost) || undefined;
      payload.unitCostCurrency = this.movForm.unitCostCurrency || undefined;
      // El precio unitario viaja solo si el operador lo fijo: 0 = no se toca.
      const unitPrice = Number(this.movForm.unitPrice) || 0;
      if (this.showUnitPrice && unitPrice > 0) {
        payload.unitPrice = unitPrice;
        payload.unitPriceCurrency = this.movForm.unitPriceCurrency || undefined;
      }
    }
    this.inventory.createMovement(payload).subscribe({
      next: (result) => {
        this.movSaving.set(false);
        this.toast.success(`Stock actualizado: ${result.stockBefore} → ${result.stockAfter}`);
        this.closeMovement();
        this.loadStock();
        this.loadMovements();
      },
      error: (error) => {
        this.movSaving.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  // ======================== Ajuste ========================
  openAdjust(product: StockLevel): void {
    this.adjProduct.set(product);
    // Se abre en la unidad del producto y con el stock actual en esa unidad.
    const unit = this.defaultUnit(product);
    this.adjForm = {
      newStock: inputQuantity(product.stock, unit, product),
      inputUnit: unit,
      reason: '',
    };
    this.adjOpen.set(true);
  }

  closeAdjust(): void {
    this.adjOpen.set(false);
    this.adjProduct.set(null);
  }

  submitAdjust(): void {
    const product = this.adjProduct();
    if (!product || this.adjSaving()) return;
    const newStock = Number(this.adjForm.newStock);
    if (!(newStock >= 0)) {
      this.toast.error('El stock final no puede ser negativo');
      return;
    }
    this.adjSaving.set(true);
    // El conteo viaja en la unidad en la que se conto: el backend lo convierte.
    this.inventory
      .adjust(product.id, {
        newStock,
        inputUnit: this.adjForm.inputUnit || undefined,
        inputQuantity: newStock,
        reason: this.adjForm.reason || undefined,
      })
      .subscribe({
        next: (result) => {
          this.adjSaving.set(false);
          this.toast.success(`Stock ajustado: ${result.stockBefore} → ${result.stockAfter}`);
          this.closeAdjust();
          this.loadStock();
          this.loadMovements();
        },
        error: (error) => {
          this.adjSaving.set(false);
          this.toast.error(apiErrorMessage(error));
        },
      });
  }

  // ======================== Movimientos ========================
  loadMovements(): void {
    this.movLoading.set(true);
    this.inventory
      .movements({
        page: this.page,
        limit: this.limit,
        productId: this.mProduct || undefined,
        type: this.mType || undefined,
        from: this.mFrom || undefined,
        to: this.mTo || undefined,
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

  applyMovementFilters(): void {
    this.page = 1;
    this.loadMovements();
  }

  changePage(page: number): void {
    this.page = page;
    this.loadMovements();
  }

  changeLimit(limit: number): void {
    this.limit = limit;
    this.page = 1;
    this.loadMovements();
  }
}
