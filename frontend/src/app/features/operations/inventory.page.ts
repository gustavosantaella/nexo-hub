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
import { AuthService } from '../../core/services/auth.service';
import { InventoryService } from '../../core/services/inventory.service';
import { ToastService } from '../../core/services/toast.service';
import { apiErrorMessage, dateTime, number } from '../../core/utils/format';
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
    StatCardComponent,
    EmptyStateComponent,
    LoaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header
      title="Inventario"
      subtitle="Niveles de stock y trazabilidad de movimientos"
      icon="box"
    >
      <button type="button" class="btn-primary" (click)="openMovement()">
        <app-icon name="plus" size="h-4 w-4" />
        Registrar movimiento
      </button>
    </app-page-header>

    <div class="mb-4 flex gap-1 border-b border-slate-200">
      <button
        type="button"
        class="px-4 py-2 text-sm font-medium"
        [class]="tab() === 'stock' ? activeTabClass : inactiveTabClass"
        (click)="tab.set('stock')"
      >
        Stock
      </button>
      <button
        type="button"
        class="px-4 py-2 text-sm font-medium"
        [class]="tab() === 'movements' ? activeTabClass : inactiveTabClass"
        (click)="tab.set('movements')"
      >
        Movimientos
      </button>
    </div>

    @if (tab() === 'stock') {
      <div class="grid gap-4 sm:grid-cols-3">
        <app-stat-card label="Productos" [value]="productCount()" icon="box" tone="brand" />
        <app-stat-card label="Valor de inventario" [value]="inventoryValue()" icon="money" tone="sky" [isCurrency]="true" />
        <app-stat-card label="Bajo mínimo" [value]="lowStockCount()" icon="alert" tone="rose" />
      </div>

      <div class="card mt-4">
        <div class="card-header">
          <div class="flex w-full max-w-md items-center gap-2">
            <div class="relative flex-1">
              <span class="pointer-events-none absolute left-3 top-2.5 text-slate-400">
                <app-icon name="search" size="h-4 w-4" />
              </span>
              <input
                class="input pl-9"
                placeholder="Buscar por nombre o SKU…"
                [(ngModel)]="search"
                (keyup.enter)="applySearch()"
              />
            </div>
            <button type="button" class="btn-secondary" (click)="applySearch()">Buscar</button>
          </div>
          <label class="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              class="h-4 w-4 rounded border-slate-300"
              [(ngModel)]="lowOnly"
              (ngModelChange)="loadStock()"
            />
            Solo bajo stock
          </label>
        </div>

        @if (stockLoading()) {
          <app-loader />
        } @else if (stockItems().length === 0) {
          <app-empty-state
            title="Sin productos"
            message="No hay productos que coincidan con los filtros."
            icon="box"
          />
        } @else {
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Producto</th>
                  <th>Categoría</th>
                  <th>Stock</th>
                  <th class="text-right">Mínimo</th>
                  <th class="text-right">Costo</th>
                  <th class="text-right">Precio</th>
                  <th class="text-right">Valor</th>
                  <th class="text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                @for (item of stockItems(); track item.id) {
                  <tr>
                    <td class="text-slate-500">{{ item.sku }}</td>
                    <td class="font-medium text-slate-900">{{ item.name }}</td>
                    <td>{{ item.category?.name || '—' }}</td>
                    <td>
                      <div class="flex items-center gap-2">
                        <span>{{ number(item.stock) }} {{ unitLabels[item.unit] || item.unit }}</span>
                        @if (item.isLowStock) {
                          <span class="badge bg-rose-100 text-rose-700">Bajo mínimo</span>
                        }
                      </div>
                    </td>
                    <td class="text-right">{{ number(item.minStock) }}</td>
                    <td class="text-right"><app-money [amount]="item.cost" alignEnd="true" /></td>
                    <td class="text-right"><app-money [amount]="item.price" alignEnd="true" /></td>
                    <td class="text-right font-medium"><app-money [amount]="item.stockValue" alignEnd="true" /></td>
                    <td class="text-right">
                      <div class="flex justify-end gap-1">
                        <button type="button" class="btn-secondary btn-sm" (click)="openMovement(item)">
                          Movimiento
                        </button>
                        @if (auth.canManage()) {
                          <button type="button" class="btn-ghost btn-sm" (click)="openAdjust(item)">
                            Ajustar
                          </button>
                        }
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>
    }

    @if (tab() === 'movements') {
      <div class="card mb-4">
        <div class="card-body grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label class="label">Producto</label>
            <select class="input" [(ngModel)]="mProduct" (ngModelChange)="applyMovementFilters()">
              <option value="">Todos</option>
              @for (item of stockItems(); track item.id) {
                <option [value]="item.id">{{ item.name }}</option>
              }
            </select>
          </div>
          <div>
            <label class="label">Tipo</label>
            <select class="input" [(ngModel)]="mType" (ngModelChange)="applyMovementFilters()">
              <option value="">Todos</option>
              @for (option of movementOptions; track option.value) {
                <option [value]="option.value">{{ option.label }}</option>
              }
            </select>
          </div>
          <div>
            <label class="label">Desde</label>
            <input type="date" class="input" [(ngModel)]="mFrom" (ngModelChange)="applyMovementFilters()" />
          </div>
          <div>
            <label class="label">Hasta</label>
            <input type="date" class="input" [(ngModel)]="mTo" (ngModelChange)="applyMovementFilters()" />
          </div>
        </div>
      </div>

      <div class="card">
        @if (movLoading()) {
          <app-loader />
        } @else if (movItems().length === 0) {
          <app-empty-state
            title="Sin movimientos"
            message="No hay movimientos de inventario en el rango seleccionado."
            icon="box"
          />
        } @else {
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Producto</th>
                  <th>Tipo</th>
                  <th class="text-right">Cantidad</th>
                  <th class="text-center">Antes → Después</th>
                  <th class="text-right">Costo unit.</th>
                  <th>Motivo</th>
                  <th>Usuario</th>
                </tr>
              </thead>
              <tbody>
                @for (movement of movItems(); track movement.id) {
                  <tr>
                    <td>{{ dateTime(movement.createdAt) }}</td>
                    <td class="font-medium text-slate-900">{{ movement.product?.name || '—' }}</td>
                    <td>
                      @if (movement.type === 'IN') {
                        <span class="badge bg-emerald-100 text-emerald-700">Entrada</span>
                      } @else if (movement.type === 'OUT') {
                        <span class="badge bg-rose-100 text-rose-700">Salida</span>
                      } @else {
                        <span class="badge bg-sky-100 text-sky-700">Ajuste</span>
                      }
                    </td>
                    <td class="text-right">{{ number(movement.quantity) }}</td>
                    <td class="text-center text-slate-500">
                      {{ number(movement.stockBefore) }} → {{ number(movement.stockAfter) }}
                    </td>
                    <td class="text-right">
                      @if (movement.unitCost != null) {
                        <app-money [amount]="movement.unitCost" alignEnd="true" />
                      } @else {
                        —
                      }
                    </td>
                    <td>{{ movement.reason || '—' }}</td>
                    <td>{{ movement.createdBy?.name || '—' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <app-pagination
            [meta]="movMeta()"
            (pageChange)="changePage($event)"
            (limitChange)="changeLimit($event)"
          />
        }
      </div>
    }

    <app-modal [open]="movOpen()" title="Registrar movimiento" (closed)="closeMovement()">
      <div class="space-y-3">
        <div>
          <label class="label">Producto</label>
          <select class="input" [(ngModel)]="movForm.productId">
            <option value="">Selecciona un producto…</option>
            @for (item of stockItems(); track item.id) {
              <option [value]="item.id">
                {{ item.name }} · stock {{ number(item.stock) }}
              </option>
            }
          </select>
        </div>
        <div>
          <label class="label">Tipo</label>
          <select class="input" [(ngModel)]="movForm.type">
            @for (option of movementOptions; track option.value) {
              <option [value]="option.value">{{ option.label }}</option>
            }
          </select>
        </div>
        <div>
          <label class="label">{{ quantityLabel }}</label>
          <input type="number" class="input" min="1" [(ngModel)]="movForm.quantity" />
        </div>
        @if (showUnitCost) {
          <div>
            <label class="label">Costo unitario</label>
            <input type="number" class="input" min="0" [(ngModel)]="movForm.unitCost" />
          </div>
        }
        <div>
          <label class="label">Motivo</label>
          <input class="input" [(ngModel)]="movForm.reason" placeholder="Opcional" />
        </div>
      </div>

      <div modalFooter class="flex w-full justify-end gap-2">
        <button type="button" class="btn-secondary" (click)="closeMovement()">Cancelar</button>
        <button type="button" class="btn-primary" [disabled]="movSaving()" (click)="submitMovement()">
          {{ movSaving() ? 'Guardando…' : 'Registrar' }}
        </button>
      </div>
    </app-modal>

    <app-modal [open]="adjOpen()" title="Ajustar stock" (closed)="closeAdjust()">
      @if (adjProduct(); as product) {
        <div class="space-y-3">
          <div class="rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <div class="flex justify-between">
              <span class="text-slate-500">Producto</span>
              <span class="font-medium">{{ product.name }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-500">Stock actual</span>
              <span class="font-medium">{{ number(product.stock) }} {{ unitLabels[product.unit] || product.unit }}</span>
            </div>
          </div>
          <div>
            <label class="label">Stock final</label>
            <input type="number" class="input" min="0" [(ngModel)]="adjForm.newStock" />
          </div>
          <div>
            <label class="label">Motivo</label>
            <input class="input" [(ngModel)]="adjForm.reason" placeholder="Opcional" />
          </div>
        </div>
      }

      <div modalFooter class="flex w-full justify-end gap-2">
        <button type="button" class="btn-secondary" (click)="closeAdjust()">Cancelar</button>
        <button type="button" class="btn-primary" [disabled]="adjSaving()" (click)="submitAdjust()">
          {{ adjSaving() ? 'Ajustando…' : 'Ajustar stock' }}
        </button>
      </div>
    </app-modal>
  `,
})
export class InventoryPage implements OnInit {
  readonly auth = inject(AuthService);
  private readonly inventory = inject(InventoryService);
  private readonly toast = inject(ToastService);

  readonly dateTime = dateTime;
  readonly number = number;
  readonly movementOptions = STOCK_MOVEMENT_OPTIONS;
  readonly movementLabels = STOCK_MOVEMENT_LABELS;
  readonly unitLabels = PRODUCT_UNIT_LABELS;

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
  movForm = {
    productId: '',
    type: 'IN' as StockMovementType,
    quantity: 1,
    unitCost: 0,
    reason: '',
  };

  readonly adjOpen = signal(false);
  readonly adjSaving = signal(false);
  readonly adjProduct = signal<StockLevel | null>(null);
  adjForm = { newStock: 0, reason: '' };

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

  get quantityLabel(): string {
    return this.movForm.type === 'ADJUSTMENT' ? 'Stock final' : 'Cantidad';
  }

  get showUnitCost(): boolean {
    return this.movForm.type === 'IN';
  }

  openMovement(product?: StockLevel): void {
    this.movForm = {
      productId: product?.id ?? '',
      type: 'IN',
      quantity: 1,
      unitCost: 0,
      reason: '',
    };
    this.movOpen.set(true);
  }

  closeMovement(): void {
    this.movOpen.set(false);
  }

  submitMovement(): void {
    if (this.movSaving()) return;
    if (!this.movForm.productId) {
      this.toast.error('Selecciona un producto');
      return;
    }
    this.movSaving.set(true);
    const payload: MovementPayload = {
      productId: this.movForm.productId,
      type: this.movForm.type,
      quantity: Number(this.movForm.quantity) || 0,
      reason: this.movForm.reason || undefined,
    };
    if (this.movForm.type === 'IN') {
      payload.unitCost = Number(this.movForm.unitCost) || undefined;
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
    this.adjForm = { newStock: product.stock, reason: '' };
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
    this.inventory
      .adjust(product.id, { newStock, reason: this.adjForm.reason || undefined })
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
