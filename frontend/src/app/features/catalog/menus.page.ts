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
  templateUrl: './menus.page.html',
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

    // La receta es opcional: se descartan las lineas sin producto, pero el menu
    // se puede guardar sin ingredientes (no descuenta inventario).
    const ingredients = this.form.ingredients.filter((line) => !!line.productId);
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
