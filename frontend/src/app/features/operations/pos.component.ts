import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  OnDestroy,
  OnInit,
  Output,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { BASE_CURRENCY } from '../../core/constants/currency';
import {
  ORDER_TYPE_LABELS,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHOD_OPTIONS,
  PAYMENT_STATUS_CLASSES,
  PAYMENT_STATUS_LABELS,
} from '../../core/constants/domain';
import type {
  Category,
  Customer,
  CustomerPayload,
  ProductOption,
} from '../../core/models/api.model';
import type {
  CashCurrentResponse,
  CashSession,
  Order,
  OrderStatus,
  OrderType,
  PaymentMethod,
} from '../../core/models/operations.model';
import { CashService } from '../../core/services/cash.service';
import {
  CategoriesService,
  CustomersService,
  ProductsService,
} from '../../core/services/catalog.service';
import { LayoutService } from '../../core/services/layout.service';
import { OrdersService } from '../../core/services/orders.service';
import {
  PreferencesService,
  TIP_PERCENT_PRESETS,
  normalizeTipPercent,
} from '../../core/services/preferences.service';
import { RatesService } from '../../core/services/rates.service';
import { ToastService } from '../../core/services/toast.service';
import {
  apiErrorMessage,
  money,
  moneyIn,
  mulMoney,
  sumMoney,
} from '../../core/utils/format';
import {
  boxUnitsOf,
  isBoxProduct,
  soldUnitLabel,
  unitPriceOf,
} from '../../core/utils/product-pricing';
import { CurrencySelectComponent } from '../../shared/components/currency-select.component';
import { DialogComponent } from '../../shared/components/dialog.component';
import { EmptyStateComponent, LoaderComponent } from '../../shared/components/feedback.component';
import { IconComponent } from '../../shared/components/icon.component';
import { MoneyComponent } from '../../shared/components/money.component';

/** Mesas que dibuja el mapa del salón al abrir la vista (se ajusta en pantalla). */
const DEFAULT_TABLE_COUNT = 12;
/** Tope de mesas numeradas del mapa. */
const MAX_TABLE_COUNT = 60;

/**
 * Estados por los que pasa un pedido hasta darse por terminado. El backend solo
 * admite el avance paso a paso, así que cerrar una mesa los recorre en orden.
 */
const COMPLETE_CHAIN: OrderStatus[] = ['CONFIRMED', 'PREPARING', 'READY', 'COMPLETED'];

/** Línea del carrito: lo que el cajero está vendiendo. */
interface PosLine {
  productId: string;
  name: string;
  /** Precio de UNA unidad: en los productos por caja ya viene repartido. */
  unitPrice: number;
  /** Cantidad en unidades individuales (el stock también está en unidades). */
  quantity: number;
  stock: number;
  unit: string;
  /** Unidades que trae la presentacion (1 = producto suelto). */
  unitsPerBox: number;
  imageUrl?: string | null;
}

/** Casilla del mapa de mesas: la mesa y el pedido que la ocupa (si lo hay). */
interface TableCell {
  number: string;
  order: Order | null;
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
    LoaderComponent,
    EmptyStateComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-3 xl:h-[calc(100vh-3.5rem)] xl:overflow-hidden">
      <!-- Barra del punto de venta -->
      <div class="card shrink-0">
        <div class="card-body flex flex-wrap items-center gap-2">
          <div class="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            <button
              type="button"
              class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition"
              [class]="
                tab() === 'sale'
                  ? 'bg-white text-brand-700 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              "
              (click)="tab.set('sale')"
            >
              <app-icon name="shopping-cart" size="h-4 w-4" />
              Venta
            </button>
            <button
              type="button"
              class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition"
              [class]="
                tab() === 'tables'
                  ? 'bg-white text-brand-700 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              "
              (click)="tab.set('tables')"
            >
              <app-icon name="table" size="h-4 w-4" />
              Mesas
              @if (occupiedTables.length > 0) {
                <span class="badge bg-amber-100 text-amber-700">
                  {{ occupiedTables.length }}
                </span>
              }
            </button>
          </div>
          <div class="relative min-w-56 flex-1">
            <span class="pointer-events-none absolute left-3 top-2.5 text-slate-400">
              <app-icon name="search" size="h-4 w-4" />
            </span>
            <input
              class="input pl-9"
              type="search"
              placeholder="Buscar por nombre o SKU y pulsar Enter…"
              [(ngModel)]="search"
              (keyup.enter)="addBySearch()"
            />
          </div>

          <select
            class="input w-44"
            aria-label="Filtrar por categoría"
            [ngModel]="categoryId"
            (ngModelChange)="categoryId = $event"
          >
            <option value="">Todas las categorías</option>
            @for (category of categories(); track category.id) {
              <option [value]="category.id">{{ category.name }}</option>
            }
          </select>

          <label class="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              class="h-4 w-4 rounded border-slate-300"
              [(ngModel)]="onlyAvailable"
            />
            Con stock
          </label>

          <div class="ml-auto flex items-center gap-2">
            <span
              class="badge"
              [class]="cashOpen() ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'"
            >
              <app-icon name="wallet" size="h-3.5 w-3.5" />
              {{ cashOpen() ? 'Caja abierta' : 'Caja cerrada' }}
            </span>
            <button
              type="button"
              class="btn-secondary btn-sm"
              [disabled]="loading()"
              (click)="reload()"
            >
              <app-icon name="refresh" size="h-4 w-4" />
              Actualizar
            </button>
            <button type="button" class="btn-secondary btn-sm" (click)="exit.emit()">
              <app-icon name="chevron-left" size="h-4 w-4" />
              Arqueo
            </button>
          </div>
        </div>
      </div>
      @if (tab() === 'sale') {
        <div class="grid min-h-0 flex-1 items-stretch gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
          <!-- Grilla de productos del inventario -->
          <section class="card flex min-h-0 flex-col overflow-hidden">
            <div class="card-header shrink-0 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 class="text-sm font-semibold text-slate-900">Productos</h2>
                <p class="text-xs text-slate-500">
                  {{ filteredProducts.length }} de {{ products().length }} productos del inventario
                </p>
              </div>
              @if (search.trim()) {
                <button type="button" class="btn-ghost btn-sm" (click)="search = ''">
                  <app-icon name="close" size="h-4 w-4" />
                  Limpiar búsqueda
                </button>
              }
            </div>

            @if (loading()) {
              <app-loader label="Cargando productos…" />
            } @else if (filteredProducts.length === 0) {
              <app-empty-state
                title="Sin productos"
                message="Ajusta la búsqueda, la categoría o el filtro de stock y revisa el inventario."
                icon="box"
              />
            } @else {
              <div
                class="card-body grid min-h-0 flex-1 grid-cols-2 content-start gap-3 overflow-y-auto sm:grid-cols-3 2xl:grid-cols-4"
              >
                @for (product of filteredProducts; track product.id) {
                  <div
                    class="group flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white transition hover:border-brand-400 hover:shadow-card"
                  >
                    <button
                      type="button"
                      class="flex flex-1 flex-col text-left"
                      [title]="product.stock > 0 ? product.name : product.name + ' (sin stock)'"
                      (click)="addProduct(product)"
                    >
                      <span
                        class="relative flex h-24 w-full items-center justify-center overflow-hidden bg-slate-100"
                      >
                        @if (product.imageUrl) {
                          <img
                            class="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                            [src]="product.imageUrl"
                            [alt]="product.name"
                            loading="lazy"
                          />
                        } @else {
                          <app-icon name="box" size="h-8 w-8" class="text-slate-300" />
                        }
                        <span
                          class="badge absolute right-1.5 top-1.5 bg-white/90"
                          [class]="stockClass(product)"
                          [title]="
                            isBoxProduct(product)
                              ? soldUnitLabel(product) + ' sueltas en inventario'
                              : 'Stock disponible'
                          "
                        >
                          {{ product.stock }} {{ soldUnitLabel(product) }}
                        </span>
                      </span>
                      <span class="flex flex-1 flex-col gap-0.5 p-2.5">
                        <span class="line-clamp-2 text-sm font-medium leading-tight text-slate-800">
                          {{ product.name }}
                        </span>
                        <span class="text-[11px] uppercase tracking-wide text-slate-400">
                          {{ product.sku }}
                        </span>
                        <span class="mt-1 text-sm font-semibold text-slate-900">
                          {{ money(unitPriceOf(product)) }}
                          <span class="text-xs font-normal text-slate-400">
                            / {{ soldUnitLabel(product) }}
                          </span>
                        </span>
                      </span>
                    </button>
                    @if (isBoxProduct(product)) {
                      <button
                        type="button"
                        class="btn-secondary btn-sm mx-2.5 mb-2.5"
                        [disabled]="product.stock < boxUnitsOf(product)"
                        [title]="
                          'Agregar una caja completa (' +
                          boxUnitsOf(product) +
                          ' unidades) por ' +
                          money(product.price)
                        "
                        (click)="addBox(product)"
                      >
                        <app-icon name="plus" size="h-3.5 w-3.5" />
                        Caja {{ boxUnitsOf(product) }} und
                      </button>
                    }
                  </div>
                }
              </div>
            }
          </section>
          <!-- Carrito de la venta en curso -->
          <aside class="card flex min-h-0 flex-col overflow-hidden">
            <div class="card-header shrink-0 flex items-start justify-between gap-2">
              <div>
                <h2 class="text-sm font-semibold text-slate-900">
                  {{ targetOrder() ? 'Agregar a ' + targetOrder()!.code : 'Venta actual' }}
                </h2>
                <p class="text-xs text-slate-500">
                  {{ lines().length }} ítems · {{ totalUnits }} unidades
                </p>
              </div>
              <div class="flex gap-1">
                @if (targetOrder()) {
                  <button
                    type="button"
                    class="btn-ghost btn-sm"
                    title="Salir del modo agregar"
                    (click)="cancelAddMode()"
                  >
                    <app-icon name="close" size="h-4 w-4" />
                  </button>
                }
                @if (lines().length > 0) {
                  <button
                    type="button"
                    class="btn-ghost btn-sm text-rose-600"
                    title="Vaciar el carrito"
                    (click)="clearLines()"
                  >
                    <app-icon name="trash" size="h-4 w-4" />
                  </button>
                }
              </div>
            </div>

            <div class="card-body flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
              @if (targetOrder(); as order) {
                <p class="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Los productos se agregan al pedido {{ order.code }}
                  @if (order.tableNumber) {
                    (Mesa {{ order.tableNumber }})
                  }
                  · saldo pendiente {{ money(balance(order)) }}.
                </p>
              } @else {
                <div class="grid grid-cols-2 gap-2">
                  <div>
                    <label class="label">Tipo de pedido</label>
                    <select class="input" [(ngModel)]="form.type" (ngModelChange)="onTypeChange($event)">
                      @for (type of orderTypes; track type) {
                        <option [value]="type">{{ typeLabels[type] }}</option>
                      }
                    </select>
                  </div>
                  <div>
                    <label class="label">Mesa</label>
                    @if (form.type === 'DINE_IN') {
                      <select class="input" [(ngModel)]="form.tableNumber">
                        <option value="">Sin asignar</option>
                        @for (table of tables; track table.number) {
                          <option
                            [value]="table.number"
                            [disabled]="table.order !== null && table.number !== form.tableNumber"
                          >
                            Mesa {{ table.number }}{{ table.order ? ' · ocupada' : '' }}
                          </option>
                        }
                      </select>
                    } @else {
                      <p class="input bg-slate-50 text-slate-400">No aplica</p>
                    }
                  </div>
                </div>

                <div>
                  <label class="label">Cliente</label>
                  <div class="flex gap-2">
                    <select class="input" [(ngModel)]="form.customerId">
                      <option value="">Cliente general</option>
                      @for (customer of customers(); track customer.id) {
                        <option [value]="customer.id">{{ customer.name }}</option>
                      }
                    </select>
                    <button
                      type="button"
                      class="btn-secondary btn-sm"
                      title="Registrar un cliente nuevo"
                      (click)="openCustomer()"
                    >
                      <app-icon name="plus" size="h-4 w-4" />
                    </button>
                  </div>
                </div>
              }
              <!-- Líneas del carrito: con su propio scroll para no mover el cobro -->
              <div
                class="min-h-32 max-h-72 flex-1 space-y-2 overflow-y-auto pr-0.5 xl:max-h-none"
              >
                @for (line of lines(); track line.productId) {
                  <div class="flex items-center gap-2 rounded-lg border border-slate-200 p-2">
                    <span
                      class="flex h-10 w-10 flex-none items-center justify-center overflow-hidden rounded-md bg-slate-100"
                    >
                      @if (line.imageUrl) {
                        <img class="h-full w-full object-cover" [src]="line.imageUrl" [alt]="line.name" />
                      } @else {
                        <app-icon name="box" size="h-4 w-4" class="text-slate-400" />
                      }
                    </span>
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-sm font-medium text-slate-800">
                        {{ line.name }}
                      </span>
                      <span class="block text-xs text-slate-500">
                        {{ money(line.unitPrice) }} · {{ soldUnitLabel(line) }}
                        @if (isBoxProduct(line)) {
                          · caja de {{ boxUnitsOf(line) }}
                        }
                      </span>
                    </span>
                    <span class="flex items-center gap-1">
                      <button
                        type="button"
                        class="btn-ghost btn-sm"
                        [disabled]="line.quantity <= 1"
                        (click)="decLine(line)"
                      >
                        −
                      </button>
                      <input
                        class="input w-14 px-1 py-1 text-center"
                        type="number"
                        min="1"
                        [(ngModel)]="line.quantity"
                        (ngModelChange)="onQuantityChange(line)"
                      />
                      <button type="button" class="btn-ghost btn-sm" (click)="incLine(line)">+</button>
                    </span>
                    <span class="w-16 flex-none text-right text-sm font-semibold text-slate-900">
                      {{ money(lineTotal(line)) }}
                    </span>
                    <button
                      type="button"
                      class="btn-ghost btn-sm text-rose-600"
                      title="Quitar del carrito"
                      (click)="removeLine(line.productId)"
                    >
                      <app-icon name="close" size="h-4 w-4" />
                    </button>
                  </div>
                } @empty {
                  <p
                    class="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-400"
                  >
                    Toca un producto de la grilla para empezar la venta.
                  </p>
                }
              </div>

              @if (formError()) {
                <p class="field-error">{{ formError() }}</p>
              }
              @if (!targetOrder()) {
                <details class="rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <summary class="cursor-pointer text-xs font-semibold text-slate-600">
                    Ajustes: descuento, IGV y notas
                    @if (discountAmount > 0 || tax > 0) {
                      <span class="badge ml-1 bg-slate-100 text-slate-600">
                        @if (discountAmount > 0) {
                          − {{ money(discountAmount) }}
                        }
                        @if (tax > 0) {
                          · IGV {{ money(tax) }}
                        }
                      </span>
                    }
                  </summary>
                  <div class="mt-2 grid grid-cols-2 gap-2">
                    <div>
                      <label class="label">Descuento</label>
                      <input class="input" type="number" min="0" [(ngModel)]="form.discount" />
                    </div>
                    <div>
                      <label class="label">IGV (%)</label>
                      <input class="input" type="number" min="0" [(ngModel)]="form.taxRate" />
                    </div>
                    <div class="col-span-2">
                      <label class="label">Notas</label>
                      <input
                        class="input"
                        placeholder="Sin cebolla, para llevar…"
                        [(ngModel)]="form.notes"
                      />
                    </div>
                  </div>
                </details>
              }

              <!-- Propina opcional: arranca con la sugerencia de Configuración → Cajero. -->
              @if (!targetOrder()) {
                <div
                  class="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2"
                >
                  <span class="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Propina
                  </span>
                  <input
                    class="input w-16 px-2 py-1 text-center"
                    type="number"
                    min="0"
                    max="100"
                    aria-label="Propina en porcentaje"
                    [(ngModel)]="form.tipRate"
                    (change)="applyTipRate()"
                  />
                  <span class="text-xs text-slate-500">%</span>
                  @for (preset of tipPresets; track preset) {
                    <button
                      type="button"
                      [class]="
                        form.tipRate === preset
                          ? 'btn-secondary btn-sm bg-slate-100'
                          : 'btn-ghost btn-sm'
                      "
                      [attr.aria-pressed]="form.tipRate === preset"
                      (click)="setTipRate(preset)"
                    >
                      {{ preset === 0 ? 'Sin' : preset + '%' }}
                    </button>
                  }
                  <span class="ml-auto text-sm font-semibold text-slate-800">
                    {{ money(tipAmount) }}
                  </span>
                </div>
              }

              <div class="space-y-1 text-sm">
                <div class="flex items-center justify-between">
                  <span class="text-slate-500">Subtotal</span>
                  <app-money [amount]="subtotal" alignEnd="true" />
                </div>
                @if (discountAmount > 0) {
                  <div class="flex items-center justify-between">
                    <span class="text-slate-500">Descuento</span>
                    <span class="font-medium text-rose-600">− {{ money(discountAmount) }}</span>
                  </div>
                }
                @if (tax > 0) {
                  <div class="flex items-center justify-between">
                    <span class="text-slate-500">IGV</span>
                    <app-money [amount]="tax" alignEnd="true" />
                  </div>
                }
                @if (tipAmount > 0) {
                  <div class="flex items-center justify-between">
                    <span class="text-slate-500">Propina</span>
                    <app-money [amount]="tipAmount" alignEnd="true" />
                  </div>
                }
                <div
                  class="flex items-center justify-between border-t border-slate-200 pt-2 text-base font-semibold text-slate-900"
                >
                  <span>Total</span>
                  <app-money [amount]="total" alignEnd="true" strong />
                </div>
              </div>


              <!-- Cobro de la venta en curso -->
              <div class="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p class="text-sm font-medium text-slate-700">Cobro</p>
                @if (!cashOpen()) {
                  <p class="text-xs text-amber-700">
                    La caja está cerrada: puedes guardar el pedido, pero el cobro se habilita al abrir
                    la caja.
                  </p>
                } @else {
                  <div class="grid grid-cols-2 gap-2">
                    <div>
                      <label class="label">Método</label>
                      <select class="input" [(ngModel)]="charge.method">
                        @for (option of methodOptions; track option.value) {
                          <option [value]="option.value">{{ option.label }}</option>
                        }
                      </select>
                    </div>
                    <app-currency-select
                      id="pos-currency"
                      label="Moneda"
                      [value]="charge.currency"
                      [amount]="chargeAmount"
                      (valueChange)="onChargeCurrencyChange($event)"
                    />
                  </div>

                  @if (charge.method === 'CASH') {
                    <div class="grid grid-cols-2 gap-2">
                      <div>
                        <label class="label">Efectivo recibido</label>
                        <input
                          class="input"
                          type="number"
                          min="0"
                          placeholder="0.00"
                          [(ngModel)]="charge.received"
                        />
                      </div>
                      <div>
                        <label class="label">Vuelto</label>
                        <p class="input bg-white font-semibold text-slate-700">
                          {{ amountIn(change, charge.currency) }}
                        </p>
                      </div>
                    </div>
                    <div class="flex flex-wrap gap-2">
                      <button type="button" class="btn-secondary btn-sm" (click)="setReceived(0)">
                        Exacto
                      </button>
                      @for (extra of receiptShortcuts; track extra) {
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

                  <p class="text-xs text-slate-500">
                    Se cobrará
                    <span class="font-semibold">{{ amountIn(chargeAmount, charge.currency) }}</span>
                    en {{ charge.currency }}.
                  </p>
                }
              </div>

              <div class="flex gap-2">
                @if (targetOrder() && lines().length === 0) {
                  <button
                    type="button"
                    class="btn-primary flex-1"
                    [disabled]="!canCharge"
                    (click)="submitSale(true)"
                  >
                    <app-icon name="money" size="h-4 w-4" />
                    {{ saving() ? 'Procesando…' : chargeLabel }}
                  </button>
                } @else {
                  <button
                    type="button"
                    class="btn-secondary flex-1"
                    [disabled]="!canSave"
                    (click)="submitSale(false)"
                  >
                    <app-icon name="plus" size="h-4 w-4" />
                    {{ targetOrder() ? 'Agregar' : 'Guardar' }}
                  </button>
                  <button
                    type="button"
                    class="btn-primary flex-1"
                    [disabled]="!canCharge"
                    (click)="submitSale(true)"
                  >
                    <app-icon name="money" size="h-4 w-4" />
                    {{ saving() ? 'Procesando…' : chargeLabel }}
                  </button>
                }
              </div>
            </div>
          </aside>
        </div>
      } @else {
        <!-- Mapa de mesas -->
        <section class="card flex min-h-0 flex-1 flex-col overflow-hidden">
          <div class="card-header shrink-0 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 class="text-sm font-semibold text-slate-900">Mapa de mesas</h2>
              <p class="text-xs text-slate-500">
                {{ occupiedTables.length }} ocupadas de {{ tables.length }} mesas
              </p>
            </div>
            <div class="flex gap-1">
              <button type="button" class="btn-ghost btn-sm" (click)="decTables()" [disabled]="tableCount() <= 1">
                <app-icon name="minus" size="h-4 w-4" />
              </button>
              <span class="badge bg-slate-100 text-slate-600">{{ tableCount() }} mesas</span>
              <button
                type="button"
                class="btn-ghost btn-sm"
                (click)="incTables()"
                [disabled]="tableCount() >= maxTableCount"
              >
                <app-icon name="plus" size="h-4 w-4" />
              </button>
            </div>
          </div>

          @if (loadingTables()) {
            <app-loader label="Cargando mesas…" />
          } @else {
            <div
              class="card-body grid min-h-0 flex-1 grid-cols-2 content-start gap-3 overflow-y-auto sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6"
            >
              @for (table of tables; track table.number) {
                <div
                  class="rounded-xl border p-3"
                  [class]="
                    table.order
                      ? 'border-amber-300 bg-amber-50'
                      : 'border-slate-200 bg-white'
                  "
                >
                  <div class="flex items-center justify-between">
                    <span class="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                      <app-icon name="table" size="h-4 w-4" class="text-slate-400" />
                      Mesa {{ table.number }}
                    </span>
                    <span
                      class="badge"
                      [class]="table.order ? 'bg-amber-200 text-amber-900' : 'bg-emerald-100 text-emerald-700'"
                    >
                      {{ table.order ? 'Ocupada' : 'Libre' }}
                    </span>
                  </div>

                  @if (table.order; as order) {
                    <div class="mt-2 flex items-center gap-1">
                      <span class="badge" [class]="paymentStatusClasses[order.paymentStatus]">
                        {{ statusLabel(order) }}
                      </span>
                      <span class="badge bg-slate-100 text-slate-600">
                        {{ orderStatusLabel(order) }}
                      </span>
                    </div>
                    <p class="mt-2 text-xs text-slate-600">
                      {{ order.code }} · {{ itemCount(order) }} ítems
                    </p>
                    <p class="text-xs text-slate-500">{{ customerLabel(order) }}</p>
                    <p class="mt-1 text-sm font-semibold text-slate-900">
                      {{ money(balance(order)) }}
                    </p>
                    <div class="mt-2 flex gap-1">
                      <button
                        type="button"
                        class="btn-secondary btn-sm flex-1"
                        (click)="startAddToOrder(order)"
                      >
                        <app-icon name="plus" size="h-4 w-4" />
                        Agregar
                      </button>
                      @if (isPaid(order)) {
                        <button
                          type="button"
                          class="btn-primary btn-sm flex-1"
                          [disabled]="saving()"
                          (click)="closeTable(order)"
                        >
                          <app-icon name="check" size="h-4 w-4" />
                          Cerrar mesa
                        </button>
                      } @else {
                        <button
                          type="button"
                          class="btn-primary btn-sm flex-1"
                          [disabled]="!cashOpen()"
                          (click)="startChargeOrder(order)"
                        >
                          <app-icon name="money" size="h-4 w-4" />
                          Cobrar
                        </button>
                      }
                    </div>
                  } @else {
                    <p class="mt-2 text-xs text-slate-400">Disponible para una venta nueva.</p>
                    <button
                      type="button"
                      class="btn-secondary btn-sm mt-2 w-full"
                      (click)="startTableOrder(table.number)"
                    >
                      <app-icon name="plus" size="h-4 w-4" />
                      Abrir mesa
                    </button>
                  }
                </div>
              }
            </div>
          }
        </section>
      }
    </div>

    <!-- Cliente rápido desde el mostrador -->
    <app-dialog
      [open]="customerOpen()"
      [variant]="dialogView()"
      title="Nuevo cliente"
      subtitle="Se guarda en el catálogo y queda seleccionado en la venta."
      size="sm"
      [body]="customerBody"
      [footer]="customerFooter"
      (closed)="closeCustomer()"
    />

    <ng-template #customerBody>
      <div class="space-y-4">
        <div>
          <label class="label">Nombre</label>
          <input
            class="input"
            placeholder="Nombre o razón social"
            [(ngModel)]="customerForm.name"
          />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label">Teléfono</label>
            <input class="input" placeholder="0414…" [(ngModel)]="customerForm.phone" />
          </div>
          <div>
            <label class="label">Documento</label>
            <input class="input" placeholder="V-12345678" [(ngModel)]="customerForm.docNumber" />
          </div>
        </div>
        @if (customerError()) {
          <p class="field-error">{{ customerError() }}</p>
        }
      </div>
    </ng-template>

    <ng-template #customerFooter>
      <div class="flex w-full justify-end gap-2">
        <button type="button" class="btn-secondary" (click)="closeCustomer()">Cancelar</button>
        <button
          type="button"
          class="btn-primary"
          [disabled]="customerSaving()"
          (click)="saveCustomer()"
        >
          {{ customerSaving() ? 'Guardando…' : 'Guardar cliente' }}
        </button>
      </div>
    </ng-template>
  `,
})
export class PosComponent implements OnInit, OnDestroy {
  private readonly orders = inject(OrdersService);
  private readonly cash = inject(CashService);
  private readonly rates = inject(RatesService);
  private readonly productsService = inject(ProductsService);
  private readonly categoriesService = inject(CategoriesService);
  private readonly customersService = inject(CustomersService);
  private readonly preferences = inject(PreferencesService);
  private readonly layout = inject(LayoutService);
  private readonly toast = inject(ToastService);

  /** Cierra la vista de cajero y vuelve al arqueo de Caja. */
  @Output() exit = new EventEmitter<void>();

  /** Presentación de los diálogos según la preferencia del usuario. */
  readonly dialogView = this.preferences.dialogView;

  readonly money = money;
  /** Presentacion del producto: precio por unidad y etiqueta de la unidad vendida. */
  readonly unitPriceOf = unitPriceOf;
  readonly soldUnitLabel = soldUnitLabel;
  readonly boxUnitsOf = boxUnitsOf;
  readonly isBoxProduct = isBoxProduct;
  readonly typeLabels = ORDER_TYPE_LABELS;
  readonly methodOptions = PAYMENT_METHOD_OPTIONS;
  readonly methodLabels = PAYMENT_METHOD_LABELS;
  readonly paymentStatusLabels = PAYMENT_STATUS_LABELS;
  readonly paymentStatusClasses = PAYMENT_STATUS_CLASSES;
  readonly orderTypes: OrderType[] = ['DINE_IN', 'TAKEAWAY', 'DELIVERY'];
  readonly maxTableCount = MAX_TABLE_COUNT;
  /** Billetes/monedas frecuentes para completar el efectivo recibido. */
  readonly receiptShortcuts = [5, 10, 20, 50, 100];
  /** Propinas de atajo de la venta (0 % = sin propina). */
  readonly tipPresets = TIP_PERCENT_PRESETS;

  readonly loading = signal(false);
  readonly loadingTables = signal(false);
  readonly saving = signal(false);
  readonly formError = signal<string | null>(null);
  readonly tab = signal<'sale' | 'tables'>('sale');
  readonly cashOpen = signal(false);

  readonly products = signal<ProductOption[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly customers = signal<Customer[]>([]);
  readonly activeOrders = signal<Order[]>([]);
  readonly tableCount = signal(DEFAULT_TABLE_COUNT);
  readonly targetOrder = signal<Order | null>(null);
  readonly lines = signal<PosLine[]>([]);

  /** Filtros de la grilla de productos. */
  search = '';
  categoryId = '';
  onlyAvailable = true;

  /** Cabecera de la venta nueva (no se usa al agregar a un pedido existente). */
  form: {
    customerId: string;
    type: OrderType;
    tableNumber: string;
    notes: string;
    discount: number;
    taxRate: number;
    /** Propina en porcentaje sobre el neto (opcional). */
    tipRate: number;
  } = {
    customerId: '',
    type: 'DINE_IN',
    tableNumber: '',
    notes: '',
    discount: 0,
    taxRate: 0,
    tipRate: 0,
  };

  /** Cobro de la venta en curso. */
  charge: { method: PaymentMethod; currency: string; received: number } = {
    method: 'CASH',
    currency: BASE_CURRENCY.code,
    received: 0,
  };

  /** Registro rápido de cliente desde el POS. */
  readonly customerOpen = signal(false);
  readonly customerSaving = signal(false);
  readonly customerError = signal<string | null>(null);
  customerForm: CustomerPayload = { name: '', phone: '', docNumber: '' };

  ngOnInit(): void {
    // El punto de venta ocupa toda la pantalla: oculta la barra lateral y la
    // cabecera del back-office mientras está abierto.
    this.layout.setFullscreen(true);
    // La venta arranca limpia y con la propina sugerida en Configuración.
    this.resetSale();
    this.reload();
  }

  ngOnDestroy(): void {
    // Al volver al arqueo (o salir de la ruta) se restaura el shell normal.
    this.layout.setFullscreen(false);
  }

  // ===========================================================================
  //  CARGA DE DATOS
  // ===========================================================================

  /** Recarga catálogos, caja y pedidos activos (mesas). */
  reload(): void {
    this.loadProducts();
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
        this.cashOpen.set(session?.status === 'OPEN');
      },
      error: () => this.cashOpen.set(false),
    });
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

  /** Productos que cumplen la búsqueda, la categoría y el filtro de stock. */
  get filteredProducts(): ProductOption[] {
    const term = this.search.trim().toLowerCase();
    return this.products()
      .filter((product) => (this.onlyAvailable ? product.stock > 0 : true))
      .filter((product) => !this.categoryId || product.categoryId === this.categoryId)
      .filter(
        (product) =>
          !term ||
          product.name.toLowerCase().includes(term) ||
          product.sku.toLowerCase().includes(term),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Clase del distintivo de stock: rojo cuando el producto está agotado. */
  stockClass(product: ProductOption): string {
    return product.stock > 0 ? 'text-slate-600' : 'text-rose-700';
  }

  // ===========================================================================
  //  CARRITO
  // ===========================================================================

  /**
   * Agrega una unidad suelta del inventario (o incrementa su cantidad).
   *
   * En los productos por caja la unidad que se cobra es la individual, con el
   * precio de la caja repartido entre sus unidades (`price / unitsPerBox`).
   */
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
        : `"${product.name}" no tiene precio de venta: revísalo en el inventario.`,
    );
  }

  /**
   * Agrega una caja completa: tantas unidades individuales como trae la
   * presentación (los productos sueltos caen en `addProduct`).
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

  /** Línea del carrito con el precio por unidad y el stock en unidades. */
  private newLine(product: ProductOption, quantity: number): PosLine {
    return {
      productId: product.id,
      name: product.name,
      unitPrice: this.unitPriceOf(product),
      quantity,
      stock: product.stock,
      unit: product.unit,
      unitsPerBox: this.boxUnitsOf(product),
      imageUrl: product.imageUrl ?? null,
    };
  }

  /** Agrega por SKU exacto (lector de códigos) o por la primera coincidencia. */
  addBySearch(): void {
    const term = this.search.trim().toLowerCase();
    if (!term) return;
    const match =
      this.products().find((product) => product.sku.toLowerCase() === term) ??
      this.filteredProducts[0];
    if (!match) {
      this.formError.set(`No se encontró ningún producto para "${this.search}".`);
      return;
    }
    this.addProduct(match);
    this.search = '';
  }

  /** Normaliza la cantidad escrita a mano: entero >= 1 y <= stock disponible. */
  onQuantityChange(line: PosLine): void {
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

  incLine(line: PosLine): void {
    if (line.stock > 0 && line.quantity + 1 > line.stock) {
      this.formError.set(`Stock insuficiente para "${line.name}" (disponible ${line.stock}).`);
      return;
    }
    line.quantity += 1;
    this.lines.set([...this.lines()]);
    this.formError.set(null);
  }

  decLine(line: PosLine): void {
    if (line.quantity <= 1) return;
    line.quantity -= 1;
    this.lines.set([...this.lines()]);
  }

  removeLine(productId: string): void {
    this.lines.set(this.lines().filter((line) => line.productId !== productId));
  }

  clearLines(): void {
    this.lines.set([]);
    this.formError.set(null);
  }

  lineTotal(line: PosLine): number {
    return mulMoney(line.unitPrice, line.quantity);
  }

  /** Unidades totales del carrito (se muestra en la cabecera). */
  get totalUnits(): number {
    return this.lines().reduce((acc, line) => acc + line.quantity, 0);
  }

  /** Líneas cuya cantidad supera el stock disponible en inventario. */
  get stockIssues(): PosLine[] {
    return this.lines().filter((line) => line.stock > 0 && line.quantity > line.stock);
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
    if (this.targetOrder()) return 0;
    return mulMoney(
      this.subtotal - this.discountAmount,
      (Number(this.form.tipRate) || 0) / 100,
    );
  }

  get total(): number {
    return sumMoney([this.subtotal, -this.discountAmount, this.tax, this.tipAmount]);
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
    this.toast.info(`Mesa ${number} lista para tomar el pedido`);
  }

  /** Pasa al modo «agregar productos» de un pedido ya abierto. */
  startAddToOrder(order: Order): void {
    this.resetSale();
    this.tab.set('sale');
    this.targetOrder.set(order);
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

  /** Monto a cobrar en la moneda elegida (saldo del pedido o total del carrito). */
  get chargeAmount(): number {
    const order = this.targetOrder();
    const base = order ? this.balance(order) : this.total;
    const currency = this.charge.currency || BASE_CURRENCY.code;
    if (currency === BASE_CURRENCY.code) return base;
    return this.rates.fromBase(base, currency) ?? base;
  }

  /** Vuelto a entregar en efectivo (en la moneda del cobro). */
  get change(): number {
    if (this.charge.method !== 'CASH') return 0;
    const received = Number(this.charge.received) || 0;
    return Math.max(0, sumMoney([received, -this.chargeAmount]));
  }

  /** Atajo de mostrador: efectivo recibido = monto a cobrar + incremento. */
  setReceived(extra: number): void {
    this.charge.received = sumMoney([this.chargeAmount, extra]);
  }

  /** Atajo de propina (0 % = venta sin propina). */
  setTipRate(rate: number): void {
    this.form.tipRate = rate;
  }

  /** Normaliza el porcentaje de propina escrito a mano (0-100). */
  applyTipRate(): void {
    this.form.tipRate = normalizeTipPercent(this.form.tipRate);
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

    this.orders
      .create({
        customerId: this.form.customerId || null,
        type: this.form.type,
        tableNumber: this.form.tableNumber || undefined,
        notes: this.form.notes || undefined,
        discount: Number(this.form.discount) || undefined,
        taxRate: Number(this.form.taxRate) || 0,
        tip: this.tipAmount || undefined,
        items: this.lines().map((line) => this.itemsPayloadOf(line)),
      })
      .subscribe({
        next: (created) => (willCharge ? this.payOrder(created) : this.finishSale(created)),
        error: (error) => this.failSale(error),
      });
  }

  /** Valida el cobro antes de tocar el backend (falta de tasa de la moneda). */
  private validateCharge(): boolean {
    const currency = this.charge.currency || BASE_CURRENCY.code;
    if (currency !== BASE_CURRENCY.code && this.rates.bsPerUnit(currency) === null) {
      this.formError.set(`Falta la tasa de ${currency}. Configúrala en Configuración → Monedas.`);
      return false;
    }
    return true;
  }

  private itemsPayloadOf(line: PosLine) {
    return {
      productId: line.productId,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
    };
  }

  /** Cobra el saldo pendiente del pedido en la moneda elegida. */
  private payOrder(order: Order): void {
    const currency = this.charge.currency || BASE_CURRENCY.code;
    const balance = this.balance(order);
    const amount =
      currency === BASE_CURRENCY.code
        ? balance
        : (this.rates.fromBase(balance, currency) ?? balance);

    if (!(amount > 0)) {
      this.toast.info(`El pedido ${order.code} ya está pagado en su totalidad`);
      this.backToSaleStart();
      return;
    }

    this.orders.pay(order.id, { amount, method: this.charge.method, currency }).subscribe({
      next: () => {
        this.toast.success(
          `Pedido ${order.code} cobrado con ${this.methodLabels[this.charge.method]}`,
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
    this.targetOrder.set(null);
    this.lines.set([]);
    this.form = {
      customerId: '',
      type: 'DINE_IN',
      tableNumber: '',
      notes: '',
      discount: 0,
      taxRate: 0,
      // Cada venta nueva propone la propina configurada (opcional).
      tipRate: this.preferences.tipPercent(),
    };
    this.charge = { method: 'CASH', currency: BASE_CURRENCY.code, received: 0 };
    this.search = '';
    this.formError.set(null);
  }

  /** Sale del modo «agregar a un pedido» sin guardar nada. */
  cancelAddMode(): void {
    this.targetOrder.set(null);
    this.lines.set([]);
    this.formError.set(null);
    this.reload();
  }

  // ===========================================================================
  //  AYUDAS DE PRESENTACIÓN
  // ===========================================================================

  /** Cantidad de líneas de un pedido (el listado solo trae `_count`). */
  itemCount(order: Order): number {
    return order._count?.items ?? order.items?.length ?? 0;
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
