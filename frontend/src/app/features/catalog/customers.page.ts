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
  templateUrl: './customers.page.html',
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
