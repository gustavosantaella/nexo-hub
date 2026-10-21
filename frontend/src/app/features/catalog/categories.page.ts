import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Category, PaginationMeta } from '../../core/models/api.model';
import { AuthService } from '../../core/services/auth.service';
import { CategoriesService } from '../../core/services/catalog.service';
import { ToastService } from '../../core/services/toast.service';
import { categoryOptionLabel } from '../../core/utils/category-tree';
import { apiErrorMessage } from '../../core/utils/format';
import { EmptyStateComponent, LoaderComponent } from '../../shared/components/feedback.component';
import { IconComponent } from '../../shared/components/icon.component';
import { ModalComponent } from '../../shared/components/modal.component';
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

/**
 * Pagina CRUD de referencia: define el patron usado por el resto de listados
 * (signals + servicio HttpClient + modal de formulario + paginacion + toasts).
 */
@Component({
  selector: 'app-categories',
  standalone: true,
  imports: [
    FormsModule,
    IconComponent,
    PageHeaderComponent,
    PaginationComponent,
    ModalComponent,
    EmptyStateComponent,
    LoaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './categories.page.html',
})
export class CategoriesPage implements OnInit {
  readonly auth = inject(AuthService);
  private readonly categories = inject(CategoriesService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  readonly items = signal<Category[]>([]);
  readonly meta = signal<PaginationMeta>(EMPTY_META);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly modalOpen = signal(false);
  readonly editing = signal<Category | null>(null);

  /** Categorias activas: alimentan el select de categoria principal. */
  readonly categoryOptions = signal<Category[]>([]);
  /** Cuando se navega a las subcategorias de una categoria principal. */
  readonly parentFilter = signal<Category | null>(null);

  /** Solo las principales pueden ser padre (un nivel de subcategorias). */
  readonly parentOptions = computed(() =>
    this.categoryOptions().filter(
      (category) => !category.parentId && category.id !== this.editing()?.id,
    ),
  );
  /** Una categoria con hijas no puede convertirse en subcategoria. */
  readonly hasSubcategories = computed(
    () => (this.editing()?._count?.subcategories ?? 0) > 0,
  );

  readonly categoryOptionLabel = categoryOptionLabel;

  search = '';
  private page = 1;
  private limit = 20;

  form = { name: '', description: '', parentId: '', active: true };

  ngOnInit(): void {
    this.load();
    this.loadOptions();
  }

  load(): void {
    this.loading.set(true);
    this.categories
      .list({
        page: this.page,
        limit: this.limit,
        search: this.search || undefined,
        parentId: this.parentFilter()?.id,
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

  /** Refresca el select de categoria principal (se guardan cambios arriba). */
  private loadOptions(): void {
    this.categories.options().subscribe({
      next: (list) => this.categoryOptions.set(list),
      error: () => this.categoryOptions.set([]),
    });
  }

  /** Navega a las subcategorias de una principal (un clic en el conteo). */
  filterByParent(category: Category): void {
    this.parentFilter.set(category);
    this.page = 1;
    this.load();
  }

  clearParentFilter(): void {
    this.parentFilter.set(null);
    this.page = 1;
    this.load();
  }

  applySearch(): void {
    this.page = 1;
    this.load();
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
    // Si se esta viendo una principal, la nueva categoria nace como su hija.
    this.form = {
      name: '',
      description: '',
      parentId: this.parentFilter()?.id ?? '',
      active: true,
    };
    this.modalOpen.set(true);
  }

  /** Crea una subcategoria de la principal indicada. */
  openCreateSub(parent: Category): void {
    this.editing.set(null);
    this.form = { name: '', description: '', parentId: parent.id, active: true };
    this.modalOpen.set(true);
  }

  openEdit(item: Category): void {
    this.editing.set(item);
    this.form = {
      name: item.name,
      description: item.description ?? '',
      parentId: item.parentId ?? '',
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

    const payload = {
      name: this.form.name.trim(),
      description: this.form.description.trim() || undefined,
      // Vacio = categoria principal.
      parentId: this.form.parentId || null,
      active: this.form.active,
    };
    const current = this.editing();
    const request = current
      ? this.categories.update(current.id, payload)
      : this.categories.create(payload);

    request.subscribe({
      next: () => {
        this.saving.set(false);
        this.closeModal();
        this.toast.success(current ? 'Categoría actualizada' : 'Categoría creada');
        this.load();
        this.loadOptions();
      },
      error: (error) => {
        this.saving.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  async remove(item: Category): Promise<void> {
    const subcategories = item._count?.subcategories ?? 0;
    const confirmed = await this.confirm.ask({
      title: 'Eliminar categoría',
      message:
        `¿Eliminar "${item.name}"? Los productos asociados quedarán sin categoría.` +
        (subcategories
          ? ` Sus ${subcategories} subcategorías quedarán como categorías principales.`
          : ''),
      confirmLabel: 'Eliminar',
      tone: 'danger',
    });
    if (!confirmed) return;

    this.categories.remove(item.id).subscribe({
      next: () => {
        this.toast.success('Categoría eliminada');
        // Si estabamos viendo sus subcategorias, volvemos al listado completo.
        if (this.parentFilter()?.id === item.id) this.parentFilter.set(null);
        this.load();
        this.loadOptions();
      },
    });
  }
}
