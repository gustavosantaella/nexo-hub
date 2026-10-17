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
import { BASE_CURRENCY, RATE_META } from '../../core/constants/currency';
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
} from '../../core/models/operations.model';
import { CashService } from '../../core/services/cash.service';
import {
  CategoriesService,
  CustomersService,
  ProductsService,
} from '../../core/services/catalog.service';
import { LayoutService } from '../../core/services/layout.service';
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
import {
  apiErrorMessage,
  dateTime,
  displayBaseCode,
  divMoney,
  money,
  moneyIn,
  moneyLoaded,
  mulMoney,
  sumMoney,
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
  template: `
    <div class="flex flex-col gap-3 xl:h-[calc(100vh-3.5rem)] xl:overflow-hidden">
      <!-- Barra del punto de venta -->
      <div class="card shrink-0">
        <div class="card-body flex flex-wrap items-center gap-2">
          <div class="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            <button
              type="button"
              data-pos-tab-sale
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
              data-pos-tab-tables
              class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition"
              [class]="
                tab() === 'tables'
                  ? 'bg-white text-brand-700 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              "
              (click)="tab.set('tables'); cartOpen.set(false)"
            >
              <app-icon name="table" size="h-4 w-4" />
              Mesas
              @if (occupiedTables.length > 0) {
                <span class="badge bg-amber-100 text-amber-700">
                  {{ occupiedTables.length }}
                </span>
              }
            </button>
            <button
              type="button"
              data-pos-tab-saved
              class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition"
              [class]="
                tab() === 'saved'
                  ? 'bg-white text-brand-700 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              "
              (click)="tab.set('saved'); cartOpen.set(false)"
            >
              <app-icon name="clock" size="h-4 w-4" />
              Guardados
              @if (savedOrders.length > 0) {
                <span class="badge bg-sky-100 text-sky-700">
                  {{ savedOrders.length }}
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
              placeholder="Buscar por nombre, SKU, código, categoría, menú…"
              [ngModel]="search"
              (ngModelChange)="onSearchChange($event)"
              (keyup.enter)="addBySearch()"
            />
          </div>

          <select
            class="input w-44"
            aria-label="Filtrar por categoría"
            [ngModel]="categoryId"
            (ngModelChange)="setCategory($event)"
          >
            <option value="">Todas las categorías</option>
            @for (category of categories(); track category.id) {
              <option [value]="category.id">{{ categoryOptionLabel(category) }}</option>
            }
          </select>

          <label class="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              class="h-4 w-4 rounded border-slate-300"
              [ngModel]="onlyAvailable"
              (ngModelChange)="setOnlyAvailable($event)"
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
            <!-- El admin configura la propina, la moneda de los precios y las
                 conversiones de la empresa: con esto el cajero trae lo que acaba
                 de guardar sin cerrar sesión. -->
            <button
              type="button"
              class="btn-secondary btn-sm"
              title="Trae lo último que guardó el administrador en Configuración → Cajero"
              [disabled]="refreshingPreferences()"
              (click)="refreshPreferences()"
            >
              <app-icon name="settings" size="h-4 w-4" />
              Actualizar preferencias
            </button>
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
        <div class="flex min-h-0 flex-1 flex-col gap-3">
          <!-- Grilla de productos del inventario -->
          <section class="card flex min-h-0 flex-col overflow-hidden">
            <div class="card-header shrink-0 flex flex-wrap items-center justify-between gap-2">
              <div class="flex flex-wrap items-center gap-3">
                <div class="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                  <button
                    type="button"
                    class="rounded-md px-3 py-1 text-sm font-medium transition"
                    [class]="
                      gridKind() === 'products'
                        ? 'bg-white text-brand-700 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    "
                    (click)="setGridKind('products')"
                  >
                    Productos
                  </button>
                  <button
                    type="button"
                    class="flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition"
                    [class]="
                      gridKind() === 'menus'
                        ? 'bg-white text-brand-700 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    "
                    (click)="setGridKind('menus')"
                  >
                    Menús
                    @if (menus().length > 0) {
                      <span class="badge bg-slate-100 text-slate-600">{{ menus().length }}</span>
                    }
                  </button>
                </div>
                <p class="text-xs text-slate-500">
                  @if (isSearching) {
                    {{ catalogRows.length }} resultado(s) entre productos y menús
                  } @else if (gridKind() === 'products') {
                    {{ filteredProducts.length }} de {{ products().length }} productos del inventario
                  } @else {
                    {{ filteredMenus.length }} de {{ menus().length }} menús de la carta
                  }
                </p>
              </div>
              <div class="flex items-center gap-2">
                @if (gridKind() === 'menus') {
                  <select
                    class="input w-44"
                    aria-label="Filtrar menús por categoría"
                    [ngModel]="menuCategoryId"
                    (ngModelChange)="setMenuCategory($event)"
                  >
                    <option value="">Todas las categorías</option>
                    @for (category of menuCategories(); track category.id) {
                      <option [value]="category.id">{{ categoryOptionLabel(category) }}</option>
                    }
                  </select>
                }
                @if (search.trim()) {
                  <button type="button" class="btn-ghost btn-sm" (click)="clearSearch()">
                    <app-icon name="close" size="h-4 w-4" />
                    Limpiar búsqueda
                  </button>
                }
              </div>
            </div>
            @if (loading()) {
              <app-loader label="Cargando catálogo…" />
            } @else if (catalogRows.length === 0) {
              <app-empty-state
                [title]="isSearching ? 'Sin resultados' : gridKind() === 'menus' ? 'Sin menús' : 'Sin productos'"
                [message]="emptyCatalogMessage"
                [icon]="isSearching ? 'search' : gridKind() === 'menus' ? 'menu' : 'box'"
              />
            } @else {
              @switch (posView()) {
                <!-- Tabla: 20 artículos por página, con el tipo a la vista. -->
                @case ('table') {
                  <div class="min-h-0 flex-1 overflow-auto pb-20 [scrollbar-gutter:stable]">
                    <table class="min-w-full divide-y divide-slate-200 text-left text-sm">
                      <thead
                        class="sticky top-0 z-10 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500"
                      >
                        <tr>
                          <th class="px-3 py-2 font-semibold">Artículo</th>
                          <th class="px-3 py-2 font-semibold">Código / SKU</th>
                          <th class="px-3 py-2 font-semibold">Categoría</th>
                          <th class="px-3 py-2 font-semibold">Stock</th>
                          <th class="px-3 py-2 text-right font-semibold">Precio</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-slate-100 bg-white">
                        @for (row of pagedCatalogRows; track row.kind + row.id) {
                          <tr
                            class="cursor-pointer transition hover:bg-brand-50/50"
                            [title]="row.title"
                            (click)="addCatalogRow(row)"
                          >
                            <td class="px-3 py-2">
                              <span class="flex min-w-0 items-center gap-2">
                                <span
                                  class="badge flex-none"
                                  [class]="
                                    row.kind === 'menu'
                                      ? 'bg-amber-100 text-amber-700'
                                      : 'bg-slate-100 text-slate-600'
                                  "
                                >
                                  {{ row.kindLabel }}
                                </span>
                                <span class="min-w-0">
                                  <span
                                    data-pos-table-name
                                    class="block break-words font-medium text-slate-800"
                                  >
                                    {{ row.name }}
                                  </span>
                                  @if (row.orderedText) {
                                    <span class="block text-[11px] font-semibold text-amber-700">
                                      {{ row.orderedText }}
                                    </span>
                                  }
                                </span>
                              </span>
                            </td>
                            <td class="px-3 py-2 text-xs uppercase tracking-wide text-slate-500">
                              {{ row.code }}
                            </td>
                            <td class="px-3 py-2 text-slate-600">
                              {{ row.category || 'Sin categoría' }}
                            </td>
                            <td class="px-3 py-2">
                              <span class="text-xs font-medium" [class]="row.stockClass">
                                {{ row.stockText }}
                              </span>
                            </td>
                            <td class="px-3 py-2 text-right">
                              <span class="font-semibold text-slate-900">{{ row.priceText }}</span>
                              @if (row.unitLabel) {
                                <span class="block text-[11px] text-slate-400">
                                  / {{ row.unitLabel }}
                                </span>
                              }
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                  @if (catalogRows.length > tablePageSize) {
                    <div
                      class="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500"
                    >
                      <span>{{ tableRangeLabel }}</span>
                      <div class="flex items-center gap-2">
                        <button
                          type="button"
                          class="btn-secondary btn-sm"
                          [disabled]="currentTablePage === 1"
                          (click)="previousTablePage()"
                        >
                          Anterior
                        </button>
                        <span class="font-medium text-slate-600">
                          Página {{ currentTablePage }} de {{ tablePageCount }}
                        </span>
                        <button
                          type="button"
                          class="btn-secondary btn-sm"
                          [disabled]="currentTablePage === tablePageCount"
                          (click)="nextTablePage()"
                        >
                          Siguiente
                        </button>
                      </div>
                    </div>
                  }
                }

                <!-- Columnas: sin foto, 10 artículos por columna y en orden. -->
                @case ('columns') {
                  <div class="min-h-0 flex-1 overflow-auto pb-20 [scrollbar-gutter:stable]">
                    <div
                      class="grid content-start gap-2 p-2"
                      [style.grid-template-rows]="'repeat(' + columnRows + ', minmax(0, auto))'"
                      style="grid-auto-flow: column; grid-auto-columns: minmax(15rem, 1fr)"
                    >
                      @for (row of catalogRows; track row.kind + row.id) {
                        <button
                          type="button"
                          class="flex min-h-12 items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-left transition hover:border-brand-400 hover:bg-brand-50/40"
                          [title]="row.title"
                          (click)="addCatalogRow(row)"
                        >
                          <span class="min-w-0 flex-1">
                            <span class="flex min-w-0 items-start gap-1.5">
                              <span
                                class="flex-none text-[10px] font-semibold uppercase tracking-wide"
                                [class]="row.kind === 'menu' ? 'text-amber-600' : 'text-slate-400'"
                              >
                                {{ row.kindLabel }}
                              </span>
                              <span
                                data-pos-column-name
                                class="min-w-0 break-words text-sm font-medium leading-tight text-slate-800"
                              >
                                {{ row.name }}
                              </span>
                            </span>
                            <span
                              data-pos-column-code
                              class="block break-words text-[11px] leading-tight text-slate-400"
                            >
                              {{ row.code }}@if (row.category) { · {{ row.category }} }
                            </span>
                          </span>
                          <span class="min-w-0 max-w-[45%] flex-none text-right">
                            <span
                              data-pos-column-price
                              class="block break-words text-sm font-semibold leading-tight text-slate-900"
                            >
                              {{ row.priceText }}
                            </span>
                            <span class="block text-[10px] font-medium" [class]="row.stockClass">
                              {{ row.stockText }}
                            </span>
                          </span>
                        </button>
                      }
                    </div>
                  </div>
                }

                <!-- Tarjetas: la vista de siempre, ahora también para los resultados
                     de menús y productos mezclados. -->
                @default {
                  <!-- Tarjetas compactas: 6 columnas en escritorio. -->
                  <div
                    data-pos-cards
                    class="card-body grid min-h-0 flex-1 grid-cols-2 content-start gap-2 overflow-y-auto p-2 pb-20 [scrollbar-gutter:stable] min-[600px]:grid-cols-4 md:grid-cols-6"
                  >
                    @for (row of catalogRows; track row.kind + row.id) {
                      <div
                        class="group flex min-w-0 flex-col rounded-lg border border-slate-200 bg-white transition hover:border-brand-400 hover:shadow-card"
                      >
                        <button
                          type="button"
                          class="flex min-w-0 flex-1 flex-col text-left"
                          [title]="row.title"
                          (click)="addCatalogRow(row)"
                        >
                          <span
                            data-pos-card-image
                            class="relative flex h-20 w-full items-center justify-center overflow-hidden rounded-t-lg bg-slate-100"
                          >
                            @if (row.imageUrl) {
                              <img
                                class="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                                [src]="row.imageUrl"
                                [alt]="row.name"
                                loading="lazy"
                              />
                            } @else {
                              <app-icon
                                [name]="row.kind === 'menu' ? 'menu' : 'box'"
                                size="h-6 w-6"
                                class="text-slate-300"
                              />
                            }
                            <span
                              class="absolute right-1 top-1 rounded-full bg-white/90 px-1.5 text-[10px] font-semibold leading-4"
                              [class]="row.stockClass"
                              [title]="row.stockHint"
                            >
                              {{ row.stockText }}
                            </span>
                            <span
                              class="absolute left-1 top-1 rounded-full bg-white/90 px-1.5 text-[9px] font-semibold uppercase leading-4 tracking-wide text-slate-500"
                            >
                              {{ row.kindLabel }}
                            </span>
                          </span>

                          <span class="flex min-w-0 flex-1 flex-col gap-0.5 p-2">
                            <span
                              data-pos-card-name
                              class="break-words text-xs font-medium leading-tight text-slate-800"
                            >
                              {{ row.name }}
                            </span>
                            <span
                              data-pos-card-code
                              class="break-words text-[10px] uppercase leading-tight tracking-wide text-slate-400"
                            >
                              {{ row.code }}@if (row.category) { · {{ row.category }} }
                            </span>
                            <span
                              data-pos-card-price
                              class="mt-0.5 break-words text-xs font-semibold leading-tight text-slate-900"
                            >
                              {{ row.priceText }}
                              @if (row.unitLabel) {
                                <span class="text-[10px] font-normal text-slate-400">
                                  / {{ row.unitLabel }}
                                </span>
                              }
                            </span>
                            @if (row.detail) {
                              <span class="break-words text-[10px] font-medium leading-tight text-brand-700">
                                {{ row.detail }}
                              </span>
                            }
                            @if (row.orderedText) {
                              <span
                                class="mt-0.5 break-words text-[10px] font-semibold leading-tight text-amber-700"
                              >
                                {{ row.orderedText }}
                              </span>
                            }
                          </span>
                        </button>
                        @if (row.note) {
                          <p class="mx-2 mb-2 break-words text-[10px] leading-tight text-slate-400">
                            {{ row.note }}
                          </p>
                        }
                      </div>
                    }
                  </div>
                }
              }
            }
          </section>
          <!-- Botón flotante: abre la tarjeta de cobro como panel lateral. -->
          <button
            type="button"
            data-pos-cart-toggle
            class="fixed bottom-5 right-5 z-30 flex items-center gap-3 rounded-full bg-brand-600 px-4 py-3.5 text-white shadow-xl transition hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-300 focus:ring-offset-2 sm:bottom-6 sm:right-6"
            [attr.aria-expanded]="cartOpen()"
            aria-label="Abrir la tarjeta de cobro"
            title="Abrir la tarjeta de cobro"
            (click)="cartOpen.set(true)"
          >
            <span class="relative">
              <app-icon name="receipt" size="h-6 w-6" />
              @if (lines().length > 0) {
                <span
                  class="absolute -right-2.5 -top-2.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-[11px] font-bold leading-none text-brand-700"
                >
                  {{ lines().length }}
                </span>
              }
            </span>
            <span class="hidden text-left leading-tight sm:block">
              <span class="block text-[10px] font-semibold uppercase tracking-wide text-white/70">
                Cobro
              </span>
              <span class="block text-sm font-semibold">{{ money(bill.total) }}</span>
            </span>
          </button>

          <!-- Carrito y cobro de la venta en curso: panel lateral. -->
          <app-sidebar
            [open]="cartOpen()"
            [title]="targetOrder() ? 'Agregar a ' + targetOrder()!.code : 'Venta actual'"
            [subtitle]="cartSubtitle"
            size="md"
            (closed)="cartOpen.set(false)"
          >
            <div class="space-y-3" data-pos-cart-panel>
              @if (targetOrder(); as order) {
                <div class="flex flex-wrap items-center justify-between gap-1">
                  <button
                    type="button"
                    data-pos-cancel-order
                    class="btn-ghost btn-sm text-rose-600"
                    [disabled]="savedItemBusyId() !== null || saving()"
                    title="Cancelar todo el pedido y devolver el stock al inventario"
                    (click)="cancelOrder(order)"
                  >
                    <app-icon name="trash" size="h-4 w-4" />
                    {{ savedItemBusyId() === order.id ? 'Cancelando…' : 'Cancelar pedido' }}
                  </button>
                  <button
                    type="button"
                    class="btn-ghost btn-sm"
                    title="Salir del modo agregar"
                    (click)="cancelAddMode()"
                  >
                    <app-icon name="close" size="h-4 w-4" />
                    Salir del pedido
                  </button>
                </div>
              }

              @if (targetOrder(); as order) {
                <p class="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Agregando al pedido {{ order.code }}
                  @if (order.tableNumber) {
                    de la mesa {{ order.tableNumber }}
                  }
                  · {{ itemCount(order) }} productos ya cargados
                  @if (order.paidAmount > 0) {
                    · ya pagado {{ money(order.paidAmount) }}
                  }
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
                @if (targetOrder(); as order) {
                  @if (orderItems(order).length > 0) {
                    <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Ya en la mesa
                    </p>
                    @for (item of orderItems(order); track item.id) {
                      <div
                        class="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-2"
                      >
                        <span
                          class="flex h-10 w-10 flex-none items-center justify-center rounded-md bg-amber-100"
                        >
                          <app-icon name="box" size="h-4 w-4" class="text-amber-500" />
                        </span>
                        <span class="min-w-0 flex-1">
                          <span class="block truncate text-sm font-medium text-slate-800">
                            {{ item.name }}
                          </span>
                          <span class="block text-xs font-semibold text-amber-800">
                            Cantidad: <span class="text-amber-900">{{ item.quantity }}</span> ·
                            {{ money(item.unitPrice) }} c/u · ya en el pedido
                          </span>
                        </span>
                        <span class="flex flex-none flex-col items-end gap-1">
                          <span class="text-sm font-semibold text-slate-900">
                            {{ money(item.total) }}
                          </span>
                          <button
                            type="button"
                            data-pos-target-remove-item
                            class="btn-ghost btn-sm px-1 text-rose-600"
                            [disabled]="savedItemBusyId() !== null || saving()"
                            [title]="
                              orderItems(order).length <= 1
                                ? 'Quitar el último producto (cancela el pedido)'
                                : 'Quitar producto'
                            "
                            [attr.aria-label]="
                              orderItems(order).length <= 1
                                ? 'Cancelar el pedido ' + order.code + ' y quitar ' + item.name
                                : 'Quitar ' + item.name + ' del pedido ' + order.code
                            "
                            (click)="removeOrderItem(order, item)"
                          >
                            <app-icon name="trash" size="h-3.5 w-3.5" />
                            <span class="text-[11px]">
                              {{ savedItemBusyId() === item.id ? 'Quitando…' : 'Quitar' }}
                            </span>
                          </button>
                        </span>
                      </div>
                    }
                    @if (lines().length > 0) {
                      <p class="pt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Por agregar
                      </p>
                    }
                  }
                }
                @for (line of lines(); track lineKey(line)) {
                  <div class="flex items-center gap-2 rounded-lg border border-slate-200 p-2">
                    <span
                      class="flex h-10 w-10 flex-none items-center justify-center overflow-hidden rounded-md bg-slate-100"
                    >
                      @if (line.imageUrl) {
                        <img class="h-full w-full object-cover" [src]="line.imageUrl" [alt]="line.name" />
                      } @else {
                        <app-icon [name]="line.menuId ? 'menu' : 'box'" size="h-4 w-4" class="text-slate-400" />
                      }
                    </span>
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-sm font-medium text-slate-800">
                        {{ line.name }}
                      </span>
                      <span class="block text-xs text-slate-500">
                        {{ money(salePrice(line)) }} · {{ saleUnitLabel(line) }}
                        @if (line.menuId) {
                          · menú de {{ line.ingredientCount ?? 0 }} ingrediente(s)
                        }
                      </span>
                      @if (isBoxProduct(line)) {
                        <span class="mt-1 flex gap-0.5">
                          @for (option of saleUnits(line); track option.value) {
                            <button
                              type="button"
                              class="rounded px-1.5 py-0.5 text-[11px] font-medium transition"
                              [class]="
                                lineUnitOf(line) === option.value
                                  ? 'bg-brand-50 text-brand-700'
                                  : 'text-slate-400 hover:text-slate-600'
                              "
                              [title]="'Cobrar por ' + option.label"
                              (click)="setLineUnit(line, option.value)"
                            >
                              {{ option.label }}
                            </button>
                          }
                        </span>
                      }
                      @if (orderedForLine(line); as ordered) {
                        <span class="block text-xs font-semibold text-amber-700">
                          Ya en la mesa: {{ ordered }}
                        </span>
                      }
                    </span>
                    <span class="flex items-center gap-1">
                      <button
                        type="button"
                        class="btn-ghost btn-sm"
                        [disabled]="saleQuantity(line) <= 1"
                        (click)="decLine(line)"
                      >
                        −
                      </button>
                      <input
                        class="input w-14 px-1 py-1 text-center"
                        type="number"
                        min="1"
                        [title]="'Cantidad en ' + saleUnitLabel(line)"
                        [ngModel]="saleQuantity(line)"
                        (ngModelChange)="onQuantityChange(line, $event)"
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
                      (click)="removeLine(lineKey(line))"
                    >
                      <app-icon name="close" size="h-4 w-4" />
                    </button>
                  </div>
                } @empty {
                  <p
                    class="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-400"
                  >
                    @if (targetOrder()) {
                      Toca un producto de la grilla para agregarlo al pedido.
                    } @else {
                      Toca un producto de la grilla para empezar la venta.
                    }
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

              <!-- Propina opcional: Sí aplica el porcentaje de Configuración → Cajero. -->
              @if (!targetOrder()) {
                <div
                  class="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"
                  data-pos-tip
                >
                  <span class="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Propina
                  </span>
                  <div class="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                    <button
                      type="button"
                      data-pos-tip-yes
                      class="rounded-md px-3 py-1 text-sm font-medium transition"
                      [class]="
                        form.tipEnabled
                          ? 'bg-white text-brand-700 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700'
                      "
                      [attr.aria-pressed]="form.tipEnabled"
                      (click)="setTip(true)"
                    >
                      Sí
                    </button>
                    <button
                      type="button"
                      data-pos-tip-no
                      class="rounded-md px-3 py-1 text-sm font-medium transition"
                      [class]="
                        !form.tipEnabled
                          ? 'bg-white text-brand-700 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700'
                      "
                      [attr.aria-pressed]="!form.tipEnabled"
                      (click)="setTip(false)"
                    >
                      No
                    </button>
                  </div>
                  <span class="ml-auto text-sm font-semibold text-slate-800">
                    {{ money(tipAmount) }}
                  </span>
                </div>
              }

              <!-- Costo de delivery: solo pedidos a domicilio, sin IGV. -->
              @if (form.type === 'DELIVERY' && !targetOrder()) {
                <div class="rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span class="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Delivery
                    </span>
                    <input
                      class="input w-24 px-2 py-1 text-right"
                      type="number"
                      min="0"
                      placeholder="0.00"
                      aria-label="Costo de delivery"
                      [(ngModel)]="form.deliveryFee"
                    />
                    <span class="text-xs text-slate-500">{{ form.deliveryFeeCurrency }}</span>
                    <span class="ml-auto text-sm font-semibold text-slate-800">
                      {{ money(deliveryFeeAmount) }}
                    </span>
                  </div>
                  <app-rate-conversions
                    [amount]="form.deliveryFee"
                    [currency]="form.deliveryFeeCurrency"
                  />
                </div>
              }

              <div class="space-y-1 text-sm">
                <div class="flex items-center justify-between">
                  <span class="text-slate-500">Subtotal</span>
                  <app-money [amount]="bill.subtotal" alignEnd="true" />
                </div>
                @if (bill.discount > 0) {
                  <div class="flex items-center justify-between">
                    <span class="text-slate-500">Descuento</span>
                    <span class="font-medium text-rose-600">− {{ money(bill.discount) }}</span>
                  </div>
                }
                @if (bill.tax > 0) {
                  <div class="flex items-center justify-between">
                    <span class="text-slate-500">IGV</span>
                    <app-money [amount]="bill.tax" alignEnd="true" />
                  </div>
                }
                @if (bill.tip > 0) {
                  <div class="flex items-center justify-between">
                    <span class="text-slate-500">Propina</span>
                    <app-money [amount]="bill.tip" alignEnd="true" />
                  </div>
                }
                @if (bill.deliveryFee > 0) {
                  <div class="flex items-center justify-between">
                    <span class="text-slate-500">Delivery</span>
                    <app-money [amount]="bill.deliveryFee" alignEnd="true" />
                  </div>
                }
                <div
                  class="flex items-center justify-between border-t border-slate-200 pt-2 text-base font-semibold text-slate-900"
                >
                  <span>Total</span>
                  <app-money [amount]="bill.total" alignEnd="true" strong />
                </div>
                <app-rate-conversions
                  [amount]="displayTotal"
                  [currency]="moneyBaseCode()"
                />
                @if (targetOrder() && bill.paid > 0) {
                  <div class="flex items-center justify-between">
                    <span class="text-slate-500">Ya pagado</span>
                    <app-money [amount]="bill.paid" alignEnd="true" />
                  </div>
                  <div class="flex items-center justify-between font-semibold text-slate-900">
                    <span>Saldo pendiente</span>
                    <app-money [amount]="bill.balance" alignEnd="true" strong />
                  </div>
                }
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
                      [showHint]="false"
                      [rateKey]="chargeRateKey()"
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
                    en {{ charge.currency }}@if (chargeRateLabel(); as label) { · tasa {{ label }} }.
                  </p>
                 
                }
              </div>
            </div>

            <div sidebarFooter class="flex w-full gap-2">
              <button
                type="button"
                data-pos-clear
                class="btn-ghost btn-sm shrink-0 text-rose-600"
                title="Vaciar todo el contenido de la venta"
                (click)="clearSale()"
              >
                <app-icon name="trash" size="h-4 w-4" />
                Vaciar
              </button>
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
          </app-sidebar>
        </div>
      } @else if (tab() === 'tables') {
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
      } @else {
        <!-- Pedidos guardados: todos los activos, tengan mesa o no. -->
        <section class="card flex min-h-0 flex-1 flex-col overflow-hidden" data-pos-saved>
          <div class="card-header shrink-0 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 class="text-sm font-semibold text-slate-900">Pedidos guardados</h2>
              <p class="text-xs text-slate-500">
                {{ savedOrders.length }} en curso · se muestran primero los más recientes
              </p>
            </div>
            <button
              type="button"
              class="btn-secondary btn-sm"
              [disabled]="loadingTables()"
              (click)="reload()"
            >
              <app-icon name="refresh" size="h-4 w-4" />
              Actualizar
            </button>
          </div>

          @if (loadingTables()) {
            <app-loader label="Cargando pedidos guardados…" />
          } @else if (savedOrders.length === 0) {
            <app-empty-state
              icon="clock"
              title="No hay pedidos guardados"
              message="Cuando uses Guardar en la venta, el pedido aparecerá aquí para retomarlo o cobrarlo."
            />
          } @else {
            <div
              class="card-body grid min-h-0 flex-1 grid-cols-1 content-start gap-3 overflow-y-auto lg:grid-cols-2 2xl:grid-cols-3"
            >
              @for (order of savedOrders; track order.id) {
                <div
                  class="rounded-xl border border-slate-200 bg-white p-3"
                  data-pos-saved-order
                >
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <p class="truncate text-sm font-semibold text-slate-900">
                        {{ order.code }}
                      </p>
                      <p class="text-xs text-slate-500">{{ dateTime(order.createdAt) }}</p>
                    </div>
                    <span class="badge flex-none" [class]="paymentStatusClasses[order.paymentStatus]">
                      {{ statusLabel(order) }}
                    </span>
                  </div>

                  <div class="mt-2 flex flex-wrap items-center gap-1">
                    <span class="badge bg-slate-100 text-slate-600">
                      {{ typeLabels[order.type] }}
                    </span>
                    @if (order.tableNumber) {
                      <span class="badge bg-amber-100 text-amber-700">
                        Mesa {{ order.tableNumber }}
                      </span>
                    }
                    <span class="badge bg-slate-100 text-slate-600">
                      {{ orderStatusLabel(order) }}
                    </span>
                  </div>

                  <p class="mt-2 text-xs font-medium text-slate-600">
                    {{ customerLabel(order) }}
                  </p>
                  <p class="mt-1 break-words text-xs text-slate-500" data-pos-saved-items>
                    {{ savedOrderSummary(order) }}
                  </p>

                  @if (orderItems(order).length > 0) {
                    <button
                      type="button"
                      data-pos-saved-toggle-items
                      class="btn-ghost btn-sm mt-1 px-1 text-xs text-slate-500"
                      [attr.aria-expanded]="isSavedOrderExpanded(order)"
                      (click)="toggleSavedOrder(order.id)"
                    >
                      <app-icon
                        name="chevron-right"
                        size="h-3.5 w-3.5 transition-transform"
                        [class.rotate-90]="isSavedOrderExpanded(order)"
                      />
                      {{
                        isSavedOrderExpanded(order)
                          ? 'Ocultar productos'
                          : 'Editar productos (' + orderItems(order).length + ')'
                      }}
                    </button>
                  }

                  @if (isSavedOrderExpanded(order)) {
                    <div
                      class="mt-1 space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-2"
                      data-pos-saved-item-list
                    >
                      @for (item of orderItems(order); track item.id) {
                        <div class="flex items-center gap-2" data-pos-saved-item>
                          <span class="min-w-0 flex-1 break-words text-xs text-slate-700">
                            {{ item.quantity }} × {{ item.name }}
                          </span>
                          <span class="flex-none text-xs font-medium text-slate-600">
                            {{ money(item.total) }}
                          </span>
                          <button
                            type="button"
                            data-pos-saved-remove-item
                            class="btn-ghost btn-sm px-1 text-rose-600"
                            [disabled]="savedItemBusyId() !== null"
                            [title]="
                              orderItems(order).length <= 1
                                ? 'Quitar el último producto (cancela el pedido)'
                                : 'Quitar producto'
                            "
                            [attr.aria-label]="
                              orderItems(order).length <= 1
                                ? 'Cancelar el pedido ' + order.code + ' y quitar ' + item.name
                                : 'Quitar ' + item.name + ' del pedido ' + order.code
                            "
                            (click)="removeOrderItem(order, item)"
                          >
                            <app-icon name="trash" size="h-4 w-4" />
                            <span class="text-xs">
                              {{ savedItemBusyId() === item.id ? 'Quitando…' : 'Quitar' }}
                            </span>
                          </button>
                        </div>
                      }
                    </div>
                  }

                  <div class="mt-2 flex items-end justify-between gap-2">
                    <div>
                      <p class="text-[11px] uppercase tracking-wide text-slate-400">Total</p>
                      <p class="text-sm font-semibold text-slate-900">{{ money(order.total) }}</p>
                    </div>
                    <div class="text-right">
                      <p class="text-[11px] uppercase tracking-wide text-slate-400">Saldo</p>
                      <p
                        class="text-sm font-semibold"
                        [class]="isPaid(order) ? 'text-emerald-700' : 'text-amber-700'"
                      >
                        {{ money(balance(order)) }}
                      </p>
                    </div>
                  </div>

                  <div class="mt-3 flex gap-1">
                    <button
                      type="button"
                      data-pos-saved-add
                      class="btn-secondary btn-sm flex-1"
                      (click)="startAddToOrder(order)"
                    >
                      <app-icon name="plus" size="h-4 w-4" />
                      Agregar
                    </button>
                    @if (isPaid(order)) {
                      <button
                        type="button"
                        data-pos-saved-close
                        class="btn-primary btn-sm flex-1"
                        [disabled]="saving()"
                        (click)="closeTable(order)"
                      >
                        <app-icon name="check" size="h-4 w-4" />
                        {{ order.tableNumber ? 'Cerrar mesa' : 'Cerrar' }}
                      </button>
                    } @else {
                      <button
                        type="button"
                        data-pos-saved-charge
                        class="btn-primary btn-sm flex-1"
                        [disabled]="!cashOpen()"
                        (click)="startChargeOrder(order)"
                      >
                        <app-icon name="money" size="h-4 w-4" />
                        Cobrar
                      </button>
                    }
                  </div>
                </div>
              }
            </div>
          }
        </section>
      }
    </div>

    <!-- Eleccion de la unidad de venta: caja completa o unidad suelta -->
    <app-dialog
      [open]="unitPicker() !== null"
      [variant]="dialogView()"
      [title]="'¿Caja o unidad de ' + (unitPicker()?.name ?? '') + '?'"
      subtitle="El precio depende de lo que entregues: la presentacion completa o la unidad suelta."
      size="sm"
      [body]="unitBody"
      [footer]="unitFooter"
      (closed)="closeUnitPicker()"
    />

    <ng-template #unitBody>
      @if (unitPicker(); as product) {
        <div class="space-y-2">
          <button
            type="button"
            class="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-left transition hover:border-brand-400 hover:bg-brand-50/40"
            (click)="pickSaleUnit('UND')"
          >
            <span>
              <span class="block text-sm font-medium text-slate-800">Unidad suelta</span>
              <span class="block text-xs text-slate-500">
                Quedan {{ product.stock }} {{ soldUnitLabel(product) }}
              </span>
            </span>
            <span class="text-sm font-semibold text-slate-900">
              {{ looseUnitPriceText(product) }}
            </span>
          </button>
          <button
            type="button"
            class="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-left transition hover:border-brand-400 hover:bg-brand-50/40 disabled:cursor-not-allowed disabled:opacity-50"
            [disabled]="product.stock < boxUnitsOf(product)"
            (click)="pickSaleUnit(boxUnitOf(product))"
          >
            <span>
              <span class="block text-sm font-medium text-slate-800">
                {{ boxUnitOf(product) === 'PAQUETE' ? 'Paquete completo' : 'Caja completa' }}
              </span>
              <span class="block text-xs text-slate-500">
                {{ boxUnitsOf(product) }} unidades sueltas
                @if (product.stock < boxUnitsOf(product)) {
                  · no alcanza el stock
                }
              </span>
            </span>
            <span class="text-sm font-semibold text-slate-900">{{ money(product.price) }}</span>
          </button>
        </div>
      }
    </ng-template>

    <ng-template #unitFooter>
      <div class="flex w-full justify-end">
        <button type="button" class="btn-secondary" (click)="closeUnitPicker()">Cancelar</button>
      </div>
    </ng-template>

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
  private readonly menusService = inject(MenusService);
  private readonly menuCategoriesService = inject(MenuCategoriesService);
  private readonly categoriesService = inject(CategoriesService);
  private readonly customersService = inject(CustomersService);
  private readonly preferences = inject(PreferencesService);
  private readonly layout = inject(LayoutService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  /** Cierra la vista de cajero y vuelve al arqueo de Caja. */
  @Output() exit = new EventEmitter<void>();

  /** Presentación de los diálogos según la preferencia de la empresa. */
  readonly dialogView = this.preferences.dialogView;

  /** Cómo lista el catálogo el POS: tarjetas, tabla (20/página) o columnas (10). */
  readonly posView = this.preferences.posView;
  readonly tablePageSize = POS_TABLE_PAGE_SIZE;
  readonly columnRows = POS_COLUMN_ROWS;
  /** Página de la vista de tabla (se reinicia al cambiar búsqueda o filtros). */
  readonly tablePage = signal(1);

  readonly money = money;
  readonly dateTime = dateTime;
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
  readonly methodLabels = PAYMENT_METHOD_LABELS;
  readonly paymentStatusLabels = PAYMENT_STATUS_LABELS;
  readonly paymentStatusClasses = PAYMENT_STATUS_CLASSES;
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
   * **Tasa de cobro** que fijó la empresa en Configuración → Cajero (`null` = la
   * tasa activa del sistema).
   *
   * Es la que convierte el precio que el cajero lee en pantalla a la moneda del
   * cobro: con la tasa de cobro en el BCV y los precios mostrados con la
   * personalizada del local, el cobro en divisas vale más que el monto guardado en
   * dólares (es el precio en bolívares del cliente pasado a divisas).
   */
  readonly chargeRateKey = this.preferences.chargeRateKey;

  /** Etiqueta de la tasa de cobro para la línea del cobro (`null` sin tasa fija). */
  chargeRateLabel(): string | null {
    const key = this.chargeRateKey();
    return key ? (RATE_META[key]?.label ?? key) : null;
  }

  readonly loading = signal(false);
  readonly loadingTables = signal(false);
  readonly saving = signal(false);
  readonly formError = signal<string | null>(null);
  readonly tab = signal<'sale' | 'tables' | 'saved'>('sale');
  /**
   * La tarjeta de cobro vive en un panel lateral que arranca cerrado y se abre
   * con el botón flotante de factura: así el catálogo usa todo el ancho.
   */
  readonly cartOpen = signal(false);
  readonly cashOpen = signal(false);
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
    // La venta arranca limpia y con la propina configurada por el admin.
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
    const line: PosLine = {
      productId: product.id,
      menuId: null,
      name: product.name,
      unitPrice: this.unitPriceOf(product),
      boxPrice: product.price,
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
      this.cancelOrderRequest(order, item.id);
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

    this.cancelOrderRequest(order, order.id);
  }

  /** Envía la cancelación y limpia la venta en curso si era el pedido abierto. */
  private cancelOrderRequest(order: Order, busyId: string): void {
    this.savedItemBusyId.set(busyId);
    this.orders.updateStatus(order.id, 'CANCELLED').subscribe({
      next: () => {
        this.savedItemBusyId.set(null);
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
   * Monto a cobrar en la moneda elegida: la cuenta del carrito (que ya incluye
   * los productos de la mesa) menos lo que el cliente ya pagó, pasado a la moneda
   * del cobro con la **tasa de cobro** de la empresa.
   *
   * El precio que el cajero cobra es el que lee en pantalla (en su moneda de
   * precios), no los dólares guardados: por eso el cobro en divisas puede valer
   * más que el monto del pedido y el backend lo acepta con la misma tasa.
   */
  get chargeAmount(): number {
    const bill = this.bill;
    return this.rates.chargeAmount(
      sumMoney([bill.total, -bill.paid]),
      this.charge.currency,
      this.chargeRateKey(),
    );
  }

  /**
   * Total de la cuenta tal como se está mostrando (la moneda de los precios del
   * cajero): el bloque de conversiones del total tiene que hablar de la misma
   * moneda que el total que se lee arriba.
   */
  get displayTotal(): number {
    return this.rates.displayAmount(this.bill.total);
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

  private itemsPayloadOf(line: PosLine): OrderItemPayload {
    // La linea vende un producto O un menu: la referencia que no aplica no viaja.
    // `quantity`/`unitPrice` viajan en unidades de inventario —una caja de 24 va
    // como 24 unidades sueltas—, que es como el backend descuenta el stock y como
    // quedan guardadas las lineas del pedido.
    return {
      ...(line.productId ? { productId: line.productId } : {}),
      ...(line.menuId ? { menuId: line.menuId } : {}),
      quantity: line.quantity,
      unitPrice: this.chargeUnitPrice(line),
    };
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
  private payOrder(order: Order): void {
    const currency = this.charge.currency || BASE_CURRENCY.code;
    const rateKey = this.chargeRateKey();
    // El cobro es el precio que el cajero lee en pantalla pasado a la moneda del
    // cobro con la tasa de cobro: el backend hace la misma conversión con
    // `rateKey` antes de compararlo con el saldo del pedido.
    const amount = this.rates.chargeAmount(this.balance(order), currency, rateKey);

    if (!(amount > 0)) {
      this.toast.info(`El pedido ${order.code} ya está pagado en su totalidad`);
      this.backToSaleStart();
      return;
    }

    this.orders
      .pay(order.id, {
        amount,
        method: this.charge.method,
        currency,
        // La tasa de cobro solo viaja cuando la empresa tiene una fijada.
        ...(rateKey ? { rateKey } : {}),
      })
      .subscribe({
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
    this.charge = { method: 'CASH', currency: BASE_CURRENCY.code, received: 0 };
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
