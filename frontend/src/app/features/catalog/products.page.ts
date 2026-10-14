import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BASE_CURRENCY } from '../../core/constants/currency';
import { PRODUCT_UNIT_OPTIONS } from '../../core/constants/domain';
import type {
  Category,
  PaginationMeta,
  Product,
  ProductPayload,
  ProductUnit,
  Supplier,
} from '../../core/models/api.model';
import { AuthService } from '../../core/services/auth.service';
import {
  CategoriesService,
  ProductsService,
  SuppliersService,
} from '../../core/services/catalog.service';
import { ToastService } from '../../core/services/toast.service';
import { apiErrorMessage, divMoney, number } from '../../core/utils/format';
import {
  boxUnitsOf,
  isBoxProduct,
  soldUnitLabel,
  unitPriceOf,
} from '../../core/utils/product-pricing';
import { PRODUCT_IMAGE_MAX_SIZE, toProductImageDataUrl } from '../../core/utils/image';
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
  /** Foto del producto (URL o data URL reducido en el navegador). */
  imageUrl: string;
  price: number;
  cost: number;
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
    EmptyStateComponent,
    LoaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `    <app-page-header
      title="Productos"
      subtitle="Catálogo de productos, precios y control de stock"
      icon="box"
    >
      @if (auth.canManage()) {
        <button type="button" class="btn-primary" (click)="openCreate()">
          <app-icon name="plus" size="h-4 w-4" />
          Nuevo producto
        </button>
      }
    </app-page-header>

    <section class="card">
      <div class="card-header">
        <div class="flex flex-wrap items-center gap-2">
          <div class="relative w-56">
            <span class="pointer-events-none absolute left-3 top-2.5 text-slate-400">
              <app-icon name="search" size="h-4 w-4" />
            </span>
            <input
              class="input pl-9"
              placeholder="Buscar por nombre, SKU…"
              [(ngModel)]="search"
              (keyup.enter)="applyFilters()"
            />
          </div>
          <select
            class="input w-44"
            [ngModel]="categoryId"
            (ngModelChange)="onCategoryChange($event)"
          >
            <option value="">Todas las categorías</option>
            @for (category of categoryOptions(); track category.id) {
              <option [value]="category.id">{{ category.name }}</option>
            }
          </select>
          <select
            class="input w-44"
            [ngModel]="supplierId"
            (ngModelChange)="onSupplierChange($event)"
          >
            <option value="">Todos los proveedores</option>
            @for (supplier of supplierOptions(); track supplier.id) {
              <option [value]="supplier.id">{{ supplier.name }}</option>
            }
          </select>
          <label class="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              class="h-4 w-4"
              [ngModel]="onlyActive"
              (ngModelChange)="onActiveChange($event)"
            />
            Solo activos
          </label>
          <button type="button" class="btn-secondary" (click)="applyFilters()">Buscar</button>
          <button type="button" class="btn-ghost btn-sm" (click)="resetFilters()">Limpiar</button>
        </div>
      </div>

      @if (loading()) {
        <app-loader />
      } @else if (items().length === 0) {
        <app-empty-state
          title="Sin productos"
          message="Ajusta los filtros o registra tu primer producto para empezar a vender."
          icon="box"
        />
      } @else {
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>SKU</th>
                <th class="cursor-pointer select-none" (click)="sort('name')">
                  <span class="inline-flex items-center gap-1">
                    Nombre
                    <app-icon [name]="sortIcon('name')" size="h-3.5 w-3.5" />
                  </span>
                </th>
                <th>Categoría</th>
                <th>Proveedor</th>
                <th class="cursor-pointer select-none text-right" (click)="sort('price')">
                  <span class="inline-flex items-center gap-1">
                    Precio
                    <app-icon [name]="sortIcon('price')" size="h-3.5 w-3.5" />
                  </span>
                </th>
                <th class="text-right">Costo</th>
                <th class="cursor-pointer select-none text-right" (click)="sort('stock')">
                  <span class="inline-flex items-center gap-1">
                    Stock
                    <app-icon [name]="sortIcon('stock')" size="h-3.5 w-3.5" />
                  </span>
                </th>
                <th class="text-center">Estado</th>
                <th class="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              @for (item of items(); track item.id) {
                <tr>
                  <td class="font-mono text-xs text-slate-500">{{ item.sku }}</td>
                  <td>
                    <div class="flex items-center gap-3">
                      <span
                        class="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
                      >
                        @if (item.imageUrl) {
                          <img [src]="item.imageUrl" alt="" class="h-full w-full object-cover" />
                        } @else {
                          <app-icon name="image" size="h-4 w-4" class="text-slate-300" />
                        }
                      </span>
                      <span class="font-medium text-slate-900">{{ item.name }}</span>
                    </div>
                  </td>
                  <td class="text-slate-500">{{ item.category?.name || '—' }}</td>
                  <td class="text-slate-500">{{ item.supplier?.name || '—' }}</td>
                  <td class="text-right">
                    <app-money [amount]="item.price" alignEnd="true" />
                    @if (isBoxProduct(item)) {
                      <span class="block text-[11px] text-slate-400">
                        Caja de {{ boxUnitsOf(item) }} = <app-money [amount]="unitPriceOf(item)" />
                        / {{ soldUnitLabel(item) }}
                      </span>
                    }
                  </td>
                  <td class="text-right text-slate-500"><app-money [amount]="item.cost" alignEnd="true" /></td>
                  <td class="text-right">
                    <span class="inline-flex items-center gap-2">
                      <span>{{ number(item.stock) }} {{ soldUnitLabel(item) }}</span>
                      @if (isLowStock(item)) {
                        <span
                          class="badge bg-rose-100 text-rose-700"
                          title="Stock por debajo del mínimo"
                        >
                          Bajo
                        </span>
                      }
                    </span>
                  </td>
                  <td class="text-center">
                    <span
                      class="badge"
                      [class]="item.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'"
                    >
                      {{ item.active ? 'Activo' : 'Inactivo' }}
                    </span>
                  </td>
                  <td>
                    <div class="flex justify-end gap-1">
                      @if (auth.canManage()) {
                        <button
                          type="button"
                          class="btn-ghost btn-sm"
                          (click)="openEdit(item)"
                          title="Editar"
                        >
                          <app-icon name="edit" size="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          class="btn-ghost btn-sm text-rose-600"
                          (click)="remove(item)"
                          title="Desactivar"
                        >
                          <app-icon name="trash" size="h-4 w-4" />
                        </button>
                      }
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <app-pagination
          [meta]="meta()"
          (pageChange)="changePage($event)"
          (limitChange)="changeLimit($event)"
        />
      }
    </section>
    <app-modal
      [open]="modalOpen()"
      [title]="editing() ? 'Editar producto' : 'Nuevo producto'"
      subtitle="Precios, stock y clasificación del producto"
      size="lg"
      (closed)="closeModal()"
    >
      <form class="space-y-4" (ngSubmit)="save()" #productForm="ngForm">
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label class="label" for="prod-sku">SKU</label>
            <input
              id="prod-sku"
              name="sku"
              class="input"
              [(ngModel)]="form.sku"
              placeholder="Ej. BEB-001"
            />
            <p class="mt-1 text-xs text-slate-400">Se genera automáticamente si lo dejas vacío.</p>
          </div>
          <div>
            <label class="label" for="prod-name">Nombre *</label>
            <input
              id="prod-name"
              name="name"
              class="input"
              required
              minlength="2"
              [(ngModel)]="form.name"
              placeholder="Ej. Inca Kola 500 ml"
            />
          </div>
          <div class="sm:col-span-2">
            <label class="label" for="prod-desc">Descripción</label>
            <textarea
              id="prod-desc"
              name="description"
              class="input"
              rows="2"
              [(ngModel)]="form.description"
              placeholder="Detalle opcional del producto"
            ></textarea>
          </div>
          <div class="sm:col-span-2">
            <span class="label">Foto para el punto de venta</span>
            <div class="flex flex-wrap items-center gap-3">
              <div
                class="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-slate-300 bg-slate-50"
              >
                @if (form.imageUrl) {
                  <img
                    [src]="form.imageUrl"
                    alt="Foto del producto"
                    class="h-full w-full object-cover"
                  />
                } @else {
                  <app-icon name="image" size="h-7 w-7" class="text-slate-400" />
                }
              </div>
              <div class="flex flex-col gap-2">
                <div class="flex flex-wrap gap-2">
                  <label class="btn-secondary btn-sm cursor-pointer" for="prod-image">
                    <app-icon name="image" size="h-4 w-4" />
                    {{ imageReading() ? 'Leyendo…' : 'Subir foto' }}
                  </label>
                  <input
                    id="prod-image"
                    type="file"
                    class="hidden"
                    accept="image/png,image/jpeg,image/webp"
                    (change)="onImageSelected($event)"
                  />
                  @if (form.imageUrl) {
                    <button type="button" class="btn-ghost btn-sm text-rose-600" (click)="clearImage()">
                      <app-icon name="trash" size="h-4 w-4" />
                      Quitar
                    </button>
                  }
                </div>
                <input
                  name="imageUrl"
                  class="input w-72"
                  placeholder="…o pega la URL de la imagen"
                  [(ngModel)]="form.imageUrl"
                />
              </div>
            </div>
            <p class="mt-1 text-xs text-slate-400">
              Se reduce a {{ productImageMaxSize }} px de ancho para que la grilla del cajero cargue
              rápido.
            </p>
            @if (imageError(); as error) {
              <p class="mt-1 text-xs text-rose-600">{{ error }}</p>
            }
          </div>
          <div>
            <label class="label" for="prod-price">Precio ({{ baseCurrency.code }}) *</label>
            <input
              id="prod-price"
              name="price"
              type="number"
              step="0.01"
              min="0"
              class="input"
              required
              [(ngModel)]="form.price"
            />
          </div>
          <div>
            <label class="label" for="prod-cost">Costo ({{ baseCurrency.code }})</label>
            <input
              id="prod-cost"
              name="cost"
              type="number"
              step="0.01"
              min="0"
              class="input"
              [(ngModel)]="form.cost"
            />
          </div>
          @if (editing()) {
            <div>
              <label class="label" for="prod-stock">Stock actual</label>
              <input id="prod-stock" class="input" [value]="form.stock" disabled />
              <p class="mt-1 text-xs text-slate-400">
                El stock se ajusta desde Inventario (movimientos).
              </p>
            </div>
          } @else {
            <div>
              <label class="label" for="prod-stock-new">Stock inicial (genera movimiento IN)</label>
              <input
                id="prod-stock-new"
                name="stock"
                type="number"
                min="0"
                step="0.01"
                class="input"
                [(ngModel)]="form.stock"
              />
            </div>
          }
          <div>
            <label class="label" for="prod-min">Stock mínimo</label>
            <input
              id="prod-min"
              name="minStock"
              type="number"
              min="0"
              step="0.01"
              class="input"
              [(ngModel)]="form.minStock"
            />
          </div>
          <div>
            <label class="label" for="prod-unit">Unidad</label>
            <select id="prod-unit" name="unit" class="input" [(ngModel)]="form.unit">
              @for (option of unitOptions; track option.value) {
                <option [value]="option.value">{{ option.label }}</option>
              }
            </select>
          </div>
          <div>
            <label class="label" for="prod-units-per-box">Unidades por caja</label>
            <input
              id="prod-units-per-box"
              name="unitsPerBox"
              type="number"
              min="1"
              step="1"
              class="input"
              [(ngModel)]="form.unitsPerBox"
            />
            <p class="mt-1 text-[11px] text-slate-400">
              El precio de arriba es el de la presentación; el stock se lleva en unidades sueltas.
              Deja 1 si el producto se vende suelto.
            </p>
            @if (boxPreview; as box) {
              <p class="mt-1 text-[11px] font-medium text-brand-600">
                Caja de {{ box.units }} → la unidad suelta se vende a
                <app-money [amount]="box.unitPrice" />
              </p>
            }
          </div>
          <div>
            <label class="label" for="prod-category">Categoría</label>
            <select id="prod-category" name="categoryId" class="input" [(ngModel)]="form.categoryId">
              <option value="">Sin categoría</option>
              @for (category of categoryOptions(); track category.id) {
                <option [value]="category.id">{{ category.name }}</option>
              }
            </select>
          </div>
          <div>
            <label class="label" for="prod-supplier">Proveedor</label>
            <select id="prod-supplier" name="supplierId" class="input" [(ngModel)]="form.supplierId">
              <option value="">Sin proveedor</option>
              @for (supplier of supplierOptions(); track supplier.id) {
                <option [value]="supplier.id">{{ supplier.name }}</option>
              }
            </select>
          </div>
        </div>

        @if (margin; as m) {
          <p class="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            Margen estimado:
            <strong><app-money [amount]="m.amount" /></strong>
            ({{ m.percent }}% sobre el precio de venta).
          </p>
        }

        <div class="flex flex-wrap items-center gap-5">
          <label class="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" name="trackStock" class="h-4 w-4" [(ngModel)]="form.trackStock" />
            Controlar stock
          </label>
          <label class="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" name="active" class="h-4 w-4" [(ngModel)]="form.active" />
            Producto activo
          </label>
        </div>

        <div modalFooter class="flex w-full justify-end gap-2">
          <button type="button" class="btn-secondary" (click)="closeModal()">Cancelar</button>
          <button type="submit" class="btn-primary" [disabled]="saving() || productForm.invalid">
            {{ saving() ? 'Guardando…' : 'Guardar' }}
          </button>
        </div>
      </form>
    </app-modal>
`,
})
export class ProductsPage implements OnInit {
  /**
   * Moneda base del sistema: los precios y costos del catálogo se guardan y se
   * muestran en ella (no en soles peruanos).
   */
  readonly baseCurrency = BASE_CURRENCY;
  /** Helpers de formato expuestos a la plantilla. */
  readonly number = number;
  /** `true` cuando el producto se vende por caja (precio de caja, stock por unidad). */
  readonly isBoxProduct = isBoxProduct;
  readonly boxUnitsOf = boxUnitsOf;
  readonly soldUnitLabel = soldUnitLabel;
  readonly auth = inject(AuthService);
  private readonly products = inject(ProductsService);
  private readonly categories = inject(CategoriesService);
  private readonly suppliers = inject(SuppliersService);
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
    return {
      sku: '',
      name: '',
      description: '',
      imageUrl: '',
      price: 0,
      cost: 0,
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

  /** Margen estimado (precio - costo) usado como ayuda en el formulario. */
  get margin(): { amount: number; percent: number } | null {
    const price = Number(this.form.price);
    const cost = Number(this.form.cost);
    if (!(price > 0 && cost > 0)) return null;
    const amount = Math.round((price - cost) * 100) / 100;
    return { amount, percent: Math.round((amount / price) * 1000) / 10 };
  }

  /** Unidades por caja listas para guardar (entero >= 1). */
  private boxUnits(): number {
    return boxUnitsOf({ unitsPerBox: this.form.unitsPerBox });
  }

  /**
   * Presentacion que se esta editando: la caja declarada, con el precio de la
   * presentacion repartido entre sus unidades (lo que cobra el POS al vender
   * suelto). Devuelve `null` cuando no es un producto por caja.
   */
  get boxPreview(): { units: number; unitPrice: number } | null {
    const units = this.boxUnits();
    if (units <= 1) return null;
    const price = Number(this.form.price) || 0;
    return { units, unitPrice: divMoney(price, units) };
  }

  /** Precio por unidad suelta de un producto del listado. */
  unitPriceOf(product: Product): number {
    return unitPriceOf(product);
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
      price: item.price,
      cost: item.cost,
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

  /** Lee la foto elegida y la reduce antes de guardarla en el formulario. */
  async onImageSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Se limpia el input para poder volver a elegir el mismo archivo.
    input.value = '';
    if (!file) return;

    this.imageError.set(null);
    this.imageReading.set(true);
    try {
      this.form.imageUrl = await toProductImageDataUrl(file);
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
      price: Number(this.form.price) || 0,
      cost: Number(this.form.cost) || 0,
      minStock: Number(this.form.minStock) || 0,
      unit: this.form.unit,
      unitsPerBox: this.boxUnits(),
      trackStock: this.form.trackStock,
      categoryId: this.form.categoryId || null,
      supplierId: this.form.supplierId || null,
      active: this.form.active,
    };
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

    this.products.remove(item.id).subscribe({
      next: () => {
        this.toast.success('Producto desactivado');
        this.load();
      },
    });
  }
}
