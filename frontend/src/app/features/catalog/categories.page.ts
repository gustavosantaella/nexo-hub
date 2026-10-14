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
  template: `    <app-page-header
      title="Categorías"
      subtitle="Agrupa tus productos para ordenar el catálogo y las ventas"
      icon="folder"
    >
      @if (auth.canManage()) {
        <button type="button" class="btn-primary" (click)="openCreate()">
          <app-icon name="plus" size="h-4 w-4" />
          Nueva categoría
        </button>
      }
    </app-page-header>

    <section class="card">
      <div class="card-header">
        <div class="flex w-full max-w-xl flex-wrap items-center gap-2">
          <div class="relative flex-1">
            <span class="pointer-events-none absolute left-3 top-2.5 text-slate-400">
              <app-icon name="search" size="h-4 w-4" />
            </span>
            <input
              class="input pl-9"
              placeholder="Buscar por nombre…"
              [(ngModel)]="search"
              (keyup.enter)="applySearch()"
            />
          </div>
          <button type="button" class="btn-secondary" (click)="applySearch()">Buscar</button>
          @if (parentFilter(); as parent) {
            <span class="badge bg-slate-100 text-slate-600">
              Subcategorías de {{ parent.name }}
            </span>
            <button type="button" class="btn-ghost btn-sm" (click)="clearParentFilter()">
              Ver todas
            </button>
          }
        </div>
      </div>

      @if (loading()) {
        <app-loader />
      } @else if (items().length === 0) {
        <app-empty-state
          title="Sin categorías"
          message="Crea la primera categoría para organizar tus productos."
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
                <th class="text-center">Productos</th>
                <th class="text-center">Subcategorías</th>
                <th class="text-center">Estado</th>
                <th class="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              @for (item of items(); track item.id) {
                <tr>
                  <td class="font-medium text-slate-900">
                    <span class="flex items-center gap-2">
                      @if (item.parentId) {
                        <span class="text-slate-300">↳</span>
                      }
                      {{ item.name }}
                    </span>
                  </td>
                  <td class="text-slate-500">
                    {{ item.parent?.name || 'Principal' }}
                  </td>
                  <td class="max-w-xs truncate text-slate-500">{{ item.description || '—' }}</td>
                  <td class="text-center">{{ item._count?.products ?? 0 }}</td>
                  <td class="text-center">
                    @if (item._count?.subcategories) {
                      <button
                        type="button"
                        class="btn-ghost btn-sm"
                        title="Ver subcategorías"
                        (click)="filterByParent(item)"
                      >
                        {{ item._count?.subcategories }}
                      </button>
                    } @else {
                      <span class="text-slate-400">—</span>
                    }
                  </td>
                  <td class="text-center">
                    <span
                      class="badge"
                      [class]="item.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'"
                    >
                      {{ item.active ? 'Activa' : 'Inactiva' }}
                    </span>
                  </td>
                  <td>
                    <div class="flex justify-end gap-1">
                      @if (auth.canManage()) {
                        @if (!item.parentId) {
                          <button
                            type="button"
                            class="btn-ghost btn-sm"
                            title="Nueva subcategoría"
                            (click)="openCreateSub(item)"
                          >
                            <app-icon name="plus" size="h-4 w-4" />
                          </button>
                        }
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
                          title="Eliminar"
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
      [title]="editing() ? 'Editar categoría' : 'Nueva categoría'"
      subtitle="Las categorías agrupan tus productos en los reportes"
      size="sm"
      (closed)="closeModal()"
    >
      <form class="space-y-4" (ngSubmit)="save()" #catForm="ngForm">
        <div>
          <label class="label" for="cat-name">Nombre *</label>
          <input
            id="cat-name"
            name="name"
            class="input"
            required
            minlength="2"
            [(ngModel)]="form.name"
            placeholder="Ej. Bebidas"
          />
        </div>
        <div>
          <label class="label" for="cat-parent">Categoría principal</label>
          <select
            id="cat-parent"
            name="parentId"
            class="input"
            [(ngModel)]="form.parentId"
            [disabled]="hasSubcategories()"
          >
            <option value="">Ninguna (categoría principal)</option>
            @for (category of parentOptions(); track category.id) {
              <option [value]="category.id">{{ categoryOptionLabel(category) }}</option>
            }
          </select>
          @if (hasSubcategories()) {
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
          <label class="label" for="cat-desc">Descripción</label>
          <textarea
            id="cat-desc"
            name="description"
            class="input"
            rows="3"
            [(ngModel)]="form.description"
            placeholder="Detalle opcional"
          ></textarea>
        </div>
        <label class="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" name="active" [(ngModel)]="form.active" class="h-4 w-4" />
          Categoría activa
        </label>

        <div modalFooter class="flex w-full justify-end gap-2">
          <button type="button" class="btn-secondary" (click)="closeModal()">Cancelar</button>
          <button type="submit" class="btn-primary" [disabled]="saving() || catForm.invalid">
            {{ saving() ? 'Guardando…' : 'Guardar' }}
          </button>
        </div>
      </form>
    </app-modal>
`,
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
