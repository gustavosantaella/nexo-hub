import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
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
import { number } from '../../core/utils/format';
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
  price: number;
  cost: number;
  stock: number;
  minStock: number;
  unit: ProductUnit;
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
                  <td class="font-medium text-slate-900">{{ item.name }}</td>
                  <td class="text-slate-500">{{ item.category?.name || '—' }}</td>
                  <td class="text-slate-500">{{ item.supplier?.name || '—' }}</td>
                  <td class="text-right"><app-money [amount]="item.price" alignEnd="true" /></td>
                  <td class="text-right text-slate-500"><app-money [amount]="item.cost" alignEnd="true" /></td>
                  <td class="text-right">
                    <span class="inline-flex items-center gap-2">
                      <span>{{ number(item.stock) }} {{ item.unit }}</span>
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
          <div>
            <label class="label" for="prod-price">Precio (PEN) *</label>
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
            <label class="label" for="prod-cost">Costo (PEN)</label>
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
  /** Helpers de formato expuestos a la plantilla. */
  readonly number = number;
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
      price: 0,
      cost: 0,
      stock: 0,
      minStock: 0,
      unit: 'UND',
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
    this.modalOpen.set(true);
  }

  openEdit(item: Product): void {
    this.editing.set(item);
    this.form = {
      sku: item.sku,
      name: item.name,
      description: item.description ?? '',
      price: item.price,
      cost: item.cost,
      stock: item.stock,
      minStock: item.minStock,
      unit: item.unit,
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

  save(): void {
    if (this.saving()) return;
    this.saving.set(true);

    const current = this.editing();
    const payload: ProductPayload = {
      name: this.form.name.trim(),
      description: this.form.description.trim() || undefined,
      price: Number(this.form.price) || 0,
      cost: Number(this.form.cost) || 0,
      minStock: Number(this.form.minStock) || 0,
      unit: this.form.unit,
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
