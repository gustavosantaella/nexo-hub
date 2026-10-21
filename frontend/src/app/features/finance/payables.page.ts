import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { PaginationMeta, Supplier } from '../../core/models/api.model';
import type { AccountSummary, Payable } from '../../core/models/finance.model';
import type { PaymentMethod } from '../../core/models/operations.model';
import {
  ACCOUNT_STATUS_CLASSES,
  ACCOUNT_STATUS_LABELS,
  ACCOUNT_STATUS_OPTIONS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHOD_OPTIONS,
} from '../../core/constants/domain';
import { BASE_CURRENCY } from '../../core/constants/currency';
import { AuthService } from '../../core/services/auth.service';
import { CashService } from '../../core/services/cash.service';
import { SuppliersService } from '../../core/services/catalog.service';
import { PayablesService } from '../../core/services/finance.service';
import { ToastService } from '../../core/services/toast.service';
import {
  apiErrorMessage,
  displayBaseCode,
  moneyIn,
  number,
  shortDate,
  toDateInput,
} from '../../core/utils/format';
import { CurrencySelectComponent } from '../../shared/components/currency-select.component';
import { EmptyStateComponent, LoaderComponent } from '../../shared/components/feedback.component';
import { IconComponent } from '../../shared/components/icon.component';
import { ModalComponent } from '../../shared/components/modal.component';
import { MoneyComponent } from '../../shared/components/money.component';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { PaginationComponent } from '../../shared/components/pagination.component';
import { StatCardComponent } from '../../shared/components/stat-card.component';
import { ConfirmService } from '../../shared/services/confirm.service';

const EMPTY_META: PaginationMeta = {
  total: 0,
  page: 1,
  limit: 20,
  totalPages: 0,
  hasNextPage: false,
  hasPreviousPage: false,
};

/** Cuentas por pagar a proveedores: resumen, filtros, listado y abonos. */
@Component({
  selector: 'app-payables',
  standalone: true,
  imports: [
    FormsModule,
    IconComponent,
    PageHeaderComponent,
    PaginationComponent,
    ModalComponent,
    EmptyStateComponent,
    LoaderComponent,
    StatCardComponent,
    MoneyComponent,
    CurrencySelectComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './payables.page.html',
})
export class PayablesPage implements OnInit {
  readonly auth = inject(AuthService);
  private readonly payables = inject(PayablesService);
  private readonly suppliers = inject(SuppliersService);
  private readonly cash = inject(CashService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  readonly statusOptions = ACCOUNT_STATUS_OPTIONS;
  readonly statusLabels = ACCOUNT_STATUS_LABELS;
  readonly statusClasses = ACCOUNT_STATUS_CLASSES;
  readonly methodOptions = PAYMENT_METHOD_OPTIONS;
  readonly methodLabels = PAYMENT_METHOD_LABELS;
  readonly number = number;
  readonly shortDate = shortDate;
  readonly baseCurrency = BASE_CURRENCY;
  /** Código de la moneda base con la que se muestran los montos (USD por defecto). */
  readonly moneyBaseCode = displayBaseCode;

  /** Formatea un monto en la moneda en la que se registro el abono. */
  amountIn(value: number | null | undefined, currency?: string | null): string {
    return moneyIn(value, currency);
  }

  readonly items = signal<Payable[]>([]);
  readonly meta = signal<PaginationMeta>(EMPTY_META);
  readonly summary = signal<AccountSummary | null>(null);
  readonly supplierList = signal<Supplier[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly modalOpen = signal(false);
  readonly editing = signal<Payable | null>(null);
  readonly payModalOpen = signal(false);
  readonly paying = signal<Payable | null>(null);
  readonly detailModalOpen = signal(false);
  readonly detail = signal<Payable | null>(null);
  readonly detailLoading = signal(false);
  readonly cashOpen = signal(false);

  filters = {
    status: '',
    supplierId: '',
    search: '',
    from: '',
    to: '',
    overdueOnly: false,
  };

  form = {
    description: '',
    amount: 0,
    currency: BASE_CURRENCY.code as string,
    supplierId: '',
    dueDate: '',
    reference: '',
    notes: '',
  };

  payForm = {
    amount: 0,
    method: 'CASH' as PaymentMethod,
    currency: BASE_CURRENCY.code as string,
    note: '',
    payFromCash: true,
  };

  private page = 1;
  private limit = 20;

  ngOnInit(): void {
    this.loadSuppliers();
    this.loadCash();
    this.loadSummary();
    this.load();
  }

  loadSuppliers(): void {
    this.suppliers.options().subscribe({
      next: (list) => this.supplierList.set(list),
      error: () => this.supplierList.set([]),
    });
  }

  loadCash(): void {
    this.cash.current().subscribe({
      next: (response) => {
        const session =
          response && 'status' in response
            ? response
            : ((response as { session?: { status?: string } | null } | null)?.session ?? null);
        this.cashOpen.set(session?.status === 'OPEN');
      },
      error: () => this.cashOpen.set(false),
    });
  }

  loadSummary(): void {
    this.payables.summary().subscribe({
      next: (data) => this.summary.set(data),
      error: () => this.summary.set(null),
    });
  }

  load(): void {
    this.loading.set(true);
    this.payables
      .list({
        page: this.page,
        limit: this.limit,
        status: this.filters.status || undefined,
        supplierId: this.filters.supplierId || undefined,
        search: this.filters.search.trim() || undefined,
        from: this.filters.from || undefined,
        to: this.filters.to || undefined,
        overdueOnly: this.filters.overdueOnly || undefined,
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

  applyFilters(): void {
    this.page = 1;
    this.loadSummary();
    this.load();
  }

  clearFilters(): void {
    this.filters = { status: '', supplierId: '', search: '', from: '', to: '', overdueOnly: false };
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

  isOverdue(item: Payable): boolean {
    if (!item.dueDate) return false;
    if (item.status !== 'PENDING' && item.status !== 'PARTIAL') return false;
    return new Date(item.dueDate).getTime() < new Date(toDateInput(new Date())).getTime();
  }

  paymentCount(item: Payable): number {
    return item.paymentsCount ?? item.payments?.length ?? 0;
  }

  /** `true` cuando la cuenta ya tiene abonos: monto y moneda quedan bloqueados. */
  lockedMoney(): boolean {
    const current = this.editing();
    return !!current && this.paymentCount(current) > 0;
  }

  openCreate(): void {
    this.editing.set(null);
    this.form = {
      description: '',
      amount: 0,
      currency: BASE_CURRENCY.code,
      supplierId: '',
      dueDate: '',
      reference: '',
      notes: '',
    };
    this.modalOpen.set(true);
  }

  openEdit(item: Payable): void {
    this.editing.set(item);
    this.form = {
      description: item.description,
      amount: item.amount,
      currency: item.currency || BASE_CURRENCY.code,
      supplierId: item.supplier?.id ?? item.supplierId ?? '',
      dueDate: toDateInput(item.dueDate),
      reference: item.reference ?? '',
      notes: item.notes ?? '',
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
    const payload = {
      description: this.form.description.trim(),
      amount: Number(this.form.amount),
      currency: this.form.currency || undefined,
      supplierId: this.form.supplierId || null,
      dueDate: this.form.dueDate || undefined,
      reference: this.form.reference.trim() || undefined,
      notes: this.form.notes.trim() || undefined,
    };
    const request = current
      ? this.payables.update(current.id, payload)
      : this.payables.create(payload);
    request.subscribe({
      next: () => {
        this.saving.set(false);
        this.closeModal();
        this.toast.success(current ? 'Cuenta actualizada' : 'Cuenta registrada');
        this.loadSummary();
        this.load();
      },
      error: (error) => {
        this.saving.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  openPay(item: Payable): void {
    this.paying.set(item);
    this.payForm = {
      amount: item.balance,
      method: 'CASH',
      currency: BASE_CURRENCY.code,
      note: '',
      payFromCash: true,
    };
    this.payModalOpen.set(true);
  }

  closePay(): void {
    this.payModalOpen.set(false);
  }

  submitPay(): void {
    const account = this.paying();
    if (!account || this.saving()) return;
    this.saving.set(true);
    const isCash = this.payForm.method === 'CASH';
    this.payables
      .pay(account.id, {
        amount: Number(this.payForm.amount),
        method: this.payForm.method,
        currency: this.payForm.currency || undefined,
        note: this.payForm.note.trim() || undefined,
        payFromCash: isCash ? this.payForm.payFromCash : undefined,
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.closePay();
          this.toast.success('Abono registrado');
          this.loadSummary();
          this.load();
        },
        error: (error) => {
          this.saving.set(false);
          this.toast.error(apiErrorMessage(error));
        },
      });
  }

  openDetail(item: Payable): void {
    this.detail.set(item);
    this.detailModalOpen.set(true);
    this.detailLoading.set(true);
    this.payables.get(item.id).subscribe({
      next: (data) => {
        this.detail.set(data);
        this.detailLoading.set(false);
      },
      error: () => this.detailLoading.set(false),
    });
  }

  closeDetail(): void {
    this.detailModalOpen.set(false);
    this.detail.set(null);
  }

  async cancel(item: Payable): Promise<void> {
    const confirmed = await this.confirm.ask({
      title: 'Anular cuenta',
      message: `¿Anular "${item.description}"? La cuenta quedará marcada como anulada.`,
      confirmLabel: 'Anular',
      tone: 'danger',
    });
    if (!confirmed) return;
    this.payables.cancel(item.id).subscribe({
      next: () => {
        this.toast.success('Cuenta anulada');
        this.loadSummary();
        this.load();
      },
      error: (error) => this.toast.error(apiErrorMessage(error)),
    });
  }

  async remove(item: Payable): Promise<void> {
    const confirmed = await this.confirm.ask({
      title: 'Eliminar cuenta',
      message: `¿Eliminar "${item.description}"? Esta acción no se puede deshacer.`,
      confirmLabel: 'Eliminar',
      tone: 'danger',
    });
    if (!confirmed) return;
    this.payables.remove(item.id).subscribe({
      next: () => {
        this.toast.success('Cuenta eliminada');
        this.loadSummary();
        this.load();
      },
      error: (error) => this.toast.error(apiErrorMessage(error)),
    });
  }
}
