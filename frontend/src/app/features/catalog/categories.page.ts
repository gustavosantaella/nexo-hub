import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Category, PaginationMeta } from '../../core/models/api.model';
import { AuthService } from '../../core/services/auth.service';
import { CategoriesService } from '../../core/services/catalog.service';
import { ToastService } from '../../core/services/toast.service';
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
        <div class="flex w-full max-w-sm items-center gap-2">
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
                <th>Descripción</th>
                <th class="text-center">Productos</th>
                <th class="text-center">Estado</th>
                <th class="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              @for (item of items(); track item.id) {
                <tr>
                  <td class="font-medium text-slate-900">{{ item.name }}</td>
                  <td class="max-w-xs truncate text-slate-500">{{ item.description || '—' }}</td>
                  <td class="text-center">{{ item._count?.products ?? 0 }}</td>
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

  search = '';
  private page = 1;
  private limit = 20;

  form = { name: '', description: '', active: true };

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.categories
      .list({ page: this.page, limit: this.limit, search: this.search || undefined })
      .subscribe({
        next: (response) => {
          this.items.set(response.items);
          this.meta.set(response.meta);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
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
    this.form = { name: '', description: '', active: true };
    this.modalOpen.set(true);
  }

  openEdit(item: Category): void {
    this.editing.set(item);
    this.form = {
      name: item.name,
      description: item.description ?? '',
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
      },
      error: (error) => {
        this.saving.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  async remove(item: Category): Promise<void> {
    const confirmed = await this.confirm.ask({
      title: 'Eliminar categoría',
      message: `¿Eliminar "${item.name}"? Los productos asociados quedarán sin categoría.`,
      confirmLabel: 'Eliminar',
      tone: 'danger',
    });
    if (!confirmed) return;

    this.categories.remove(item.id).subscribe({
      next: () => {
        this.toast.success('Categoría eliminada');
        this.load();
      },
    });
  }
}
