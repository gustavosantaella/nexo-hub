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
  templateUrl: './suppliers.page.html',
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
