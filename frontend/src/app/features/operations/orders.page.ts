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
import { BASE_CURRENCY, RATE_META, type RateMeta } from '../../core/constants/currency';
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
  template: `
    <app-page-header
      title="Pedidos"
      subtitle="Tablero operativo y historial de ventas"
      icon="receipt"
    >
      <button type="button" class="btn-primary" (click)="openCreate()">
        <app-icon name="plus" size="h-4 w-4" />
        Nuevo pedido
      </button>
    </app-page-header>

    @if (!cashOpen()) {
      <div
        class="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
      >
        <app-icon name="alert" size="h-4 w-4" />
        <span>No hay una caja abierta: los cobros requieren una sesión de caja activa.</span>
        <a routerLink="/panel/caja" class="ml-auto font-semibold underline">Abrir caja</a>
      </div>
    }

    <div class="mb-4 flex gap-1 border-b border-slate-200">
      <button
        type="button"
        class="px-4 py-2 text-sm font-medium"
        [class]="tab() === 'board' ? activeTabClass : inactiveTabClass"
        (click)="tab.set('board')"
      >
        Tablero
      </button>
      <button
        type="button"
        class="px-4 py-2 text-sm font-medium"
        [class]="tab() === 'history' ? activeTabClass : inactiveTabClass"
        (click)="tab.set('history')"
      >
        Historial
      </button>
    </div>

    @if (tab() === 'board') {
      @if (boardLoading()) {
        <app-loader />
      } @else if (board().length === 0) {
        <div class="card">
          <app-empty-state
            title="Sin pedidos activos"
            message="Los pedidos en curso aparecerán aquí para su seguimiento."
            icon="receipt"
          />
        </div>
      } @else {
        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          @for (order of board(); track order.id) {
            <div class="card flex flex-col p-4">
              <div class="flex items-start justify-between gap-2">
                <div>
                  <p class="font-semibold text-slate-900">{{ order.code }}</p>
                  <p class="text-xs text-slate-500">
                    {{ typeLabels[order.type] }}
                    @if (order.tableNumber) {
                      · Mesa {{ order.tableNumber }}
                    }
                  </p>
                </div>
                <span class="badge" [class]="statusClasses[order.status]">
                  {{ statusLabels[order.status] }}
                </span>
              </div>

              <p class="mt-2 text-sm text-slate-600">
                {{ order.customer?.name || 'Cliente general' }}
              </p>
              <p class="text-xs text-slate-400">
                {{ order._count?.items ?? order.items?.length ?? 0 }} ítems ·
                {{ dateTime(order.createdAt) }}
              </p>
              <app-money
                class="mt-2 text-lg font-semibold text-slate-900"
                [amount]="order.total"
              />

              <div class="mt-3 flex flex-wrap gap-2">
                @if (nextStatus(order.status); as next) {
                  <button type="button" class="btn-success btn-sm" (click)="advance(order)">
                    {{ statusLabels[next] }}
                  </button>
                }
                <button
                  type="button"
                  class="btn-primary btn-sm"
                  [disabled]="!cashOpen() || order.paymentStatus === 'PAID'"
                  (click)="openPay(order)"
                >
                  Cobrar
                </button>
                <button type="button" class="btn-secondary btn-sm" (click)="openDetail(order)">
                  Detalle
                </button>
                @if (order.paidAmount === 0) {
                  <button type="button" class="btn-danger btn-sm" (click)="cancel(order)">
                    Cancelar
                  </button>
                }
              </div>
            </div>
          }
        </div>
      }
    }

    @if (tab() === 'history') {
      <div class="card mb-4">
        <div class="card-body grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label class="label">Estado</label>
            <select class="input" [(ngModel)]="fStatus" (ngModelChange)="applyFilters()">
              <option value="">Todos</option>
              @for (option of statusOptions; track option.value) {
                <option [value]="option.value">{{ option.label }}</option>
              }
            </select>
          </div>
          <div>
            <label class="label">Pago</label>
            <select class="input" [(ngModel)]="fPaymentStatus" (ngModelChange)="applyFilters()">
              <option value="">Todos</option>
              @for (option of paymentStatusOptions; track option.value) {
                <option [value]="option.value">{{ option.label }}</option>
              }
            </select>
          </div>
          <div>
            <label class="label">Tipo</label>
            <select class="input" [(ngModel)]="fType" (ngModelChange)="applyFilters()">
              <option value="">Todos</option>
              @for (option of typeOptions; track option.value) {
                <option [value]="option.value">{{ option.label }}</option>
              }
            </select>
          </div>
          <div>
            <label class="label">Buscar</label>
            <input
              class="input"
              placeholder="Código, mesa o cliente"
              [(ngModel)]="fSearch"
              (keyup.enter)="applyFilters()"
            />
          </div>
          <div>
            <label class="label">Desde</label>
            <input type="date" class="input" [(ngModel)]="fFrom" (ngModelChange)="applyFilters()" />
          </div>
          <div>
            <label class="label">Hasta</label>
            <input type="date" class="input" [(ngModel)]="fTo" (ngModelChange)="applyFilters()" />
          </div>
          <div class="flex items-end gap-2">
            <button type="button" class="btn-primary" (click)="applyFilters()">Filtrar</button>
            <button type="button" class="btn-secondary" (click)="clearFilters()">Limpiar</button>
          </div>
        </div>
      </div>

      <div class="card">
        @if (loading()) {
          <app-loader />
        } @else if (items().length === 0) {
          <app-empty-state
            title="Sin pedidos"
            message="Ajusta los filtros o registra un nuevo pedido."
            icon="receipt"
          />
        } @else {
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Fecha</th>
                  <th>Cliente</th>
                  <th>Tipo</th>
                  <th class="text-center">Ítems</th>
                  <th class="text-right">Total</th>
                  <th class="text-right">Pagado</th>
                  <th>Estado</th>
                  <th>Pago</th>
                  <th class="text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                @for (order of items(); track order.id) {
                  <tr>
                    <td class="font-medium text-slate-900">{{ order.code }}</td>
                    <td>{{ dateTime(order.createdAt) }}</td>
                    <td>{{ order.customer?.name || '—' }}</td>
                    <td>{{ typeLabels[order.type] }}</td>
                    <td class="text-center">{{ order._count?.items ?? order.items?.length ?? 0 }}</td>
                    <td class="text-right"><app-money [amount]="order.total" alignEnd="true" /></td>
                    <td class="text-right"><app-money [amount]="order.paidAmount" alignEnd="true" /></td>
                    <td>
                      <span class="badge" [class]="statusClasses[order.status]">
                        {{ statusLabels[order.status] }}
                      </span>
                    </td>
                    <td>
                      <span class="badge" [class]="paymentStatusClasses[order.paymentStatus]">
                        {{ paymentStatusLabels[order.paymentStatus] }}
                      </span>
                    </td>
                    <td class="text-right">
                      <div class="flex justify-end gap-1">
                        <button
                          type="button"
                          class="btn-ghost btn-sm"
                          title="Ver detalle"
                          (click)="openDetail(order)"
                        >
                          <app-icon name="search" size="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          class="btn-ghost btn-sm"
                          title="Cobrar"
                          [disabled]="!cashOpen() || order.paymentStatus === 'PAID'"
                          (click)="openPay(order)"
                        >
                          <app-icon name="money" size="h-4 w-4" />
                        </button>
                        @if (auth.canManage() && order.paidAmount === 0) {
                          <button
                            type="button"
                            class="btn-ghost btn-sm text-rose-600"
                            title="Eliminar"
                            (click)="remove(order)"
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
      </div>
    }

    <app-dialog
      [open]="createOpen()"
      [variant]="dialogView()"
      title="Nuevo pedido"
      size="xl"
      [body]="createBody"
      [footer]="createFooter"
      (closed)="closeCreate()"
    />

    <ng-template #createBody>
      <div class="grid gap-5 lg:grid-cols-3">
        <div class="space-y-4 lg:col-span-2">
          <div class="grid gap-3 sm:grid-cols-3">
            <div>
              <label class="label">Cliente</label>
              <select class="input" [(ngModel)]="form.customerId">
                <option value="">Cliente general</option>
                @for (customer of customers(); track customer.id) {
                  <option [value]="customer.id">{{ customer.name }}</option>
                }
              </select>
            </div>
            <div>
              <label class="label">Tipo</label>
              <select class="input" [(ngModel)]="form.type">
                @for (option of typeOptions; track option.value) {
                  <option [value]="option.value">{{ option.label }}</option>
                }
              </select>
            </div>
            <div>
              <label class="label">Mesa</label>
              <input class="input" [(ngModel)]="form.tableNumber" placeholder="N.º de mesa" />
            </div>
          </div>

          <div class="space-y-2">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex rounded-lg border border-slate-200 p-0.5">
                <button
                  type="button"
                  class="rounded-md px-3 py-1 text-sm font-medium transition"
                  [class]="lineKind() === 'products' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'"
                  (click)="lineKind.set('products')"
                >
                  Productos
                </button>
                <button
                  type="button"
                  class="rounded-md px-3 py-1 text-sm font-medium transition"
                  [class]="lineKind() === 'menus' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'"
                  (click)="lineKind.set('menus')"
                >
                  Menús
                  @if (menus().length > 0) {
                    <span class="badge bg-white/20 text-current">{{ menus().length }}</span>
                  }
                </button>
              </div>
              <label class="flex items-center gap-2 text-xs font-medium text-slate-500">
                <input
                  type="checkbox"
                  class="h-4 w-4 rounded border-slate-300"
                  [(ngModel)]="onlyAvailable"
                />
                Solo con stock
              </label>
            </div>

            <div class="flex gap-2">
              <div class="relative flex-1">
                <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
                  <app-icon name="search" size="h-4 w-4" />
                </span>
                <input
                  class="input pl-9"
                  placeholder="Buscar por nombre o código (SKU) y presionar Enter…"
                  [(ngModel)]="productSearch"
                  (keyup.enter)="addBySearch()"
                />
              </div>
              <button type="button" class="btn-secondary" (click)="addBySearch()">
                Agregar
              </button>
            </div>

            @if (lineKind() === 'menus') {
              @if (filteredMenus.length === 0) {
                <p class="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  No hay menús que coincidan con la búsqueda. Créalos en Catálogo → Menús.
                </p>
              } @else {
                <div class="grid max-h-56 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
                  @for (menu of filteredMenus; track menu.id) {
                    <button
                      type="button"
                      class="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-brand-300 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
                      [disabled]="!menu.available"
                      (click)="addMenu(menu)"
                    >
                      <span class="min-w-0">
                        <span class="block truncate text-sm font-medium text-slate-800">{{ menu.name }}</span>
                        <span class="block text-xs text-slate-400">
                          {{ menu.code }} · {{ menu.ingredients.length }} ingrediente(s)
                        </span>
                      </span>
                      <span class="flex shrink-0 flex-col items-end gap-1">
                        <app-money [amount]="menu.price" />
                        <span
                          class="badge"
                          [title]="menuUnavailableReason(menu) ?? ''"
                          [class]="menu.available ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'"
                        >
                          {{ menuStockLabel(menu) }}
                        </span>
                      </span>
                    </button>
                  }
                </div>
              }
            } @else {

            @if (filteredProducts.length === 0) {
              <p class="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                No hay productos que coincidan con la búsqueda.
              </p>
            } @else {
              <div class="grid max-h-56 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
                @for (product of filteredProducts; track product.id) {
                  <div
                    class="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 transition hover:border-brand-300 hover:bg-brand-50"
                  >
                    <button
                      type="button"
                      class="flex min-w-0 flex-1 items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-50"
                      [disabled]="product.stock <= 0"
                      [title]="
                        isBoxProduct(product)
                          ? 'Agregar 1 unidad suelta (' + money(unitPriceOf(product)) + ')'
                          : 'Agregar al pedido'
                      "
                      (click)="addProduct(product)"
                    >
                      <span class="min-w-0">
                        <span class="block truncate text-sm font-medium text-slate-800">
                          {{ product.name }}
                        </span>
                        <span class="block text-xs text-slate-400">
                          {{ product.sku }}
                        </span>
                        <span class="flex items-center gap-1 text-xs text-slate-500">
                          <app-money [amount]="unitPriceOf(product)" />
                          <span>/ {{ soldUnitLabel(product) }}</span>
                        </span>
                        @if (isBoxProduct(product)) {
                          <span class="block text-[11px] text-slate-400">
                            Caja de {{ boxUnitsOf(product) }} = {{ money(boxCharge(product)) }}
                          </span>
                        }
                      </span>
                      @if (product.price > 0) {
                        <span
                          class="badge shrink-0"
                          [class]="
                            product.stock <= 0
                              ? 'bg-rose-100 text-rose-700'
                              : 'bg-emerald-100 text-emerald-700'
                          "
                        >
                          {{ product.stock }} {{ soldUnitLabel(product) }}
                        </span>
                      } @else {
                        <span class="badge shrink-0 bg-amber-100 text-amber-700">Sin precio</span>
                      }
                    </button>
                    @if (isBoxProduct(product)) {
                      <button
                        type="button"
                        class="btn-secondary btn-sm shrink-0"
                        [disabled]="product.stock < boxUnitsOf(product)"
                        [title]="'Agregar una caja completa (' + boxUnitsOf(product) + ') por ' + money(boxCharge(product))"
                        (click)="addBox(product)"
                      >
                        Caja
                      </button>
                    }
                  </div>
                }
              </div>
            }
            }
          </div>

          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <label class="label mb-0">Detalle del pedido</label>
              @if (lines().length > 0) {
                <button
                  type="button"
                  class="btn-ghost btn-sm text-rose-600"
                  (click)="clearLines()"
                >
                  <app-icon name="trash" size="h-4 w-4" />
                  Vaciar
                </button>
              }
            </div>
            <div class="table-wrap rounded-lg border border-slate-200">
            <table class="table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th class="text-center">Cantidad</th>
                  <th class="text-center">Stock</th>
                  <th class="text-right">P. unit.</th>
                  <th class="text-right">Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (line of lines(); track lineKey(line)) {
                  <tr>
                    <td>
                      {{ line.name }}
                      @if (line.menuId) {
                        <span class="badge ml-1 bg-sky-100 text-sky-700">Menú</span>
                      }
                      @if (isBoxProduct(line)) {
                        <span class="block text-[11px] text-slate-400">
                          Precio por unidad (caja de {{ boxUnitsOf(line) }})
                        </span>
                      }
                    </td>
                    <td>
                      <div class="flex items-center justify-center gap-1">
                        <button type="button" class="btn-ghost btn-sm" (click)="decLine(line)">
                          −
                        </button>
                        <input
                          type="number"
                          class="input w-16 px-2 py-1 text-center"
                          min="1"
                          [(ngModel)]="line.quantity"
                          (ngModelChange)="onQuantityChange(line)"
                        />
                        <button type="button" class="btn-ghost btn-sm" (click)="incLine(line)">
                          +
                        </button>
                      </div>
                    </td>
                    <td class="text-center">
                      <span
                        class="badge"
                        [class]="
                          line.quantity > line.stock && line.stock > 0
                            ? 'bg-rose-100 text-rose-700'
                            : 'bg-slate-100 text-slate-600'
                        "
                      >
                        {{ line.stock }}
                      </span>
                    </td>
                    <td class="text-right">
                      <input
                        type="number"
                        class="input w-24 px-2 py-1 text-right"
                        min="0"
                        [(ngModel)]="line.unitPrice"
                      />
                    </td>
                    <td class="text-right"><app-money [amount]="lineTotal(line)" alignEnd="true" /></td>
                    <td class="text-right">
                      <button
                        type="button"
                        class="btn-ghost btn-sm text-rose-600"
                        (click)="removeLine(lineKey(line))"
                      >
                        <app-icon name="trash" size="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="6" class="text-center text-sm text-slate-400">
                      Sin líneas. Busca o toca un producto del inventario.
                    </td>
                  </tr>
                }
              </tbody>
            </table>
            </div>
          </div>

          @if (formError()) {
            <p class="field-error">{{ formError() }}</p>
          }

          <div>
            <label class="label">Notas</label>
            <textarea class="input" rows="2" [(ngModel)]="form.notes"></textarea>
          </div>
        </div>

        <div class="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div class="flex justify-between text-sm">
            <span class="text-slate-500">Subtotal</span>
            <app-money [amount]="subtotal" alignEnd="true" />
          </div>
          <div>
            <label class="label">Descuento</label>
            <input type="number" class="input" min="0" [(ngModel)]="form.discount" />
          </div>
          <div>
            <label class="label">IGV (%)</label>
            <div class="flex gap-2">
              <input type="number" class="input" min="0" [(ngModel)]="form.taxRate" />
              @for (preset of taxRatePresets; track preset) {
                <button type="button" class="btn-secondary btn-sm" (click)="setTaxRate(preset)">
                  {{ preset }}%
                </button>
              }
            </div>
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-slate-500">IGV</span>
            <app-money [amount]="tax" alignEnd="true" />
          </div>
          <div>
            <label class="label">Propina (%) — opcional</label>
            <div class="flex flex-wrap gap-2">
              <input
                type="number"
                class="input w-20"
                min="0"
                max="100"
                [(ngModel)]="form.tipRate"
              />
              @for (preset of tipRatePresets; track preset) {
                <button
                  type="button"
                  class="btn-secondary btn-sm"
                  (click)="setTipRate(preset)"
                >
                  {{ preset === 0 ? 'Sin propina' : preset + '%' }}
                </button>
              }
            </div>
          </div>
          @if (tipAmount > 0) {
            <div class="flex justify-between text-sm">
              <span class="text-slate-500">Propina</span>
              <app-money [amount]="tipAmount" alignEnd="true" />
            </div>
          }
          @if (isDeliveryOrder) {
            <div class="rounded-lg border border-slate-200 bg-white p-3">
              <label class="label">Costo de delivery ({{ form.deliveryFeeCurrency }}) — opcional</label>
              <input
                type="number"
                class="input"
                min="0"
                [(ngModel)]="form.deliveryFee"
                placeholder="0.00"
              />
              <app-rate-conversions
                [amount]="form.deliveryFee"
                [currency]="form.deliveryFeeCurrency"
              />
              <p class="mt-1 text-xs text-slate-400">
                El delivery no paga IGV: se suma al final del total del pedido.
              </p>
            </div>
          }
          @if (deliveryFeeAmount > 0) {
            <div class="flex justify-between text-sm">
              <span class="text-slate-500">Delivery</span>
              <app-money [amount]="deliveryFeeAmount" alignEnd="true" />
            </div>
          }
          <div class="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold">
            <span>Total</span>
            <app-money [amount]="total" alignEnd="true" strong />
          </div>
          <app-rate-conversions
            [amount]="amountInDisplay(total)"
            [currency]="moneyBaseCode()"
          />

          <div class="border-t border-slate-200 pt-3">
            <label class="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                class="h-4 w-4 rounded border-slate-300"
                [(ngModel)]="chargeNow"
                [disabled]="!cashOpen()"
              />
              Cobrar ahora (venta de mostrador)
            </label>

            @if (!cashOpen()) {
              <p class="mt-1 text-xs text-amber-700">
                Abre una caja para poder cobrar la venta.
              </p>
            } @else if (chargeNow) {
              <div class="mt-2 space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                <div class="grid grid-cols-2 gap-2">
                  <div>
                    <label class="label">Método de pago</label>
                    <select class="input" [(ngModel)]="chargeMethod">
                      @for (option of paymentMethodOptions; track option.value) {
                        <option [value]="option.value">{{ option.label }}</option>
                      }
                    </select>
                  </div>
                  <app-currency-select
                    id="charge-currency"
                    label="Moneda del pago"
                    [value]="chargeCurrency"
                    [rateKey]="chargeRateKey()"
                    (valueChange)="onChargeCurrencyChange($event)"
                  />
                </div>

                <p class="text-xs text-slate-500">
                  Se cobrará
                  <span class="font-semibold">
                    {{ amountIn(chargeTotal, chargeCurrency) }}
                  </span>
                  (total del pedido)@if (chargeRateLabel(); as label) { · tasa {{ label }} }.
                </p>
                <app-rate-conversions
                  [amount]="chargeTotal"
                  [currency]="chargeCurrency"
                  [rateKey]="chargeRateKey()"
                />

                @if (chargeMethod === 'CASH') {
                  <div class="grid grid-cols-2 gap-2">
                    <div>
                      <label class="label">Efectivo recibido</label>
                      <input
                        type="number"
                        class="input"
                        min="0"
                        [(ngModel)]="receivedAmount"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label class="label">Vuelto</label>
                      <p class="input bg-slate-50 font-semibold text-slate-700">
                        {{ amountIn(change, chargeCurrency) }}
                      </p>
                    </div>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    <button type="button" class="btn-secondary btn-sm" (click)="setReceived(0)">
                      Exacto
                    </button>
                    @for (extra of [10, 20, 50]; track extra) {
                      <button
                        type="button"
                        class="btn-secondary btn-sm"
                        (click)="setReceived(extra)"
                      >
                        +{{ extra }}
                      </button>
                    }
                  </div>
                }
              </div>
            }
          </div>
        </div>
      </div>
    </ng-template>

    <ng-template #createFooter>
      <div class="flex w-full items-center justify-between gap-2">
        <p class="text-xs text-slate-500">
          Stock y totales se validan contra el inventario antes de registrar la venta.
        </p>
        <div class="flex gap-2">
          <button type="button" class="btn-secondary" (click)="closeCreate()">Cancelar</button>
          <button
            type="button"
            class="btn-primary"
            [disabled]="saving() || lines().length === 0"
            (click)="submitCreate()"
          >
            {{ saving() ? 'Procesando…' : createButtonLabel }}
          </button>
        </div>
      </div>
    </ng-template>


    <app-dialog
      [open]="detailOpen()"
      [variant]="dialogView()"
      [title]="'Pedido ' + (detailOrder()?.code || '')"
      size="lg"
      [body]="detailBody"
      [footer]="detailFooter"
      (closed)="closeDetail()"
    />

    <ng-template #detailBody>
      @if (detailOrder(); as order) {
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="space-y-1 text-sm">
            <p><span class="text-slate-500">Cliente:</span> {{ order.customer?.name || 'Cliente general' }}</p>
            <p><span class="text-slate-500">Tipo:</span> {{ typeLabels[order.type] }}</p>
            <p><span class="text-slate-500">Mesa:</span> {{ order.tableNumber || '—' }}</p>
            <p><span class="text-slate-500">Creado:</span> {{ dateTime(order.createdAt) }}</p>
          </div>
          <div class="space-y-1 text-sm sm:text-right">
            <p>
              <span class="badge" [class]="statusClasses[order.status]">
                {{ statusLabels[order.status] }}
              </span>
            </p>
            <p>
              <span class="badge" [class]="paymentStatusClasses[order.paymentStatus]">
                {{ paymentStatusLabels[order.paymentStatus] }}
              </span>
            </p>
            @if (order.notes) {
              <p class="text-slate-500">{{ order.notes }}</p>
            }
          </div>
        </div>

        <div class="mt-4 table-wrap rounded-lg border border-slate-200">
          <table class="table">
            <thead>
              <tr>
                <th>Producto</th>
                <th class="text-center">Cant.</th>
                <th class="text-right">P. unit.</th>
                <th class="text-right">Total</th>
                @if (canAddItems(order)) {
                  <th></th>
                }
              </tr>
            </thead>
            <tbody>
              @for (item of order.items ?? []; track item.id) {
                <tr>
                  <td>{{ item.name }}</td>
                  <td class="text-center">
                    @if (canAddItems(order)) {
                      <div class="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          class="btn-ghost btn-sm"
                          title="Quitar una unidad"
                          [disabled]="itemBusyId() === item.id || item.quantity <= 1"
                          (click)="changeItemQuantity(order, item, item.quantity - 1)"
                        >
                          −
                        </button>
                        <span class="min-w-6 font-medium">{{ item.quantity }}</span>
                        <button
                          type="button"
                          class="btn-ghost btn-sm"
                          title="Agregar una unidad"
                          [disabled]="itemBusyId() === item.id"
                          (click)="changeItemQuantity(order, item, item.quantity + 1)"
                        >
                          +
                        </button>
                      </div>
                    } @else {
                      {{ item.quantity }}
                    }
                  </td>
                  <td class="text-right"><app-money [amount]="item.unitPrice" alignEnd="true" /></td>
                  <td class="text-right"><app-money [amount]="item.total" alignEnd="true" /></td>
                  @if (canAddItems(order)) {
                    <td class="text-right">
                      <button
                        type="button"
                        class="btn-ghost btn-sm text-rose-600"
                        title="Quitar del pedido"
                        [disabled]="itemBusyId() === item.id"
                        (click)="removeItem(order, item)"
                      >
                        <app-icon name="trash" size="h-4 w-4" />
                      </button>
                    </td>
                  }
                </tr>
              } @empty {
                <tr>
                  <td
                    [attr.colspan]="canAddItems(order) ? 5 : 4"
                    class="text-center text-sm text-slate-400"
                  >
                    Sin ítems.
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <div class="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p class="label">Pagos</p>
            @if ((order.payments?.length ?? 0) === 0) {
              <p class="text-sm text-slate-400">Sin pagos registrados.</p>
            } @else {
              <ul class="space-y-1 text-sm">
                @for (payment of order.payments ?? []; track payment.id) {
                  <li class="flex justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                    <span>
                      {{ methodLabels[payment.method] }} · {{ dateTime(payment.createdAt) }}
                      <span class="badge ml-1 bg-slate-200 text-slate-700">
                        {{ payment.currency || baseCurrency.code }}
                      </span>
                      @if (payment.rateKey) {
                        <span class="badge ml-1" [class]="rateMetaOf(payment.rateKey).badge">
                          {{ rateMetaOf(payment.rateKey).shortLabel }}
                        </span>
                      }
                    </span>
                    <span class="text-right">
                      <span class="block font-medium">
                        {{ amountIn(payment.amount, payment.currency) }}
                      </span>
                      @if (payment.currency && payment.currency !== baseCurrency.code) {
                        <span class="block text-[10px] text-slate-400">
                          = {{ money(payment.baseAmount) }}
                          @if (payment.exchangeRate) {
                            · × {{ payment.exchangeRate }}
                          }
                        </span>
                      }
                      @if (payment.parts?.length) {
                        <span class="mt-1 block text-[10px] text-slate-500">
                          @for (part of payment.parts; track $index) {
                            <span class="mr-2 inline-block">
                              {{ methodLabels[part.method] || part.method }}:
                              {{ amountIn(part.amount, part.currency) }}
                            </span>
                          }
                        </span>
                      }
                      @if (payment.change?.length) {
                        <span class="block text-[10px] font-medium text-rose-600">
                          Vuelto:
                          @for (line of payment.change; track $index) {
                            <span class="mr-2 inline-block">
                              {{ methodLabels[line.method] || line.method }}
                              {{ amountIn(line.amount, line.currency) }}
                            </span>
                          }
                        </span>
                      }
                      @if (ratesHistoryHint(payment); as hint) {
                        <span class="block text-[10px] text-slate-400">
                          Tasas del día: {{ hint }}
                        </span>
                      }
                    </span>
                  </li>
                }
              </ul>
            }
          </div>
          <div class="space-y-1 text-sm">
            <div class="flex justify-between"><span class="text-slate-500">Subtotal</span><app-money [amount]="order.subtotal" alignEnd="true" /></div>
            <div class="flex justify-between"><span class="text-slate-500">Descuento</span><app-money [amount]="-order.discount" alignEnd="true" /></div>
            <div class="flex justify-between"><span class="text-slate-500">IGV</span><app-money [amount]="order.tax" alignEnd="true" /></div>
            @if (order.tip > 0) {
              <div class="flex justify-between"><span class="text-slate-500">Propina</span><app-money [amount]="order.tip" alignEnd="true" /></div>
            }
            @if (order.deliveryFee > 0) {
              <div class="flex justify-between"><span class="text-slate-500">Delivery</span><app-money [amount]="order.deliveryFee" alignEnd="true" /></div>
            }
            <div class="flex justify-between border-t border-slate-200 pt-1 text-base font-semibold"><span>Total</span><app-money [amount]="order.total" alignEnd="true" strong /></div>
            <app-rate-conversions
              [amount]="amountInDisplay(order.total)"
              [currency]="moneyBaseCode()"
            />
            <div class="flex justify-between"><span class="text-slate-500">Pagado</span><app-money [amount]="order.paidAmount" alignEnd="true" /></div>
            <div class="flex justify-between font-semibold text-brand-700"><span>Saldo</span><app-money [amount]="balance(order)" alignEnd="true" strong /></div>
          </div>
        </div>
      }
    </ng-template>

    <ng-template #detailFooter>
      <div class="flex w-full justify-end gap-2">
        @if (detailOrder(); as order) {
          @if (canAddItems(order)) {
            <button type="button" class="btn-primary" (click)="openAdd(order)">
              <app-icon name="plus" size="h-4 w-4" />
              Agregar productos
            </button>
          }
        }
        <button type="button" class="btn-secondary" (click)="closeDetail()">Cerrar</button>
      </div>
    </ng-template>

    <app-dialog
      [open]="addOpen()"
      [variant]="dialogView()"
      [title]="'Agregar productos a ' + (addOrder()?.code || '')"
      size="xl"
      [body]="addBody"
      [footer]="addFooter"
      (closed)="closeAdd()"
    />

    <ng-template #addBody>
      <div class="space-y-4">
        <p class="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          Los productos que ya están en el pedido se suman en su línea. El stock se
          descuenta y los totales se recalculan al guardar.
        </p>

        <div class="space-y-2">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex rounded-lg border border-slate-200 p-0.5">
              <button
                type="button"
                class="rounded-md px-3 py-1 text-sm font-medium transition"
                [class]="lineKind() === 'products' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'"
                (click)="lineKind.set('products')"
              >
                Productos
              </button>
              <button
                type="button"
                class="rounded-md px-3 py-1 text-sm font-medium transition"
                [class]="lineKind() === 'menus' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'"
                (click)="lineKind.set('menus')"
              >
                Menús
              </button>
            </div>
            <label class="flex items-center gap-2 text-xs font-medium text-slate-500">
              <input
                type="checkbox"
                class="h-4 w-4 rounded border-slate-300"
                [(ngModel)]="onlyAvailable"
              />
              Solo con stock
            </label>
          </div>

          <div class="flex gap-2">
            <div class="relative flex-1">
              <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
                <app-icon name="search" size="h-4 w-4" />
              </span>
              <input
                class="input pl-9"
                placeholder="Buscar por nombre o código (SKU) y presionar Enter…"
                [(ngModel)]="productSearch"
                (keyup.enter)="addBySearch()"
              />
            </div>
            <button type="button" class="btn-secondary" (click)="addBySearch()">
              Agregar
            </button>
          </div>

          @if (lineKind() === 'menus') {
            @if (filteredMenus.length === 0) {
              <p class="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                No hay menús que coincidan con la búsqueda.
              </p>
            } @else {
              <div class="grid max-h-56 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
                @for (menu of filteredMenus; track menu.id) {
                  <button
                    type="button"
                    class="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-brand-300 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
                    [disabled]="!menu.available"
                    (click)="addMenu(menu)"
                  >
                    <span class="min-w-0">
                      <span class="block truncate text-sm font-medium text-slate-800">{{ menu.name }}</span>
                      <span class="block text-xs text-slate-400">{{ menu.code }}</span>
                    </span>
                    <span class="flex shrink-0 flex-col items-end gap-1">
                      <app-money [amount]="menu.price" />
                      <span
                        class="badge"
                        [title]="menuUnavailableReason(menu) ?? ''"
                        [class]="menu.available ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'"
                      >
                        {{ menuStockLabel(menu) }}
                      </span>
                    </span>
                  </button>
                }
              </div>
            }
          } @else {

          @if (filteredProducts.length === 0) {
            <p class="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
              No hay productos que coincidan con la búsqueda.
            </p>
          } @else {
            <div class="grid max-h-56 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
              @for (product of filteredProducts; track product.id) {
                <div
                  class="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 transition hover:border-brand-300 hover:bg-brand-50"
                >
                  <button
                    type="button"
                    class="flex min-w-0 flex-1 items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-50"
                    [disabled]="product.stock <= 0"
                    [title]="
                      isBoxProduct(product)
                        ? 'Agregar 1 unidad suelta (' + money(unitPriceOf(product)) + ')'
                        : 'Agregar al pedido'
                    "
                    (click)="addProduct(product)"
                  >
                    <span class="min-w-0">
                      <span class="block truncate text-sm font-medium text-slate-800">
                        {{ product.name }}
                      </span>
                      <span class="block text-xs text-slate-400">{{ product.sku }}</span>
                      <span class="flex items-center gap-1 text-xs text-slate-500">
                        <app-money [amount]="unitPriceOf(product)" />
                        <span>/ {{ soldUnitLabel(product) }}</span>
                      </span>
                      @if (isBoxProduct(product)) {
                        <span class="block text-[11px] text-slate-400">
                          Caja de {{ boxUnitsOf(product) }} = {{ money(boxCharge(product)) }}
                        </span>
                      }
                    </span>
                    @if (product.price > 0) {
                      <span
                        class="badge shrink-0"
                        [class]="
                          product.stock <= 0
                            ? 'bg-rose-100 text-rose-700'
                            : 'bg-emerald-100 text-emerald-700'
                        "
                      >
                        {{ product.stock }} {{ soldUnitLabel(product) }}
                      </span>
                    } @else {
                      <span class="badge shrink-0 bg-amber-100 text-amber-700">Sin precio</span>
                    }
                  </button>
                  @if (isBoxProduct(product)) {
                    <button
                      type="button"
                      class="btn-secondary btn-sm shrink-0"
                      [disabled]="product.stock < boxUnitsOf(product)"
                      [title]="'Agregar una caja completa (' + boxUnitsOf(product) + ') por ' + money(boxCharge(product))"
                      (click)="addBox(product)"
                    >
                      Caja
                    </button>
                  }
                </div>
              }
            </div>
          }
          }
        </div>

        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <label class="label mb-0">Productos a agregar</label>
            @if (lines().length > 0) {
              <button
                type="button"
                class="btn-ghost btn-sm text-rose-600"
                (click)="clearLines()"
              >
                <app-icon name="trash" size="h-4 w-4" />
                Vaciar
              </button>
            }
          </div>
          <div class="table-wrap rounded-lg border border-slate-200">
            <table class="table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th class="text-center">Cantidad</th>
                  <th class="text-center">Stock</th>
                  <th class="text-right">P. unit.</th>
                  <th class="text-right">Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (line of lines(); track lineKey(line)) {
                  <tr>
                    <td>
                      {{ line.name }}
                      @if (line.menuId) {
                        <span class="badge ml-1 bg-sky-100 text-sky-700">Menú</span>
                      }
                      @if (isBoxProduct(line)) {
                        <span class="block text-[11px] text-slate-400">
                          Precio por unidad (caja de {{ boxUnitsOf(line) }})
                        </span>
                      }
                    </td>
                    <td>
                      <div class="flex items-center justify-center gap-1">
                        <button type="button" class="btn-ghost btn-sm" (click)="decLine(line)">
                          −
                        </button>
                        <input
                          type="number"
                          class="input w-16 px-2 py-1 text-center"
                          min="1"
                          [(ngModel)]="line.quantity"
                          (ngModelChange)="onQuantityChange(line)"
                        />
                        <button type="button" class="btn-ghost btn-sm" (click)="incLine(line)">
                          +
                        </button>
                      </div>
                    </td>
                    <td class="text-center">
                      <span
                        class="badge"
                        [class]="
                          line.quantity > line.stock && line.stock > 0
                            ? 'bg-rose-100 text-rose-700'
                            : 'bg-slate-100 text-slate-600'
                        "
                      >
                        {{ line.stock }}
                      </span>
                    </td>
                    <td class="text-right">
                      <input
                        type="number"
                        class="input w-24 px-2 py-1 text-right"
                        min="0"
                        [(ngModel)]="line.unitPrice"
                      />
                    </td>
                    <td class="text-right"><app-money [amount]="lineTotal(line)" alignEnd="true" /></td>
                    <td class="text-right">
                      <button
                        type="button"
                        class="btn-ghost btn-sm text-rose-600"
                        (click)="removeLine(lineKey(line))"
                      >
                        <app-icon name="trash" size="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="6" class="text-center text-sm text-slate-400">
                      Sin líneas. Busca o toca un producto del inventario.
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>

        @if (formError()) {
          <p class="field-error">{{ formError() }}</p>
        }
      </div>
    </ng-template>

    <ng-template #addFooter>
      <div class="flex w-full flex-wrap items-center justify-between gap-3">
        <span class="text-sm text-slate-500">
          Subtotal: <app-money [amount]="subtotal" alignEnd="true" />
        </span>
        <span class="flex gap-2">
          <button type="button" class="btn-secondary" (click)="closeAdd()">Cancelar</button>
          <button
            type="button"
            class="btn-primary"
            [disabled]="saving() || lines().length === 0"
            (click)="submitAdd()"
          >
            <app-icon name="plus" size="h-4 w-4" />
            Agregar al pedido
          </button>
        </span>
      </div>
    </ng-template>

    <app-dialog
      [open]="payOpen()"
      [variant]="dialogView()"
      [title]="'Cobrar ' + (payOrder()?.code || '')"
      [body]="payBody"
      [footer]="payFooter"
      (closed)="closePay()"
    />

    <ng-template #payBody>
      @if (payOrder(); as order) {
        <div class="space-y-3">
          <div class="rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <div class="flex justify-between"><span class="text-slate-500">Total</span><app-money [amount]="order.total" alignEnd="true" /></div>
            @if (order.deliveryFee > 0) {
              <div class="flex justify-between">
                <span class="text-slate-500">Delivery (incluido)</span>
                <app-money [amount]="order.deliveryFee" alignEnd="true" />
              </div>
            }
            <div class="flex justify-between"><span class="text-slate-500">Pagado</span><app-money [amount]="order.paidAmount" alignEnd="true" /></div>
            <div class="flex justify-between font-semibold"><span>Saldo pendiente</span><app-money [amount]="balance(order)" alignEnd="true" strong /></div>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="label">Método de pago</label>
              <select class="input" [(ngModel)]="payForm.method">
                @for (option of paymentMethodOptions; track option.value) {
                  <option [value]="option.value">{{ option.label }}</option>
                }
              </select>
            </div>
            <app-currency-select
              id="pay-currency"
              label="Moneda del pago"
              [value]="payForm.currency"
              [rateKey]="chargeRateKey()"
              (valueChange)="onPayCurrencyChange($event)"
            />
          </div>
          <div>
            <label class="label">Monto ({{ payForm.currency }})</label>
            <input
              type="number"
              class="input"
              min="0"
              [attr.max]="balanceIn(payForm.currency)"
              [(ngModel)]="payForm.amount"
            />
            <div class="mt-2 flex flex-wrap gap-2">
              <button type="button" class="btn-secondary btn-sm" (click)="setPayAmount(balanceIn(payForm.currency))">
                Saldo completo ({{ amountIn(balanceIn(payForm.currency), payForm.currency) }})
              </button>
              <button type="button" class="btn-secondary btn-sm" (click)="setPayAmount(payForm.amount / 2)">
                Mitad
              </button>
            </div>
            <app-rate-conversions
              [amount]="payForm.amount"
              [currency]="payForm.currency"
              [rateKey]="chargeRateKey()"
            />
            <p class="mt-1 text-xs text-slate-400">
              Saldo pendiente:
              <span class="font-medium">{{ amountIn(payDisplayBalance, moneyBaseCode()) }}</span>
              @if (payForm.currency !== moneyBaseCode() && payBaseHint) {
                <span> · {{ payBaseHint }}</span>
              }
            </p>
          </div>

          @if (payForm.method === 'CASH') {
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="label">Efectivo recibido ({{ payForm.currency }})</label>
                <input
                  type="number"
                  class="input"
                  min="0"
                  [(ngModel)]="payForm.received"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label class="label">Vuelto</label>
                <p class="input bg-slate-50 font-semibold text-slate-700">
                  {{ amountIn(payChange, payForm.currency) }}
                </p>
              </div>
            </div>
            <div class="flex flex-wrap gap-2">
              <button type="button" class="btn-secondary btn-sm" (click)="setPayReceived(0)">
                Exacto
              </button>
              @for (extra of [10, 20, 50]; track extra) {
                <button type="button" class="btn-secondary btn-sm" (click)="setPayReceived(extra)">
                  +{{ extra }}
                </button>
              }
            </div>
          }

          <div>
            <label class="label">Nota</label>
            <input class="input" [(ngModel)]="payForm.note" placeholder="Opcional" />
          </div>
          <p class="flex items-center gap-2 text-xs text-slate-500">
            <app-icon name="info" size="h-4 w-4" />
            Todo cobro se registra contra la sesión de caja abierta; el efectivo incrementa el arqueo
            esperado.
          </p>
        </div>
      }
    </ng-template>

    <ng-template #payFooter>
      <div class="flex w-full justify-end gap-2">
        <button type="button" class="btn-secondary" (click)="closePay()">Cancelar</button>
        <button type="button" class="btn-primary" [disabled]="saving()" (click)="submitPay()">
          {{ saving() ? 'Procesando…' : 'Registrar pago' }}
        </button>
      </div>
    </ng-template>

    <!-- Autorización del administrador para que un cajero cancele -->
    <app-dialog
      [open]="cancelOpen()"
      [variant]="dialogView()"
      title="Autorización para cancelar"
      subtitle="El administrador recibió un código por Telegram."
      size="sm"
      [body]="cancelBody"
      [footer]="cancelFooter"
      (closed)="closeCancellation()"
    />

    <ng-template #cancelBody>
      <div class="space-y-4">
        <div class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p class="font-semibold">Pedido {{ cancelOrder()?.code }}</p>
          <p class="mt-1 text-xs">
            Pide al administrador el código de 8 letras que le llegó por Telegram.
            Vence a los 10 minutos y solo sirve una vez.
          </p>
          @if (cancelExpiresAt()) {
            <p class="mt-1 text-xs">Vence: {{ dateTime(cancelExpiresAt()) }}</p>
          }
        </div>

        <div>
          <label class="label" for="cancel-otp">Código de autorización</label>
          <input
            id="cancel-otp"
            class="input text-center font-mono text-xl font-bold uppercase tracking-[0.35em]"
            maxlength="8"
            autocomplete="one-time-code"
            placeholder="ABCDEFGH"
            [ngModel]="cancelCode()"
            (ngModelChange)="setCancelCode($event)"
          />
          <p class="mt-1 text-xs text-slate-500">
            8 letras mayúsculas. Sin el código, el pedido no se puede cancelar.
          </p>
        </div>
      </div>
    </ng-template>

    <ng-template #cancelFooter>
      <div class="flex w-full flex-wrap justify-end gap-2">
        <button type="button" class="btn-secondary" (click)="closeCancellation()">
          Volver
        </button>
        <button
          type="button"
          class="btn-secondary"
          [disabled]="cancelSending()"
          (click)="resendCancellationCode()"
        >
          Reenviar código
        </button>
        <button
          type="button"
          class="btn-danger"
          [disabled]="cancelCode().length !== 8 || cancelSending()"
          (click)="submitCancellation()"
        >
          {{ cancelSending() ? 'Cancelando…' : 'Cancelar pedido' }}
        </button>
      </div>
    </ng-template>
  `,
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
   * **Tasa de cobro** que fijó la empresa en Configuración → Cajero (`null` = la
   * tasa activa del sistema): es la que lleva el precio que se lee en pantalla a
   * la moneda con la que paga el cliente.
   */
  readonly chargeRateKey = this.preferences.chargeRateKey;
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
    return this.rates.chargeAmount(balance, currency, this.chargeRateKey());
  }

  /** Saldo pendiente tal como se lee en pantalla (la moneda de los precios). */
  get payDisplayBalance(): number {
    const order = this.payOrder();
    return order ? this.rates.displayAmount(this.balance(order)) : 0;
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

  /** Formatea un monto en la moneda indicada. */
  amountIn(value: number | null | undefined, currency?: string | null): string {
    return moneyIn(value, currency);
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
    const amount = Number(this.payForm.amount);
    if (!(amount > 0)) {
      this.toast.error('El monto debe ser mayor a 0');
      return;
    }

    const currency = this.payForm.currency || BASE_CURRENCY.code;
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
      this.chargeRateKey(),
    );
    if (amount > limit + 0.02) {
      this.toast.error('El monto excede el saldo pendiente');
      return;
    }

    this.saving.set(true);
    const rateKey = this.chargeRateKey();
    // Una sola forma de pago: se envia el efectivo RECIBIDO y el vuelto como
    // lineas separadas para que la caja muestre ambos movimientos.
    const received = Number(this.payForm.received) || 0;
    const tendered =
      this.payForm.method === 'CASH' && received > amount ? received : amount;
    const change =
      this.payForm.method === 'CASH' ? Math.max(0, sumMoney([tendered, -amount])) : 0;
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
   */
  get chargeTotal(): number {
    return this.rates.chargeAmount(
      this.total,
      this.chargeCurrency,
      this.chargeRateKey(),
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
          this.payCreatedOrder(order);
        },
        error: (error) => {
          this.saving.set(false);
          this.formError.set(apiErrorMessage(error));
        },
      });
  }

  /** Cobra de inmediato la venta recien creada (monto = total del pedido). */
  private payCreatedOrder(order: Order): void {
    const currency = this.chargeCurrency || BASE_CURRENCY.code;
    const rateKey = this.chargeRateKey();
    // El monto se envia en la moneda del cobro; el backend guarda ademas el
    // equivalente en la moneda base del sistema y compara el cobro con el saldo
    // del pedido usando esta misma tasa de cobro.
    const amount = this.rates.chargeAmount(order.total, currency, rateKey);
    // Igual que en el cobro de un pedido abierto: se envia lo recibido y el
    // vuelto para que la caja registre ambos movimientos.
    const received = Number(this.receivedAmount) || 0;
    const tendered = this.chargeMethod === 'CASH' && received > amount ? received : amount;
    const change =
      this.chargeMethod === 'CASH' ? Math.max(0, sumMoney([tendered, -amount])) : 0;

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
