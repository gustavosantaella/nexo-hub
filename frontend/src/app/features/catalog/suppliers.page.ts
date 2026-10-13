import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { PaginationMeta, Supplier, SupplierPayload } from '../../core/models/api.model';
import { AuthService } from '../../core/services/auth.service';
import { SuppliersService } from '../../core/services/catalog.service';
import { ToastService } from '../../core/services/toast.service';
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

interface SupplierForm {
  name: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  taxId: string;
  notes: string;
  active: boolean;
}

/** Listado de proveedores con datos de contacto y baja logica. */
@Component({
  selector: 'app-suppliers',
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
      title="Proveedores"
      subtitle="Empresas y contactos que abastecen tu negocio"
      icon="truck"
    >
      @if (auth.canManage()) {
        <button type="button" class="btn-primary" (click)="openCreate()">
          <app-icon name="plus" size="h-4 w-4" />
          Nuevo proveedor
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
          title="Sin proveedores"
          message="Registra a tus proveedores para asociarlos a los productos y compras."
          icon="truck"
        />
      } @else {
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Contacto</th>
                <th>Teléfono</th>
                <th>Email</th>
                <th>RUC</th>
                <th class="text-center">Productos</th>
                <th class="text-center">Estado</th>
                <th class="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              @for (item of items(); track item.id) {
                <tr>
                  <td class="font-medium text-slate-900">{{ item.name }}</td>
                  <td class="text-slate-500">{{ item.contactName || '—' }}</td>
                  <td class="text-slate-500">{{ item.phone || '—' }}</td>
                  <td class="text-slate-500">{{ item.email || '—' }}</td>
                  <td class="font-mono text-xs text-slate-500">{{ item.taxId || '—' }}</td>
                  <td class="text-center">{{ item._count?.products ?? 0 }}</td>
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
      [title]="editing() ? 'Editar proveedor' : 'Nuevo proveedor'"
      subtitle="Datos de contacto y facturación del proveedor"
      size="lg"
      (closed)="closeModal()"
    >
      <form class="space-y-4" (ngSubmit)="save()" #supplierForm="ngForm">
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label class="label" for="sup-name">Nombre *</label>
            <input
              id="sup-name"
              name="name"
              class="input"
              required
              minlength="2"
              [(ngModel)]="form.name"
              placeholder="Ej. Distribuidora Andina S.A.C."
            />
          </div>
          <div>
            <label class="label" for="sup-contact">Contacto</label>
            <input
              id="sup-contact"
              name="contactName"
              class="input"
              [(ngModel)]="form.contactName"
              placeholder="Ej. Juan Pérez"
            />
          </div>
          <div>
            <label class="label" for="sup-phone">Teléfono</label>
            <input
              id="sup-phone"
              name="phone"
              type="tel"
              class="input"
              [(ngModel)]="form.phone"
              placeholder="Ej. 987 654 321"
            />
          </div>
          <div>
            <label class="label" for="sup-email">Email</label>
            <input
              id="sup-email"
              name="email"
              type="email"
              class="input"
              [(ngModel)]="form.email"
              placeholder="contacto@proveedor.com"
            />
          </div>
          <div class="sm:col-span-2">
            <label class="label" for="sup-address">Dirección</label>
            <input
              id="sup-address"
              name="address"
              class="input"
              [(ngModel)]="form.address"
              placeholder="Av. Siempre Viva 123, Lima"
            />
          </div>
          <div>
            <label class="label" for="sup-taxId">RIF / Documento</label>
            <input
              id="sup-taxId"
              name="taxId"
              class="input"
              [(ngModel)]="form.taxId"
              placeholder="Ej. 20123456789"
            />
          </div>
          <div class="sm:col-span-2">
            <label class="label" for="sup-notes">Notas</label>
            <textarea
              id="sup-notes"
              name="notes"
              class="input"
              rows="3"
              [(ngModel)]="form.notes"
              placeholder="Condiciones de pago, días de entrega, etc."
            ></textarea>
          </div>
        </div>

        <label class="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" name="active" class="h-4 w-4" [(ngModel)]="form.active" />
          Proveedor activo
        </label>

        <div modalFooter class="flex w-full justify-end gap-2">
          <button type="button" class="btn-secondary" (click)="closeModal()">Cancelar</button>
          <button type="submit" class="btn-primary" [disabled]="saving() || supplierForm.invalid">
            {{ saving() ? 'Guardando…' : 'Guardar' }}
          </button>
        </div>
      </form>
    </app-modal>
`,
})
export class SuppliersPage implements OnInit {
  readonly auth = inject(AuthService);
  private readonly suppliers = inject(SuppliersService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  readonly items = signal<Supplier[]>([]);
  readonly meta = signal<PaginationMeta>(EMPTY_META);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly modalOpen = signal(false);
  readonly editing = signal<Supplier | null>(null);

  search = '';
  private page = 1;
  private limit = 20;

  form: SupplierForm = this.emptyForm();

  ngOnInit(): void {
    this.load();
  }

  private emptyForm(): SupplierForm {
    return {
      name: '',
      contactName: '',
      phone: '',
      email: '',
      address: '',
      taxId: '',
      notes: '',
      active: true,
    };
  }

  load(): void {
    this.loading.set(true);
    this.suppliers
      .list({ page: this.page, limit: this.limit, search: this.search.trim() || undefined })
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
    this.form = this.emptyForm();
    this.modalOpen.set(true);
  }

  openEdit(item: Supplier): void {
    this.editing.set(item);
    this.form = {
      name: item.name,
      contactName: item.contactName ?? '',
      phone: item.phone ?? '',
      email: item.email ?? '',
      address: item.address ?? '',
      taxId: item.taxId ?? '',
      notes: item.notes ?? '',
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
    const payload: SupplierPayload = {
      name: this.form.name.trim(),
      contactName: this.form.contactName.trim() || undefined,
      phone: this.form.phone.trim() || undefined,
      email: this.form.email.trim() || undefined,
      address: this.form.address.trim() || undefined,
      taxId: this.form.taxId.trim() || undefined,
      notes: this.form.notes.trim() || undefined,
      active: this.form.active,
    };

    const request = current
      ? this.suppliers.update(current.id, payload)
      : this.suppliers.create(payload);

    request.subscribe({
      next: () => {
        this.saving.set(false);
        this.closeModal();
        this.toast.success(current ? 'Proveedor actualizado' : 'Proveedor creado');
        this.load();
      },
      error: () => this.saving.set(false),
    });
  }

  async remove(item: Supplier): Promise<void> {
    const confirmed = await this.confirm.ask({
      title: 'Desactivar proveedor',
      message: `¿Desactivar "${item.name}"? El proveedor dejará de estar disponible en las compras.`,
      confirmLabel: 'Eliminar',
      tone: 'danger',
    });
    if (!confirmed) return;

    this.suppliers.remove(item.id).subscribe({
      next: () => {
        this.toast.success('Proveedor desactivado');
        this.load();
      },
    });
  }
}
