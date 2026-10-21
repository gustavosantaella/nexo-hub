import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Customer, PaginationMeta } from '../../core/models/api.model';
import type { AccountSummary, Receivable } from '../../core/models/finance.model';
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
import { CustomersService } from '../../core/services/catalog.service';
import { ReceivablesService } from '../../core/services/finance.service';
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

/** Cuentas por cobrar a clientes: resumen, filtros, listado y cobros. */
@Component({
  selector: 'app-receivables',
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
  templateUrl: './receivables.page.html',
})
export class ReceivablesPage implements OnInit {
  readonly auth = inject(AuthService);
  private readonly receivables = inject(ReceivablesService);
  private readonly customers = inject(CustomersService);
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

  /** Formatea un monto en la moneda en la que se registro el cobro. */
  amountIn(value: number | null | undefined, currency?: string | null): string {
    return moneyIn(value, currency);
  }

  readonly items = signal<Receivable[]>([]);
  readonly meta = signal<PaginationMeta>(EMPTY_META);
  readonly summary = signal<AccountSummary | null>(null);
  readonly customerList = signal<Customer[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly modalOpen = signal(false);
  readonly editing = signal<Receivable | null>(null);
  readonly collectModalOpen = signal(false);
  readonly collecting = signal<Receivable | null>(null);
  readonly detailModalOpen = signal(false);
  readonly detail = signal<Receivable | null>(null);
  readonly detailLoading = signal(false);
  readonly cashOpen = signal(false);

  filters = {
    status: '',
    customerId: '',
    search: '',
    from: '',
    to: '',
    overdueOnly: false,
  };

  form = {
    description: '',
    amount: 0,
    currency: BASE_CURRENCY.code as string,
    customerId: '',
    dueDate: '',
    reference: '',
    notes: '',
  };

  payForm = {
    amount: 0,
    method: 'CASH' as PaymentMethod,
    currency: BASE_CURRENCY.code as string,
    note: '',
    depositToCash: true,
  };

  private page = 1;
  private limit = 20;

  ngOnInit(): void {
    this.loadCustomers();
    this.loadCash();
    this.loadSummary();
    this.load();
  }

  loadCustomers(): void {
    this.customers.options().subscribe({
      next: (list) => this.customerList.set(list),
      error: () => this.customerList.set([]),
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
    this.receivables.summary().subscribe({
      next: (data) => this.summary.set(data),
      error: () => this.summary.set(null),
    });
  }

  load(): void {
    this.loading.set(true);
    this.receivables
      .list({
        page: this.page,
        limit: this.limit,
        status: this.filters.status || undefined,
        customerId: this.filters.customerId || undefined,
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
    this.filters = { status: '', customerId: '', search: '', from: '', to: '', overdueOnly: false };
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

  isOverdue(item: Receivable): boolean {
    if (!item.dueDate) return false;
    if (item.status !== 'PENDING' && item.status !== 'PARTIAL') return false;
    return new Date(item.dueDate).getTime() < new Date(toDateInput(new Date())).getTime();
  }

  paymentCount(item: Receivable): number {
    return item.paymentsCount ?? item.payments?.length ?? 0;
  }

  /** `true` cuando la cuenta ya tiene cobros: monto y moneda quedan bloqueados. */
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
      customerId: '',
      dueDate: '',
      reference: '',
      notes: '',
    };
    this.modalOpen.set(true);
  }

  openEdit(item: Receivable): void {
    this.editing.set(item);
    this.form = {
      description: item.description,
      amount: item.amount,
      currency: item.currency || BASE_CURRENCY.code,
      customerId: item.customer?.id ?? item.customerId ?? '',
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
      customerId: this.form.customerId || null,
      dueDate: this.form.dueDate || undefined,
      reference: this.form.reference.trim() || undefined,
      notes: this.form.notes.trim() || undefined,
    };
    const request = current
      ? this.receivables.update(current.id, payload)
      : this.receivables.create(payload);
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

  openCollect(item: Receivable): void {
    this.collecting.set(item);
    this.payForm = {
      amount: item.balance,
      method: 'CASH',
      currency: BASE_CURRENCY.code,
      note: '',
      depositToCash: true,
    };
    this.collectModalOpen.set(true);
  }

  closeCollect(): void {
    this.collectModalOpen.set(false);
  }

  submitCollect(): void {
    const account = this.collecting();
    if (!account || this.saving()) return;
    this.saving.set(true);
    const isCash = this.payForm.method === 'CASH';
    this.receivables
      .collect(account.id, {
        amount: Number(this.payForm.amount),
        method: this.payForm.method,
        currency: this.payForm.currency || undefined,
        note: this.payForm.note.trim() || undefined,
        depositToCash: isCash ? this.payForm.depositToCash : undefined,
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.closeCollect();
          this.toast.success('Cobro registrado');
          this.loadSummary();
          this.load();
        },
        error: (error) => {
          this.saving.set(false);
          this.toast.error(apiErrorMessage(error));
        },
      });
  }

  openDetail(item: Receivable): void {
    this.detail.set(item);
    this.detailModalOpen.set(true);
    this.detailLoading.set(true);
    this.receivables.get(item.id).subscribe({
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

  async cancel(item: Receivable): Promise<void> {
    const confirmed = await this.confirm.ask({
      title: 'Anular cuenta',
      message: `¿Anular "${item.description}"? La cuenta quedará marcada como anulada.`,
      confirmLabel: 'Anular',
      tone: 'danger',
    });
    if (!confirmed) return;
    this.receivables.cancel(item.id).subscribe({
      next: () => {
        this.toast.success('Cuenta anulada');
        this.loadSummary();
        this.load();
      },
      error: (error) => this.toast.error(apiErrorMessage(error)),
    });
  }

  async remove(item: Receivable): Promise<void> {
    const confirmed = await this.confirm.ask({
      title: 'Eliminar cuenta',
      message: `¿Eliminar "${item.description}"? Esta acción no se puede deshacer.`,
      confirmLabel: 'Eliminar',
      tone: 'danger',
    });
    if (!confirmed) return;
    this.receivables.remove(item.id).subscribe({
      next: () => {
        this.toast.success('Cuenta eliminada');
        this.loadSummary();
        this.load();
      },
      error: (error) => this.toast.error(apiErrorMessage(error)),
    });
  }
}
