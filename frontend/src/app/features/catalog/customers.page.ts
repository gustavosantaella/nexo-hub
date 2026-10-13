import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Customer, CustomerPayload, PaginationMeta } from '../../core/models/api.model';
import { AuthService } from '../../core/services/auth.service';
import { CustomersService } from '../../core/services/catalog.service';
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

interface CustomerForm {
  name: string;
  docNumber: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  active: boolean;
}

/** Directorio de clientes con su historial de pedidos y cuentas por cobrar. */
@Component({
  selector: 'app-customers',
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
      title="Clientes"
      subtitle="Directorio de clientes, pedidos y saldos por cobrar"
      icon="users"
    >
      @if (auth.canManage()) {
        <button type="button" class="btn-primary" (click)="openCreate()">
          <app-icon name="plus" size="h-4 w-4" />
          Nuevo cliente
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
              placeholder="Buscar por nombre o teléfono…"
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
          title="Sin clientes"
          message="Registra clientes para asignarlos a los pedidos y controlar sus saldos."
          icon="users"
        />
      } @else {
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Documento</th>
                <th>Teléfono</th>
                <th>Email</th>
                <th class="text-center">Pedidos</th>
                <th class="text-center">Saldo por cobrar</th>
                <th class="text-center">Estado</th>
                <th class="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              @for (item of items(); track item.id) {
                <tr>
                  <td class="font-medium text-slate-900">{{ item.name }}</td>
                  <td class="font-mono text-xs text-slate-500">{{ item.docNumber || '—' }}</td>
                  <td class="text-slate-500">{{ item.phone || '—' }}</td>
                  <td class="text-slate-500">{{ item.email || '—' }}</td>
                  <td class="text-center">{{ item._count?.orders ?? 0 }}</td>
                  <td class="text-center">
                    @if ((item._count?.receivables ?? 0) > 0) {
                      <span class="badge bg-amber-100 text-amber-700">
                        {{ item._count?.receivables }}
                      </span>
                    } @else {
                      <span class="text-slate-400">0</span>
                    }
                  </td>
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
      [title]="editing() ? 'Editar cliente' : 'Nuevo cliente'"
      subtitle="Datos de contacto y facturación del cliente"
      size="lg"
      (closed)="closeModal()"
    >
      <form class="space-y-4" (ngSubmit)="save()" #customerForm="ngForm">
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label class="label" for="cus-name">Nombre *</label>
            <input
              id="cus-name"
              name="name"
              class="input"
              required
              minlength="2"
              [(ngModel)]="form.name"
              placeholder="Ej. María Fernández"
            />
          </div>
          <div>
            <label class="label" for="cus-doc">Documento (DNI/RUC)</label>
            <input
              id="cus-doc"
              name="docNumber"
              class="input"
              [(ngModel)]="form.docNumber"
              placeholder="Ej. 70123456"
            />
          </div>
          <div>
            <label class="label" for="cus-phone">Teléfono</label>
            <input
              id="cus-phone"
              name="phone"
              type="tel"
              class="input"
              [(ngModel)]="form.phone"
              placeholder="Ej. 987 654 321"
            />
          </div>
          <div>
            <label class="label" for="cus-email">Email</label>
            <input
              id="cus-email"
              name="email"
              type="email"
              class="input"
              [(ngModel)]="form.email"
              placeholder="cliente@correo.com"
            />
          </div>
          <div class="sm:col-span-2">
            <label class="label" for="cus-address">Dirección</label>
            <input
              id="cus-address"
              name="address"
              class="input"
              [(ngModel)]="form.address"
              placeholder="Av. Los Álamos 456, Lima"
            />
          </div>
          <div class="sm:col-span-2">
            <label class="label" for="cus-notes">Notas</label>
            <textarea
              id="cus-notes"
              name="notes"
              class="input"
              rows="3"
              [(ngModel)]="form.notes"
              placeholder="Preferencias, referencias de entrega, etc."
            ></textarea>
          </div>
        </div>

        <label class="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" name="active" class="h-4 w-4" [(ngModel)]="form.active" />
          Cliente activo
        </label>

        <div modalFooter class="flex w-full justify-end gap-2">
          <button type="button" class="btn-secondary" (click)="closeModal()">Cancelar</button>
          <button type="submit" class="btn-primary" [disabled]="saving() || customerForm.invalid">
            {{ saving() ? 'Guardando…' : 'Guardar' }}
          </button>
        </div>
      </form>
    </app-modal>
`,
})
export class CustomersPage implements OnInit {
  readonly auth = inject(AuthService);
  private readonly customers = inject(CustomersService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  readonly items = signal<Customer[]>([]);
  readonly meta = signal<PaginationMeta>(EMPTY_META);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly modalOpen = signal(false);
  readonly editing = signal<Customer | null>(null);

  search = '';
  private page = 1;
  private limit = 20;

  form: CustomerForm = this.emptyForm();

  ngOnInit(): void {
    this.load();
  }

  private emptyForm(): CustomerForm {
    return {
      name: '',
      docNumber: '',
      phone: '',
      email: '',
      address: '',
      notes: '',
      active: true,
    };
  }

  load(): void {
    this.loading.set(true);
    this.customers
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

  openEdit(item: Customer): void {
    this.editing.set(item);
    this.form = {
      name: item.name,
      docNumber: item.docNumber ?? '',
      phone: item.phone ?? '',
      email: item.email ?? '',
      address: item.address ?? '',
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
    const payload: CustomerPayload = {
      name: this.form.name.trim(),
      docNumber: this.form.docNumber.trim() || undefined,
      phone: this.form.phone.trim() || undefined,
      email: this.form.email.trim() || undefined,
      address: this.form.address.trim() || undefined,
      notes: this.form.notes.trim() || undefined,
      active: this.form.active,
    };

    const request = current
      ? this.customers.update(current.id, payload)
      : this.customers.create(payload);

    request.subscribe({
      next: () => {
        this.saving.set(false);
        this.closeModal();
        this.toast.success(current ? 'Cliente actualizado' : 'Cliente creado');
        this.load();
      },
      error: () => this.saving.set(false),
    });
  }

  async remove(item: Customer): Promise<void> {
    const confirmed = await this.confirm.ask({
      title: 'Desactivar cliente',
      message: `¿Desactivar "${item.name}"? El cliente dejará de estar disponible para nuevas ventas.`,
      confirmLabel: 'Eliminar',
      tone: 'danger',
    });
    if (!confirmed) return;

    this.customers.remove(item.id).subscribe({
      next: () => {
        this.toast.success('Cliente desactivado');
        this.load();
      },
    });
  }
}
