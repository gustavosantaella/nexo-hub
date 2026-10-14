import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type {
  Menu,
  MenuAvailability,
  MenuCategory,
  MenuSection,
  PaginationMeta,
  ProductOption,
} from '../../core/models/api.model';
import {
  MENU_AVAILABILITY_OPTIONS,
  MENU_SECTION_OPTIONS,
} from '../../core/constants/domain';
import { AuthService } from '../../core/services/auth.service';
import {
  MenuCategoriesService,
  MenusService,
} from '../../core/services/menu.service';
import { ProductsService } from '../../core/services/catalog.service';
import { RatesService } from '../../core/services/rates.service';
import { ToastService } from '../../core/services/toast.service';
import { categoryOptionLabel } from '../../core/utils/category-tree';
import {
  PRODUCT_IMAGE_MAX_SIZE,
  toProductImageDataUrl,
} from '../../core/utils/image';
import {
  apiErrorMessage,
  money,
  moneyIn,
  mulMoney,
  quantity,
  sumMoney,
} from '../../core/utils/format';
import {
  menuStockLabel,
  menuTitle,
  menuUnavailableReason,
} from '../../core/utils/menu-availability';
import { BASE_CURRENCY_CODE } from '../../core/constants/currency';
import { EmptyStateComponent, LoaderComponent } from '../../shared/components/feedback.component';
import { CurrencyAmountInputComponent } from '../../shared/components/currency-amount-input.component';
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

/** Linea de la receta que se esta editando en el formulario. */
interface RecipeLine {
  productId: string;
  /** En la unidad del stock del producto (0.1 = 100 g si se mide en kilos). */
  quantity: number;
  section: string;
  note: string;
}

interface MenuForm {
  code: string;
  name: string;
  description: string;
  imageUrl: string;
  /** Precio de la carta tal como se escribe, en `priceCurrency`. */
  price: number;
  priceCurrency: string;
  availability: string;
  preparationMinutes: number | null;
  categoryId: string;
  active: boolean;
  ingredients: RecipeLine[];
}

interface CategoryForm {
  name: string;
  description: string;
  color: string;
  sortOrder: number;
  /** Categoria de menu principal (`''` = es una categoria principal). */
  parentId: string;
  active: boolean;
}

/**
 * Menus (platos y combos) con su RECETA de ingredientes y sus categorias.
 *
 * Un menu es lo que se vende; los ingredientes son productos del inventario que
 * se descuentan al venderlo (100 g de carne de un producto medido en kilos = 0.1).
 * La pagina muestra el costo de la receta, el margen y las porciones que alcanzan
 * con el stock actual.
 */
@Component({
  selector: 'app-menus',
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
  template: `    <app-page-header
      title="Menús"
      subtitle="Platos y combos con su receta: al venderlos se descuentan los ingredientes del inventario"
      icon="menu"
    >
      @if (auth.canManage()) {
        <button type="button" class="btn-primary" (click)="openCreate()">
          <app-icon name="plus" size="h-4 w-4" />
          Nuevo menú
        </button>
      }
    </app-page-header>

    <section class="card">
      <div class="card-header flex flex-wrap items-center gap-2">
        <div class="flex rounded-lg border border-slate-200 p-0.5">
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-sm font-medium transition"
            [class]="tab() === 'menus' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'"
            (click)="tab.set('menus')"
          >
            Menús
          </button>
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-sm font-medium transition"
            [class]="tab() === 'categories' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'"
            (click)="tab.set('categories')"
          >
            Categorías
          </button>
        </div>

        @if (tab() === 'menus') {
          <div class="relative w-56">
            <span class="pointer-events-none absolute left-3 top-2.5 text-slate-400">
              <app-icon name="search" size="h-4 w-4" />
            </span>
            <input
              class="input pl-9"
              placeholder="Buscar por nombre o código…"
              [(ngModel)]="search"
              (keyup.enter)="applyFilters()"
            />
          </div>
          <select class="input w-48" [(ngModel)]="categoryId" (ngModelChange)="applyFilters()">
            <option value="">Todas las categorías</option>
            @for (category of categories(); track category.id) {
              <option [value]="category.id">{{ categoryOptionLabel(category) }}</option>
            }
          </select>
          <label class="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" class="h-4 w-4" [(ngModel)]="onlyAvailable" (ngModelChange)="applyFilters()" />
            Solo con stock
          </label>
          <button type="button" class="btn-secondary" (click)="applyFilters()">Buscar</button>
          <button type="button" class="btn-ghost btn-sm" (click)="resetFilters()">Limpiar</button>
        } @else {
          @if (categoryParentFilter(); as parent) {
            <span class="badge bg-slate-100 text-slate-600">
              Subcategorías de {{ parent.name }}
            </span>
            <button type="button" class="btn-ghost btn-sm" (click)="clearCategoryParentFilter()">
              Ver todas
            </button>
          }
          @if (auth.canManage()) {
            <button type="button" class="btn-secondary ml-auto" (click)="openCategoryCreate()">
              <app-icon name="plus" size="h-4 w-4" />
              Nueva categoría
            </button>
          }
        }
      </div>

      @if (tab() === 'menus') {
        @if (loading()) {
          <app-loader />
        } @else if (items().length === 0) {
          <app-empty-state
            title="Sin menús"
            message="Crea un menú y arma su receta con productos del inventario: al venderlo se descuentan solos."
            icon="menu"
          />
        } @else {
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Menú</th>
                  <th>Categoría</th>
                  <th>Receta</th>
                  <th class="text-right">Precio</th>
                  <th class="text-right">Costo</th>
                  <th class="text-right">Margen</th>
                  <th class="text-center">Alcanza para</th>
                  <th class="text-center">Estado</th>
                  <th class="text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                @for (item of items(); track item.id) {
                  <tr>
                    <td>
                      <div class="flex items-center gap-3">
                        <span class="flex h-10 w-10 flex-none items-center justify-center overflow-hidden rounded-lg bg-slate-100">
                          @if (item.imageUrl) {
                            <img [src]="item.imageUrl" alt="" class="h-full w-full object-cover" />
                          } @else {
                            <app-icon name="menu" size="h-5 w-5" class="text-slate-300" />
                          }
                        </span>
                        <span class="min-w-0">
                          <span class="block truncate font-medium text-slate-900" [title]="menuTitle(item)">{{ item.name }}</span>
                          <span class="block text-xs text-slate-400">{{ item.code }}</span>
                        </span>
                      </div>
                    </td>
                    <td>
                      @if (item.category; as category) {
                        <span class="badge bg-slate-100 text-slate-600">{{ category.name }}</span>
                      } @else {
                        <span class="text-xs text-slate-400">Sin categoría</span>
                      }
                    </td>
                    <td class="text-xs text-slate-500">
                      {{ item.ingredients.length }} ingrediente(s)
                      @if (item.inactiveIngredients.length > 0) {
                        <span
                          class="badge bg-rose-100 text-rose-700"
                          [title]="menuUnavailableReason(item) ?? ''"
                        >
                          Ingrediente inactivo
                        </span>
                      }
                    </td>
                    <td class="text-right font-medium text-slate-900">
                      {{ money(item.price) }}
                      @if (priceHint(item); as hint) {
                        <span class="block text-[11px] font-normal text-slate-400">{{ hint }}</span>
                      }
                    </td>
                    <td class="text-right text-slate-600">{{ money(item.cost) }}</td>
                    <td class="text-right">
                      <span class="font-medium" [class]="item.margin >= 0 ? 'text-emerald-600' : 'text-rose-600'">
                        {{ money(item.margin) }}
                      </span>
                    </td>
                    <td class="text-center">
                      @if (item.inactiveIngredients.length > 0) {
                        <span
                          class="badge bg-rose-100 text-rose-700"
                          [title]="menuUnavailableReason(item) ?? ''"
                        >
                          {{ menuStockLabel(item) }}
                        </span>
                      } @else if (item.maxServings === null) {
                        <span class="badge bg-slate-100 text-slate-500" title="Ningún ingrediente lleva control de inventario">
                          Ilimitado
                        </span>
                      } @else if (item.maxServings > 0) {
                        <span class="badge bg-emerald-100 text-emerald-700">{{ item.maxServings }}</span>
                      } @else {
                        <span class="badge bg-rose-100 text-rose-700">Agotado</span>
                      }
                    </td>
                    <td class="text-center">
                      <span class="badge" [class]="item.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'">
                        {{ item.active ? 'Activo' : 'Inactivo' }}
                      </span>
                    </td>
                    <td class="text-right">
                      <div class="flex justify-end gap-1">
                        @if (auth.canManage()) {
                          <button type="button" class="btn-ghost btn-sm" title="Editar" (click)="openEdit(item)">
                            <app-icon name="edit" size="h-4 w-4" />
                          </button>
                          <button type="button" class="btn-ghost btn-sm text-rose-600" title="Desactivar" (click)="remove(item)">
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
      } @else {
        @if (categoriesLoading()) {
          <app-loader />
        } @else if (categories().length === 0) {
          <app-empty-state
            title="Sin categorías de menú"
            message="Agrupa tus menús (Desayunos, Almuerzos, Combos, Postres…) para ordenar la carta."
            icon="folder"
          />
        } @else {
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Principal</th>
                  <th>Descripción</th>
                  <th class="text-center">Menús</th>
                  <th class="text-center">Subcategorías</th>
                  <th class="text-center">Orden</th>
                  <th class="text-center">Estado</th>
                  <th class="text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                @for (category of categories(); track category.id) {
                  <tr>
                    <td class="font-medium text-slate-900">
                      <span class="flex items-center gap-2">
                        @if (category.color) {
                          <span class="h-3 w-3 rounded-full" [style.background]="category.color"></span>
                        }
                        @if (category.parentId) {
                          <span class="text-slate-300">↳</span>
                        }
                        {{ category.name }}
                      </span>
                    </td>
                    <td class="text-slate-500">{{ category.parent?.name || 'Principal' }}</td>
                    <td class="text-slate-600">{{ category.description || '—' }}</td>
                    <td class="text-center text-slate-600">{{ category._count?.menus ?? 0 }}</td>
                    <td class="text-center">
                      @if (category._count?.subcategories) {
                        <button
                          type="button"
                          class="btn-ghost btn-sm"
                          title="Ver subcategorías"
                          (click)="filterCategoriesByParent(category)"
                        >
                          {{ category._count?.subcategories }}
                        </button>
                      } @else {
                        <span class="text-slate-400">—</span>
                      }
                    </td>
                    <td class="text-center text-slate-500">{{ category.sortOrder }}</td>
                    <td class="text-center">
                      <span class="badge" [class]="category.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'">
                        {{ category.active ? 'Activo' : 'Inactivo' }}
                      </span>
                    </td>
                    <td class="text-right">
                      <div class="flex justify-end gap-1">
                        @if (auth.canManage()) {
                          @if (!category.parentId) {
                            <button type="button" class="btn-ghost btn-sm" title="Nueva subcategoría" (click)="openCategoryCreateSub(category)">
                              <app-icon name="plus" size="h-4 w-4" />
                            </button>
                          }
                          <button type="button" class="btn-ghost btn-sm" title="Editar" (click)="openCategoryEdit(category)">
                            <app-icon name="edit" size="h-4 w-4" />
                          </button>
                          <button type="button" class="btn-ghost btn-sm text-rose-600" title="Eliminar" (click)="removeCategory(category)">
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
        }
      }
    </section>
    <!-- Formulario del menu: ficha + receta -->
    <app-modal
      [open]="modalOpen()"
      [title]="editing() ? 'Editar menú' : 'Nuevo menú'"
      subtitle="Los ingredientes se descuentan del inventario al vender el menú"
      size="xl"
      (closed)="closeModal()"
    >
      <form class="space-y-4" (ngSubmit)="save()" #menuForm="ngForm">
        <div class="grid gap-3 sm:grid-cols-2">
          <div class="sm:col-span-2">
            <label class="label">Nombre</label>
            <input class="input" name="name" required minlength="2" [(ngModel)]="form.name" placeholder="Parrilla mixta" />
          </div>
          <div>
            <label class="label">Código <span class="text-slate-400">(opcional)</span></label>
            <input class="input" name="code" [(ngModel)]="form.code" placeholder="Se genera solo" />
          </div>
          <div>
            <label class="label">Categoría</label>
            <select class="input" name="categoryId" [(ngModel)]="form.categoryId">
              <option value="">Sin categoría</option>
              @for (category of categories(); track category.id) {
                <option [value]="category.id">{{ categoryOptionLabel(category) }}</option>
              }
            </select>
          </div>
          <div>
            <app-currency-amount-input
              id="menu-price"
              label="Precio de venta"
              [required]="true"
              [amount]="form.price"
              [currency]="form.priceCurrency"
              (amountChange)="form.price = $event"
              (currencyChange)="form.priceCurrency = $event"
            />
          </div>
          <div>
            <label class="label">Disponible en</label>
            <select class="input" name="availability" [(ngModel)]="form.availability">
              @for (option of availabilityOptions; track option.value) {
                <option [value]="option.value">{{ option.label }}</option>
              }
            </select>
          </div>
          <div>
            <label class="label">Preparación (minutos)</label>
            <input class="input" type="number" min="1" max="600" name="preparationMinutes" [(ngModel)]="form.preparationMinutes" />
          </div>
          <div>
            <label class="label">Foto</label>
            <div class="flex items-center gap-2">
              <label class="btn-secondary btn-sm cursor-pointer" for="menu-image">
                <app-icon name="image" size="h-4 w-4" />
                {{ imageReading() ? 'Leyendo…' : 'Subir foto' }}
              </label>
              @if (form.imageUrl) {
                <button type="button" class="btn-ghost btn-sm text-rose-600" (click)="clearImage()">Quitar</button>
              }
            </div>
            <input
              id="menu-image"
              type="file"
              class="hidden"
              accept="image/png,image/jpeg,image/webp"
              (change)="onImageSelected($event)"
            />
            @if (imageError(); as error) {
              <p class="field-error">{{ error }}</p>
            }
          </div>
          <div class="sm:col-span-2">
            <label class="label">Descripción</label>
            <textarea class="input" rows="2" name="description" [(ngModel)]="form.description" placeholder="Qué incluye, para quién, etc."></textarea>
          </div>
        </div>
        <!-- Receta: ingredientes del inventario que consume el menu -->
        <section class="rounded-xl border border-slate-200 p-3">
          <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 class="text-sm font-semibold text-slate-800">Receta</h3>
              <p class="text-xs text-slate-500">
                Cuánto consume UNA unidad del menú, en la unidad del producto
                (0.1 = 100 g si el producto se mide en kilos).
              </p>
            </div>
            <button type="button" class="btn-secondary btn-sm" (click)="addIngredient()">
              <app-icon name="plus" size="h-4 w-4" />
              Agregar ingrediente
            </button>
          </div>

          @if (form.ingredients.length === 0) {
            <p class="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-400">
              Sin ingredientes. Agrega al menos uno para que el menú descuente inventario.
            </p>
          } @else {
            <div class="space-y-2">
              @for (line of form.ingredients; track $index) {
                <div class="grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_9rem_2rem]">
                  <div>
                    <label class="label">Producto</label>
                    <select class="input" [(ngModel)]="line.productId" [name]="'ing-product-' + $index">
                      <option value="">Selecciona un producto…</option>
                      @for (product of productOptions(); track product.id) {
                        <option [value]="product.id">{{ product.name }} ({{ product.sku }})</option>
                      }
                    </select>
                  </div>
                  <div>
                    <label class="label">Cantidad</label>
                    <input
                      class="input"
                      type="number"
                      min="0.001"
                      step="0.001"
                      [(ngModel)]="line.quantity"
                      [name]="'ing-qty-' + $index"
                    />
                  </div>
                  <div>
                    <label class="label">Sección</label>
                    <select class="input" [(ngModel)]="line.section" [name]="'ing-section-' + $index">
                      @for (option of sectionOptions; track option.value) {
                        <option [value]="option.value">{{ option.label }}</option>
                      }
                    </select>
                  </div>
                  <button
                    type="button"
                    class="btn-ghost btn-sm text-rose-600"
                    title="Quitar ingrediente"
                    (click)="removeIngredient($index)"
                  >
                    <app-icon name="close" size="h-4 w-4" />
                  </button>
                </div>
                <p
                  class="text-xs text-slate-500"
                  [class.text-rose-600]="lineInactive(line)"
                  [class.font-medium]="lineInactive(line)"
                >
                  {{ productLabel(line) }}
                  @if (lineCost(line) > 0) {
                    · cuesta {{ money(lineCost(line)) }} por unidad
                  }
                  @if (servingsFor(line) !== null) {
                    · alcanza para {{ servingsFor(line) }}
                  }
                </p>
              }
            </div>
          }

          <div class="mt-3 grid gap-2 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-3">
            <p>
              <span class="text-slate-500">Costo de la receta:</span>
              <span class="font-semibold text-slate-900">{{ money(recipeCost()) }}</span>
            </p>
            <p>
              <span class="text-slate-500">Margen:</span>
              <span class="font-semibold" [class]="margin() >= 0 ? 'text-emerald-600' : 'text-rose-600'">
                {{ money(margin()) }}
              </span>
            </p>
            <p>
              <span class="text-slate-500">Alcanza para:</span>
              <span class="font-semibold text-slate-900">
                {{ recipeServings() === null ? 'Ilimitado' : recipeServings() + ' porción(es)' }}
              </span>
            </p>
          </div>
        </section>

        <div class="dialog-footer flex justify-end gap-2">
          <button type="button" class="btn-secondary" (click)="closeModal()">Cancelar</button>
          <button type="submit" class="btn-primary" [disabled]="saving() || menuForm.invalid">
            {{ saving() ? 'Guardando…' : 'Guardar' }}
          </button>
        </div>
      </form>
    </app-modal>
    <!-- Formulario de categoria de menu -->
    <app-modal
      [open]="categoryModalOpen()"
      [title]="editingCategory() ? 'Editar categoría' : 'Nueva categoría'"
      subtitle="Agrupa los menús por cómo se venden (Desayunos, Combos…)"
      size="md"
      (closed)="closeCategoryModal()"
    >
      <form class="space-y-4" (ngSubmit)="saveCategory()" #categoryForm="ngForm">
        <div>
          <label class="label">Nombre</label>
          <input class="input" name="catName" required minlength="2" [(ngModel)]="categoryFields.name" placeholder="Almuerzos" />
        </div>
        <div>
          <label class="label">Categoría principal</label>
          <select
            class="input"
            name="catParent"
            [(ngModel)]="categoryFields.parentId"
            [disabled]="editingCategoryHasSubcategories()"
          >
            <option value="">Ninguna (categoría principal)</option>
            @for (parent of categoryParentOptions(); track parent.id) {
              <option [value]="parent.id">{{ categoryOptionLabel(parent) }}</option>
            }
          </select>
          @if (editingCategoryHasSubcategories()) {
            <p class="field-error">
              Esta categoría tiene subcategorías: no puede ser subcategoría de otra.
            </p>
          } @else {
            <p class="mt-1 text-xs text-slate-500">
              Opcional: elige una principal para convertirla en subcategoría.
            </p>
          }
        </div>
        <div>
          <label class="label">Descripción</label>
          <input class="input" name="catDescription" [(ngModel)]="categoryFields.description" />
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <label class="label">Color <span class="text-slate-400">(opcional)</span></label>
            <input class="input" name="catColor" [(ngModel)]="categoryFields.color" placeholder="#f59e0b" />
          </div>
          <div>
            <label class="label">Orden</label>
            <input class="input" type="number" min="0" name="catOrder" [(ngModel)]="categoryFields.sortOrder" />
          </div>
        </div>
        <label class="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" class="h-4 w-4" name="catActive" [(ngModel)]="categoryFields.active" />
          Activa
        </label>
        <div class="dialog-footer flex justify-end gap-2">
          <button type="button" class="btn-secondary" (click)="closeCategoryModal()">Cancelar</button>
          <button type="submit" class="btn-primary" [disabled]="saving() || categoryForm.invalid">
            {{ saving() ? 'Guardando…' : 'Guardar' }}
          </button>
        </div>
      </form>
    </app-modal>
  `,
})
export class MenusPage implements OnInit {
  readonly auth = inject(AuthService);
  private readonly menus = inject(MenusService);
  private readonly menuCategories = inject(MenuCategoriesService);
  private readonly products = inject(ProductsService);
  /** Moneda con la que se abren los formularios (la base del sistema). */
  private readonly rates = inject(RatesService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  /** Helpers de formato expuestos a la plantilla. */
  readonly money = money;
  readonly quantity = quantity;
  readonly availabilityOptions = MENU_AVAILABILITY_OPTIONS;
  readonly sectionOptions = MENU_SECTION_OPTIONS;
  readonly productImageMaxSize = PRODUCT_IMAGE_MAX_SIZE;

  readonly tab = signal<'menus' | 'categories'>('menus');

  readonly items = signal<Menu[]>([]);
  readonly meta = signal<PaginationMeta>(EMPTY_META);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly modalOpen = signal(false);
  readonly editing = signal<Menu | null>(null);

  readonly categories = signal<MenuCategory[]>([]);
  readonly categoriesLoading = signal(false);
  readonly categoryModalOpen = signal(false);
  readonly editingCategory = signal<MenuCategory | null>(null);
  /** Cuando se ven las subcategorias de una categoria principal. */
  readonly categoryParentFilter = signal<MenuCategory | null>(null);

  /** Solo las principales pueden ser padre (un nivel de subcategorias). */
  readonly categoryParentOptions = computed(() =>
    this.categories().filter(
      (category) =>
        !category.parentId && category.id !== this.editingCategory()?.id,
    ),
  );
  /** Una categoria con hijas no puede convertirse en subcategoria. */
  readonly editingCategoryHasSubcategories = computed(
    () => (this.editingCategory()?._count?.subcategories ?? 0) > 0,
  );

  readonly categoryOptionLabel = categoryOptionLabel;

  readonly productOptions = signal<ProductOption[]>([]);
  readonly imageReading = signal(false);
  readonly imageError = signal<string | null>(null);

  /** Disponibilidad del menu: porciones, agotado o receta con un insumo inactivo. */
  readonly menuStockLabel = menuStockLabel;
  readonly menuUnavailableReason = menuUnavailableReason;
  readonly menuTitle = menuTitle;

  search = '';
  categoryId = '';
  onlyAvailable = false;

  private page = 1;
  private limit = 20;

  form: MenuForm = this.emptyForm();
  categoryFields: CategoryForm = this.emptyCategoryForm();

  ngOnInit(): void {
    this.load();
    this.loadCategories();
    this.products.options().subscribe({
      next: (list) => this.productOptions.set(list),
      error: () => this.productOptions.set([]),
    });
  }

  private emptyForm(): MenuForm {
    return {
      code: '',
      name: '',
      description: '',
      imageUrl: '',
      price: 0,
      // Los precios nuevos se cargan en la moneda base del sistema.
      priceCurrency: this.rates.baseCode(),
      availability: 'ALL',
      preparationMinutes: null,
      categoryId: '',
      active: true,
      ingredients: [],
    };
  }

  // =========================================================================
  //  LISTADO
  // =========================================================================

  load(): void {
    this.loading.set(true);
    this.menus
      .list({
        page: this.page,
        limit: this.limit,
        search: this.search || undefined,
        categoryId: this.categoryId || undefined,
        onlyAvailable: this.onlyAvailable || undefined,
      })
      .subscribe({
        next: (response) => {
          this.items.set(response.items);
          this.meta.set(response.meta);
          this.loading.set(false);
        },
        error: (error) => {
          this.loading.set(false);
          this.toast.error(apiErrorMessage(error));
        },
      });
  }

  loadCategories(): void {
    this.categoriesLoading.set(true);
    // Sin paginar: las categorias de la carta son pocas y alimentan tambien el
    // select del formulario de menu.
    this.menuCategories
      .list({
        limit: 100,
        parentId: this.categoryParentFilter()?.id,
      })
      .subscribe({
        next: (response) => {
          this.categories.set(response.items);
          this.categoriesLoading.set(false);
        },
        error: () => this.categoriesLoading.set(false),
      });
  }

  /** Navega a las subcategorias de una principal (un clic en el conteo). */
  filterCategoriesByParent(category: MenuCategory): void {
    this.categoryParentFilter.set(category);
    this.loadCategories();
  }

  clearCategoryParentFilter(): void {
    this.categoryParentFilter.set(null);
    this.loadCategories();
  }

  applyFilters(): void {
    this.page = 1;
    this.load();
  }

  resetFilters(): void {
    this.search = '';
    this.categoryId = '';
    this.onlyAvailable = false;
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

  // =========================================================================
  //  FORMULARIO DEL MENU (ficha + receta)
  // =========================================================================

  openCreate(): void {
    this.editing.set(null);
    this.form = this.emptyForm();
    this.imageError.set(null);
    this.modalOpen.set(true);
  }

  openEdit(menu: Menu): void {
    this.editing.set(menu);
    this.form = {
      code: menu.code,
      name: menu.name,
      description: menu.description ?? '',
      imageUrl: menu.imageUrl ?? '',
      // Se recupera lo que se escribio (y en que moneda) al reabrir el formulario.
      price: menu.priceEntered ?? menu.price,
      priceCurrency: menu.priceCurrency,
      availability: menu.availability,
      preparationMinutes: menu.preparationMinutes ?? null,
      categoryId: menu.categoryId ?? '',
      active: menu.active,
      ingredients: menu.ingredients.map((ingredient) => ({
        productId: ingredient.productId,
        quantity: ingredient.quantity,
        section: ingredient.section ?? 'Principal',
        note: ingredient.note ?? '',
      })),
    };
    this.imageError.set(null);
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.modalOpen.set(false);
  }

  addIngredient(): void {
    this.form.ingredients = [
      ...this.form.ingredients,
      { productId: '', quantity: 1, section: 'Principal', note: '' },
    ];
  }

  removeIngredient(index: number): void {
    this.form.ingredients = this.form.ingredients.filter(
      (_line, position) => position !== index,
    );
  }

  /** Costo de una linea: costo del producto x cantidad consumida. */
  lineCost(line: RecipeLine): number {
    const product = this.productOptions().find(
      (option) => option.id === line.productId,
    );
    if (!product) return 0;
    return mulMoney(product.cost ?? 0, Number(line.quantity) || 0);
  }

  /** Costo total de la receta (lo que cuesta preparar una unidad del menu). */
  recipeCost(): number {
    return sumMoney(this.form.ingredients.map((line) => this.lineCost(line)));
  }

  /** Como se cargo el precio de la carta, cuando no fue en dolares. */
  priceHint(menu: Menu): string | null {
    if (menu.priceCurrency === BASE_CURRENCY_CODE) return null;
    if (menu.priceEntered == null) return null;
    return `Cargado en ${moneyIn(menu.priceEntered, menu.priceCurrency)}`;
  }

  /** Margen estimado del formulario: precio - costo de la receta (en USD). */
  margin(): number {
    const price = this.rates.toBase(this.form.price, this.form.priceCurrency);
    return sumMoney([price ?? 0, -this.recipeCost()]);
  }

  /**
   * Porciones que alcanza el stock actual de UN ingrediente (`null` cuando el
   * producto no lleva control de inventario o no se eligio producto).
   */
  servingsFor(line: RecipeLine): number | null {
    const product = this.productOptions().find(
      (option) => option.id === line.productId,
    );
    const needed = Number(line.quantity) || 0;
    if (!product || needed <= 0) return null;
    return Math.floor(Number(product.stock) / needed);
  }

  /** Porciones que alcanza la receta completa (`null` = sin tope de inventario). */
  recipeServings(): number | null {
    const servings = this.form.ingredients
      .map((line) => this.servingsFor(line))
      .filter((value): value is number => value !== null);
    return servings.length === 0 ? null : Math.min(...servings);
  }

  /**
   * Texto de ayuda del ingrediente: producto, unidad y stock disponible. Un
   * producto DESACTIVADO ya no llega en las opciones (`/products/options` solo
   * devuelve activos), asi que se avisa que hay que reemplazarlo: el API no
   * acepta guardar una receta con un ingrediente inactivo.
   */
  productLabel(line: RecipeLine): string {
    const product = this.productOptions().find(
      (option) => option.id === line.productId,
    );
    if (!product) {
      return line.productId
        ? 'Producto inactivo: reemplázalo para poder guardar la receta'
        : 'Selecciona un producto del inventario';
    }
    return `${product.name} · se descuenta en ${product.unit} (stock ${quantity(product.stock)})`;
  }

  /** `true` cuando la linea apunta a un producto que ya no esta activo. */
  lineInactive(line: RecipeLine): boolean {
    return (
      !!line.productId &&
      !this.productOptions().some((option) => option.id === line.productId)
    );
  }

  // =========================================================================
  //  GUARDAR / ELIMINAR
  // =========================================================================

  save(): void {
    if (this.saving()) return;

    const ingredients = this.form.ingredients.filter((line) => !!line.productId);
    if (ingredients.length === 0) {
      this.toast.error('Agrega al menos un ingrediente a la receta del menú.');
      return;
    }
    if (ingredients.some((line) => !(Number(line.quantity) > 0))) {
      this.toast.error('Cada ingrediente necesita una cantidad mayor a 0.');
      return;
    }
    const repeated = this.repeatedProduct(ingredients);
    if (repeated) {
      this.toast.error(`El producto "${repeated}" está repetido en la receta.`);
      return;
    }

    this.saving.set(true);
    const payload = {
      code: this.form.code.trim() || undefined,
      name: this.form.name.trim(),
      description: this.form.description.trim() || undefined,
      imageUrl: this.form.imageUrl.trim() || undefined,
      // El backend convierte a USD si el precio se cargo en otra moneda.
      price: Number(this.form.price) || 0,
      priceCurrency: this.form.priceCurrency,
      availability: this.form.availability as MenuAvailability,
      preparationMinutes: this.form.preparationMinutes
        ? Number(this.form.preparationMinutes)
        : undefined,
      categoryId: this.form.categoryId || null,
      active: this.form.active,
      ingredients: ingredients.map((line, index) => ({
        productId: line.productId,
        quantity: Number(line.quantity),
        section: line.section as MenuSection,
        note: line.note.trim() || undefined,
        sortOrder: index,
      })),
    };

    const current = this.editing();
    const request = current
      ? this.menus.update(current.id, payload)
      : this.menus.create(payload);

    request.subscribe({
      next: () => {
        this.saving.set(false);
        this.closeModal();
        this.toast.success(current ? 'Menú actualizado' : 'Menú creado');
        this.load();
      },
      error: (error) => {
        this.saving.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  /** Nombre del producto repetido en la receta (o `null` si no hay repetidos). */
  private repeatedProduct(lines: RecipeLine[]): string | null {
    const seen = new Set<string>();
    for (const line of lines) {
      if (seen.has(line.productId)) {
        const product = this.productOptions().find(
          (option) => option.id === line.productId,
        );
        return product?.name ?? 'Producto';
      }
      seen.add(line.productId);
    }
    return null;
  }

  async remove(menu: Menu): Promise<void> {
    const confirmed = await this.confirm.ask({
      title: 'Desactivar menú',
      message: `¿Desactivar "${menu.name}"? Deja de ofrecerse en el POS y en los pedidos; su historial se conserva.`,
      confirmLabel: 'Desactivar',
      tone: 'danger',
    });
    if (!confirmed) return;

    this.menus.remove(menu.id).subscribe({
      next: () => {
        this.toast.success('Menú desactivado');
        this.load();
      },
      error: (error) => this.toast.error(apiErrorMessage(error)),
    });
  }

  // =========================================================================
  //  IMAGEN
  // =========================================================================

  async onImageSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.imageReading.set(true);
    this.imageError.set(null);
    try {
      this.form.imageUrl = await toProductImageDataUrl(file);
    } catch (error) {
      this.imageError.set(
        error instanceof Error ? error.message : 'No se pudo leer la imagen',
      );
    } finally {
      this.imageReading.set(false);
      input.value = '';
    }
  }

  clearImage(): void {
    this.form.imageUrl = '';
  }

  // =========================================================================
  //  CATEGORIAS DE MENU
  // =========================================================================

  private emptyCategoryForm(): CategoryForm {
    return {
      name: '',
      description: '',
      color: '',
      sortOrder: 0,
      parentId: '',
      active: true,
    };
  }

  openCategoryCreate(): void {
    this.editingCategory.set(null);
    // Si se esta viendo una principal, la nueva categoria nace como su hija.
    this.categoryFields = {
      ...this.emptyCategoryForm(),
      parentId: this.categoryParentFilter()?.id ?? '',
    };
    this.categoryModalOpen.set(true);
  }

  /** Crea una subcategoria de la categoria de menu indicada. */
  openCategoryCreateSub(parent: MenuCategory): void {
    this.editingCategory.set(null);
    this.categoryFields = { ...this.emptyCategoryForm(), parentId: parent.id };
    this.categoryModalOpen.set(true);
  }

  openCategoryEdit(category: MenuCategory): void {
    this.editingCategory.set(category);
    this.categoryFields = {
      name: category.name,
      description: category.description ?? '',
      color: category.color ?? '',
      sortOrder: category.sortOrder,
      parentId: category.parentId ?? '',
      active: category.active,
    };
    this.categoryModalOpen.set(true);
  }

  closeCategoryModal(): void {
    this.categoryModalOpen.set(false);
  }

  saveCategory(): void {
    if (this.saving()) return;
    this.saving.set(true);

    const payload = {
      name: this.categoryFields.name.trim(),
      description: this.categoryFields.description.trim() || undefined,
      color: this.categoryFields.color.trim() || undefined,
      sortOrder: Number(this.categoryFields.sortOrder) || 0,
      // Vacio = categoria principal (la subcategoria es opcional).
      parentId: this.categoryFields.parentId || null,
      active: this.categoryFields.active,
    };
    const current = this.editingCategory();
    const request = current
      ? this.menuCategories.update(current.id, payload)
      : this.menuCategories.create(payload);

    request.subscribe({
      next: () => {
        this.saving.set(false);
        this.closeCategoryModal();
        this.toast.success(
          current ? 'Categoría actualizada' : 'Categoría creada',
        );
        this.loadCategories();
        this.load();
      },
      error: (error) => {
        this.saving.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  async removeCategory(category: MenuCategory): Promise<void> {
    const subcategories = category._count?.subcategories ?? 0;
    const confirmed = await this.confirm.ask({
      title: 'Eliminar categoría',
      message:
        `¿Eliminar "${category.name}"? Los menús asociados quedan sin categoría.` +
        (subcategories
          ? ` Sus ${subcategories} subcategorías quedarán como categorías principales.`
          : ''),
      confirmLabel: 'Eliminar',
      tone: 'danger',
    });
    if (!confirmed) return;

    this.menuCategories.remove(category.id).subscribe({
      next: () => {
        this.toast.success('Categoría eliminada');
        // Si estabamos viendo sus subcategorias, volvemos al listado completo.
        if (this.categoryParentFilter()?.id === category.id) {
          this.categoryParentFilter.set(null);
        }
        this.loadCategories();
        this.load();
      },
      error: (error) => this.toast.error(apiErrorMessage(error)),
    });
  }
}
