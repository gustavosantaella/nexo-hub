import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { BASE_CURRENCY, DEFAULT_RATE_KEY, RATE_META } from '../../core/constants/currency';
import { PRODUCT_UNIT_OPTIONS } from '../../core/constants/domain';
import type {
  Category,
  PaginationMeta,
  Product,
  ProductPayload,
  ProductUnit,
  Supplier,
} from '../../core/models/api.model';
import type { RateKey } from '../../core/models/rates.model';
import { AuthService } from '../../core/services/auth.service';
import {
  CategoriesService,
  ProductsService,
  SuppliersService,
} from '../../core/services/catalog.service';
import { MediaService } from '../../core/services/media.service';
import { RatesService } from '../../core/services/rates.service';
import { ToastService } from '../../core/services/toast.service';
import { categoryOptionLabel } from '../../core/utils/category-tree';
import {
  apiErrorMessage,
  displayBaseCode,
  divMoney,
  moneyIn,
  number,
  quantity,
} from '../../core/utils/format';
import {
  boxUnitsOf,
  isBoxProduct,
  loadedUnitPrice,
  soldUnitLabel,
  unitPriceOf,
} from '../../core/utils/product-pricing';
import { isPackUnit, packText } from '../../core/utils/pack-unit';
import { PRODUCT_IMAGE_MAX_SIZE, toProductImageFile } from '../../core/utils/image';
import { resolveMediaUrl } from '../../core/utils/media-url';
import { CurrencyAmountInputComponent } from '../../shared/components/currency-amount-input.component';
import { EmptyStateComponent, LoaderComponent } from '../../shared/components/feedback.component';
import { IconComponent } from '../../shared/components/icon.component';
import { ModalComponent } from '../../shared/components/modal.component';
import { MoneyComponent } from '../../shared/components/money.component';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { PaginationComponent } from '../../shared/components/pagination.component';
import { ConfirmService } from '../../shared/services/confirm.service';

const EMPTY_META: PaginationMeta = {
  total: 0,
  page: 1,
  limit: 20,
  totalPages: 0,
  hasNextPage: false,
  hasPreviousPage: false,
};

interface ProductForm {
  sku: string;
  name: string;
  description: string;
  /** Foto del producto: URL local `/media/...` subida por multipart. */
  imageUrl: string;
  /** Precio tal como se escribe, en `priceCurrency`. */
  price: number;
  priceCurrency: string;
  /** Tasa del sistema con la que se convierte el precio a USD. */
  priceRateKey: RateKey;
  /** Costo de la presentacion, en `costCurrency`. */
  cost: number;
  costCurrency: string;
  /** Tasa del sistema con la que se convierte el costo de la presentacion a USD. */
  costRateKey: RateKey;
  /**
   * PRECIO DE VENTA de una unidad suelta (cajas/paquetes), en
   * `unitPriceCurrency`. Es un monto de VENTA independiente del precio de la
   * presentacion y cada monto tiene su PROPIA moneda y su PROPIA tasa: cambiar
   * la de uno no arrastra la del otro. `0` = sin definir: al vender suelto se
   * reparte el precio de la presentacion entre sus unidades.
   */
  unitPrice: number;
  unitPriceCurrency: string;
  /** Tasa del sistema con la que se convierte el precio unitario a USD. */
  unitPriceRateKey: RateKey;
  stock: number;
  minStock: number;
  unit: ProductUnit;
  /** Unidades individuales que trae la presentacion (1 = producto suelto). */
  unitsPerBox: number;
  trackStock: boolean;
  categoryId: string;
  supplierId: string;
  active: boolean;
}

/** Catalogo de productos con filtros, ordenamiento y control de stock. */
@Component({
  selector: 'app-products',
  standalone: true,
  imports: [
    FormsModule,
    IconComponent,
    PageHeaderComponent,
    PaginationComponent,
    ModalComponent,
    MoneyComponent,
    CurrencyAmountInputComponent,
    EmptyStateComponent,
    LoaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './products.page.html',
})
export class ProductsPage implements OnInit {
  /**
   * Moneda base del sistema: los precios y costos del catálogo se guardan y se
   * muestran en ella (no en soles peruanos).
   */
  readonly baseCurrency = BASE_CURRENCY;
  /** Helpers de formato expuestos a la plantilla. */
  readonly number = number;
  /** Montos en la moneda indicada (el precio se carga en la moneda elegida). */
  readonly moneyIn = moneyIn;
  /** Cantidades/existencias: hasta 3 decimales, sin ceros de relleno. */
  readonly quantity = quantity;
  /** Base de las imagenes locales `/media/...` (ver `environment.mediaUrl`). */
  readonly mediaUrl = resolveMediaUrl;
  /** `true` cuando el producto se vende por caja (precio de caja, stock por unidad). */
  readonly isBoxProduct = isBoxProduct;
  readonly boxUnitsOf = boxUnitsOf;
  readonly soldUnitLabel = soldUnitLabel;
  readonly auth = inject(AuthService);
  /** Moneda con la que se abren los formularios (la base del sistema). */
  private readonly rates = inject(RatesService);
  private readonly products = inject(ProductsService);
  private readonly categories = inject(CategoriesService);
  private readonly suppliers = inject(SuppliersService);
  private readonly media = inject(MediaService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  readonly items = signal<Product[]>([]);
  readonly meta = signal<PaginationMeta>(EMPTY_META);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly modalOpen = signal(false);
  readonly editing = signal<Product | null>(null);
  readonly categoryOptions = signal<Category[]>([]);
  readonly supplierOptions = signal<Supplier[]>([]);
  readonly unitOptions = PRODUCT_UNIT_OPTIONS;
  /** Lado máximo de la foto del producto (se muestra como ayuda en el formulario). */
  readonly productImageMaxSize = PRODUCT_IMAGE_MAX_SIZE;
  /** Lectura de la foto en curso y error del último intento. */
  readonly imageReading = signal(false);
  readonly imageError = signal<string | null>(null);
  /** Las subcategorias se pintan indentadas bajo su principal. */
  readonly categoryOptionLabel = categoryOptionLabel;

  search = '';
  categoryId = '';
  supplierId = '';
  onlyActive = false;
  sortBy = '';
  sortOrder: 'asc' | 'desc' = 'asc';

  private page = 1;
  private limit = 20;

  form: ProductForm = this.emptyForm();

  ngOnInit(): void {
    this.load();
    this.categories.options().subscribe({
      next: (list) => this.categoryOptions.set(list),
      error: () => this.categoryOptions.set([]),
    });
    this.suppliers.options().subscribe({
      next: (list) => this.supplierOptions.set(list),
      error: () => this.supplierOptions.set([]),
    });
  }

  private emptyForm(): ProductForm {
    // Los precios nuevos se cargan en la moneda base del sistema (USD o la que
    // el local haya elegido mostrar); el formulario deja cambiarla.
    const currency = this.rates.baseCode() ?? BASE_CURRENCY.code;
    // Tasa con la que cada monto se convierte a USD: la activa del sistema (la
    // personalizada si el local la definio). El formulario no deja elegirla: todos
    // los montos se calculan con la misma tasa del sistema.
    const rateKey = this.activeRateKey;
    return {
      sku: '',
      name: '',
      description: '',
      imageUrl: '',
      price: 0,
      priceCurrency: currency,
      priceRateKey: rateKey,
      cost: 0,
      costCurrency: currency,
      costRateKey: rateKey,
      unitPrice: 0,
      // Cada monto arranca con su propia moneda y tasa (las del sistema).
      unitPriceCurrency: currency,
      unitPriceRateKey: rateKey,
      stock: 0,
      minStock: 0,
      unit: 'UND',
      unitsPerBox: 1,
      trackStock: true,
      categoryId: '',
      supplierId: '',
      active: true,
    };
  }

  /** Tasa activa del sistema (la del `activeKey`), o BCV dolar si no hay datos. */
  get activeRateKey(): RateKey {
    return this.rates.activeKey() ?? DEFAULT_RATE_KEY;
  }

  /**
   * Tasa con la que quedo guardado un monto, normalizada a una de las tasas del
   * sistema. Un producto anterior a la columna (o con una clave desconocida)
   * arranca con la tasa activa del sistema.
   */
  private storedRateKey(saved?: string | null): RateKey {
    const key = String(saved ?? '')
      .trim()
      .toUpperCase() as RateKey;
    return key in RATE_META ? key : this.activeRateKey;
  }

  /** `true` cuando el formulario declara una presentacion (caja/paquete). */
  get isBoxForm(): boolean {
    return this.boxUnits() > 1;
  }

  /** `true` cuando la unidad elegida es una presentacion (caja o paquete). */
  get isPackFormUnit(): boolean {
    return isPackUnit(this.form.unit);
  }

  /**
   * `true` cuando el formulario pide las unidades de la presentacion: al elegir
   * caja/paquete o cuando el producto ya venia guardado con mas de una unidad
   * por caja (asi se puede corregir la unidad sin perder ese dato).
   */
  get showPackUnits(): boolean {
    return this.isPackFormUnit || this.isBoxForm;
  }

  /** Etiqueta del campo de unidades segun la presentacion elegida. */
  get packUnitsLabel(): string {
    return this.form.unit === 'PAQUETE' ? 'Unidades por paquete' : 'Unidades por caja';
  }

  /**
   * Cambia la unidad del producto. Si deja de ser una presentacion se descarta lo
   * que se habia cargado como caja (`unitsPerBox = 1`): un producto vendido
   * suelto o medido en kg/L no tiene "unidades por caja".
   */
  onUnitChange(unit: ProductUnit): void {
    this.form.unit = unit;
    if (!isPackUnit(unit)) this.form.unitsPerBox = 1;
  }

  /**
   * Carga el costo de la presentacion. NO toca el precio unitario: cada monto lo
   * escribe el operador (el reparto se muestra solo como referencia en
   * `unitPriceReference`), asi el formulario nunca le pisa un monto ya cargado.
   */
  onCostChange(value: number): void {
    this.form.cost = value;
  }

  /**
   * Cambia el precio de venta de la unidad suelta. NO recalcula el precio de la
   * presentacion: son dos montos independientes y los decide el operador.
   */
  onUnitPriceChange(value: number): void {
    this.form.unitPrice = value;
  }

  /**
   * Cambia la moneda del costo de la presentacion. NO toca la moneda del precio
   * unitario: cada monto tiene su propio selector y el operador decide en que
   * moneda escribe cada uno.
   */
  onCostCurrencyChange(currency: string): void {
    this.form.costCurrency = currency;
  }

  /** Cambia la moneda del precio unitario (independiente de la presentacion). */
  onUnitPriceCurrencyChange(currency: string): void {
    this.form.unitPriceCurrency = currency;
  }

  /** Margen estimado (precio - costo) usado como ayuda en el formulario. */
  get margin(): { amount: number; percent: number } | null {
    // Se compara en USD (la moneda en la que se guardan ambos montos), cada monto
    // con la tasa que el operador eligio para el.
    const price = this.rates.toBase(
      this.form.price,
      this.form.priceCurrency,
      this.form.priceRateKey,
    );
    const cost = this.rates.toBase(
      this.form.cost,
      this.form.costCurrency,
      this.form.costRateKey,
    );
    if (price === null || cost === null) return null;
    if (!(price > 0 && cost > 0)) return null;
    // El margen conserva la precisión completa: se recorta solo al pintarlo.
    const amount = price - cost;
    return { amount, percent: Math.round((amount / price) * 1000) / 10 };
  }

  /** Unidades por caja listas para guardar (entero >= 1). */
  private boxUnits(): number {
    return boxUnitsOf({ unitsPerBox: this.form.unitsPerBox });
  }

  /**
   * Presentacion que se esta editando: la caja declarada con el precio al que se
   * vende su unidad suelta. Si el operador fijo un precio unitario, se usa ese;
   * si lo dejo en 0, se reparte el precio de la presentacion entre sus unidades.
   * Devuelve `null` cuando no es un producto por caja.
   */
  get boxPreview(): {
    units: number;
    unitLabel: string;
    unitPrice: number;
    currency: string;
  } | null {
    const units = this.boxUnits();
    if (units <= 1) return null;
    const explicit = Number(this.form.unitPrice) || 0;
    const price = Number(this.form.price) || 0;
    return {
      units,
      unitLabel: this.form.unit === 'PAQUETE' ? 'Paquete' : 'Caja',
      unitPrice: explicit > 0 ? explicit : divMoney(price, units),
      currency: explicit > 0 ? this.form.unitPriceCurrency : this.form.priceCurrency,
    };
  }

  /**
   * Cuanto saldria el precio de la unidad suelta si se reparte el precio de la
   * presentacion entre sus unidades, expresado en la MONEDA Y TASA DEL PRECIO
   * UNITARIO (que pueden ser distintas a las de la presentacion). Es SOLO una
   * referencia de lectura: el formulario nunca escribe en el campo (el operador
   * decide el monto que quiere vender). Devuelve `null` cuando falta la tasa para
   * convertir.
   */
  get unitPriceReference(): { amount: number; units: number; currency: string } | null {
    const units = this.boxUnits();
    if (units <= 1) return null;
    const price = Number(this.form.price) || 0;
    if (price <= 0) return null;
    const currency = this.form.unitPriceCurrency;
    const perUnit = this.rates.toBase(
      price,
      this.form.priceCurrency,
      this.form.priceRateKey,
    );
    if (perUnit === null) return null;
    const amount = this.rates.fromBase(
      divMoney(perUnit, units),
      currency,
      this.form.unitPriceRateKey,
    );
    if (amount === null) return null;
    return { amount, units, currency };
  }

  /** Existencias descritas en el idioma del negocio ("3 cajas + 5 unidades"). */
  stockLabel(product: Product): string {
    return packText(product.stock, product);
  }

  /** Como se cargo el precio, cuando no fue en dolares. */
  priceHint(product: Product): string | null {
    if (product.priceCurrency === BASE_CURRENCY.code) return null;
    if (product.priceEntered == null) return null;
    // Si la lista ya muestra el monto cargado (la moneda de visualizacion es la
    // misma en la que se escribio), el aviso repetiria el mismo numero.
    if (product.priceCurrency === displayBaseCode()) return null;
    return `Cargado en ${moneyIn(product.priceEntered, product.priceCurrency)}`;
  }

  /** Precio por unidad suelta de un producto del listado. */
  unitPriceOf(product: Product): number {
    return unitPriceOf(product);
  }

  /**
   * Monto que el operador escribio como precio de la unidad suelta, para que la
   * lista lo muestre tal cual (Bs 350,00 y no el equivalente en USD redondeado a
   * centavos). `null` cuando la venta reparte el precio de la presentacion.
   */
  unitPriceEnteredOf(product: Product): number | null {
    return loadedUnitPrice(product)?.amount ?? null;
  }

  /** Tasa elegida para el precio unitario cargado (solo cuando es el que se cobra). */
  unitPriceRateKeyOf(product: Product): string | null {
    return loadedUnitPrice(product)?.rateKey ?? null;
  }

  load(): void {
    this.loading.set(true);
    this.products
      .list({
        page: this.page,
        limit: this.limit,
        search: this.search.trim() || undefined,
        categoryId: this.categoryId || undefined,
        supplierId: this.supplierId || undefined,
        onlyActive: this.onlyActive ? true : undefined,
        sortBy: this.sortBy || undefined,
        sortOrder: this.sortBy ? this.sortOrder : undefined,
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

  onCategoryChange(value: string): void {
    this.categoryId = value;
    this.applyFilters();
  }

  onSupplierChange(value: string): void {
    this.supplierId = value;
    this.applyFilters();
  }

  onActiveChange(value: boolean): void {
    this.onlyActive = value;
    this.applyFilters();
  }

  resetFilters(): void {
    this.search = '';
    this.categoryId = '';
    this.supplierId = '';
    this.onlyActive = false;
    this.sortBy = '';
    this.sortOrder = 'asc';
    this.applyFilters();
  }

  sort(field: string): void {
    if (this.sortBy === field) {
      this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortBy = field;
      this.sortOrder = 'asc';
    }
    this.applyFilters();
  }

  sortIcon(field: string): string {
    if (this.sortBy !== field) return 'filter';
    return this.sortOrder === 'asc' ? 'trend-up' : 'trend-down';
  }

  /** Marca los productos cuyo stock esta por debajo del minimo configurado. */
  isLowStock(item: Product): boolean {
    return item.stock <= item.minStock;
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

  openCreate(): void {
    this.editing.set(null);
    this.form = this.emptyForm();
    this.imageError.set(null);
    this.modalOpen.set(true);
  }

  openEdit(item: Product): void {
    this.editing.set(item);
    this.form = {
      sku: item.sku,
      name: item.name,
      description: item.description ?? '',
      imageUrl: item.imageUrl ?? '',
      // Se recupera lo que se escribio (y en que moneda y tasa) para no perder el
      // contexto al reabrir el formulario.
      price: item.priceEntered ?? item.price,
      priceCurrency: item.priceCurrency,
      priceRateKey: this.storedRateKey(item.priceRateKey),
      cost: item.costEntered ?? item.cost,
      costCurrency: item.costCurrency,
      costRateKey: this.storedRateKey(item.costRateKey),
      unitPrice: item.unitPriceEntered ?? item.unitPrice,
      // Los productos anteriores a la columna `unitPriceCurrency` usan la moneda
      // del precio de la presentacion.
      unitPriceCurrency: item.unitPriceCurrency ?? item.priceCurrency,
      unitPriceRateKey: this.storedRateKey(item.unitPriceRateKey),
      stock: item.stock,
      minStock: item.minStock,
      unit: item.unit,
      unitsPerBox: item.unitsPerBox,
      trackStock: item.trackStock,
      categoryId: item.categoryId ?? '',
      supplierId: item.supplierId ?? '',
      active: item.active,
    };
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.modalOpen.set(false);
  }

  /**
   * Reduce la foto elegida y la sube por multipart. En el formulario solo queda
   * la URL local `/media/...` que devuelve el backend.
   */
  async onImageSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Se limpia el input para poder volver a elegir el mismo archivo.
    input.value = '';
    if (!file) return;

    this.imageError.set(null);
    this.imageReading.set(true);
    try {
      const image = await toProductImageFile(file);
      const uploaded = await firstValueFrom(
        this.media.upload(image, 'products', file.name),
      );
      this.form.imageUrl = uploaded.url;
    } catch (error) {
      this.imageError.set(apiErrorMessage(error));
    } finally {
      this.imageReading.set(false);
    }
  }

  /** Quita la foto del producto (se guarda al enviar el formulario). */
  clearImage(): void {
    this.form.imageUrl = '';
    this.imageError.set(null);
  }

  save(): void {
    if (this.saving()) return;
    this.saving.set(true);

    const current = this.editing();
    const payload: ProductPayload = {
      name: this.form.name.trim(),
      description: this.form.description.trim() || undefined,
      // Cadena vacia = el backend guarda `null` (producto sin foto).
      imageUrl: this.form.imageUrl.trim(),
      // El backend convierte a USD con la tasa del sistema (la guardada o la
      // activa) y guarda el contexto (moneda, monto escrito y tasa).
      price: Number(this.form.price) || 0,
      priceCurrency: this.form.priceCurrency,
      priceRateKey: this.form.priceRateKey,
      cost: Number(this.form.cost) || 0,
      costCurrency: this.form.costCurrency,
      costRateKey: this.form.costRateKey,
      minStock: Number(this.form.minStock) || 0,
      unit: this.form.unit,
      unitsPerBox: this.boxUnits(),
      trackStock: this.form.trackStock,
      categoryId: this.form.categoryId || null,
      supplierId: this.form.supplierId || null,
      active: this.form.active,
    };
    // El precio unitario solo aplica a las presentaciones (cajas/paquetes) y lleva
    // su propia moneda y tasa: el backend convierte cada monto por separado. Si el
    // producto deja de ser una presentacion se envia 0 (sin definir) para que el
    // POS vuelva a repartir el precio entre las unidades.
    payload.unitPrice = this.isBoxForm ? Number(this.form.unitPrice) || 0 : 0;
    payload.unitPriceCurrency = this.form.unitPriceCurrency;
    payload.unitPriceRateKey = this.form.unitPriceRateKey;
    const sku = this.form.sku.trim();
    if (sku) payload.sku = sku;
    // El stock solo se envia al crear: el backend genera el movimiento IN inicial.
    if (!current) payload.stock = Number(this.form.stock) || 0;

    const request = current
      ? this.products.update(current.id, payload)
      : this.products.create(payload);

    request.subscribe({
      next: () => {
        this.saving.set(false);
        this.closeModal();
        this.toast.success(current ? 'Producto actualizado' : 'Producto creado');
        this.load();
      },
      error: () => this.saving.set(false),
    });
  }

  async remove(item: Product): Promise<void> {
    const confirmed = await this.confirm.ask({
      title: 'Desactivar producto',
      message: `¿Desactivar "${item.name}"? Dejará de estar disponible para la venta.`,
      confirmLabel: 'Eliminar',
      tone: 'danger',
    });
    if (!confirmed) return;

    this.products.deactivate(item.id).subscribe({
      next: (result) => {
        this.toast.success('Producto desactivado');
        // Desactivar NO lo quita de las recetas que ya lo usan: esos menus
        // quedan sin poder venderse hasta que se corrija el ingrediente.
        const menus = result.affectedMenus ?? [];
        if (menus.length > 0) {
          this.toast.warning(
            `Menú(s) que siguen usando "${item.name}": ${menus
              .map((menu) => menu.name)
              .join(', ')}. Quedan sin poder venderse hasta reemplazarlo en la receta.`,
            'Revisa las recetas',
          );
        }
        this.load();
      },
      error: (error) => this.toast.error(apiErrorMessage(error)),
    });
  }
}
