import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { PaginationMeta, Supplier } from '../../core/models/api.model';
import type { Expense, ExpenseCategory, ExpenseSummary } from '../../core/models/finance.model';
import type { PaymentMethod } from '../../core/models/operations.model';
import {
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_CATEGORY_OPTIONS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHOD_OPTIONS,
  startOfMonthIso,
  todayIso,
} from '../../core/constants/domain';
import { BASE_CURRENCY } from '../../core/constants/currency';
import { AuthService } from '../../core/services/auth.service';
import { CashService } from '../../core/services/cash.service';
import { SuppliersService } from '../../core/services/catalog.service';
import { ExpensesService } from '../../core/services/finance.service';
import { ToastService } from '../../core/services/toast.service';
import {
  apiErrorMessage,
  displayBaseCode,
  money,
  moneyIn,
  number,
  shortDate,
  toDateInput,
} from '../../core/utils/format';
import { EmptyStateComponent, LoaderComponent } from '../../shared/components/feedback.component';
import { IconComponent } from '../../shared/components/icon.component';
import { ModalComponent } from '../../shared/components/modal.component';
import { CurrencySelectComponent } from '../../shared/components/currency-select.component';
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

const CATEGORY_TONES: Record<string, string> = {
  OPERATIVO: 'bg-brand-50 text-brand-700',
  SERVICIOS: 'bg-sky-100 text-sky-700',
  SUELDOS: 'bg-indigo-100 text-indigo-700',
  COMPRAS: 'bg-amber-100 text-amber-700',
  MANTENIMIENTO: 'bg-teal-100 text-teal-700',
  IMPUESTOS: 'bg-rose-100 text-rose-700',
  OTROS: 'bg-slate-100 text-slate-600',
};

/** Gastos operativos: resumen, filtros, listado y formulario. */
@Component({
  selector: 'app-expenses',
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
  templateUrl: './expenses.page.html',

})
export class ExpensesPage implements OnInit {
  readonly auth = inject(AuthService);
  private readonly expenses = inject(ExpensesService);
  private readonly suppliers = inject(SuppliersService);
  private readonly cash = inject(CashService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  readonly categoryOptions = EXPENSE_CATEGORY_OPTIONS;
  readonly methodOptions = PAYMENT_METHOD_OPTIONS;
  readonly categoryLabels = EXPENSE_CATEGORY_LABELS;
  readonly methodLabels = PAYMENT_METHOD_LABELS;
  readonly money = money;
  /** Código de la moneda base con la que se muestran los montos (USD por defecto). */
  readonly moneyBaseCode = displayBaseCode;
  readonly number = number;
  readonly shortDate = shortDate;
  readonly baseCurrency = BASE_CURRENCY;

  readonly items = signal<Expense[]>([]);
  readonly meta = signal<PaginationMeta>(EMPTY_META);
  readonly summary = signal<ExpenseSummary | null>(null);
  readonly supplierList = signal<Supplier[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly modalOpen = signal(false);
  readonly editing = signal<Expense | null>(null);
  readonly cashOpen = signal(false);

  readonly topCategory = computed(() => this.summary()?.byCategory[0] ?? null);
  readonly topCategoryLabel = computed(() => {
    const top = this.topCategory();
    return top ? this.categoryLabels[top.category] ?? top.category : 'Sin datos';
  });

  filters = {
    category: '',
    paymentMethod: '',
    supplierId: '',
    from: startOfMonthIso(),
    to: todayIso(),
    search: '',
  };

  form = {
    category: 'OPERATIVO' as ExpenseCategory,
    description: '',
    amount: 0,
    currency: BASE_CURRENCY.code as string,
    date: todayIso(),
    paymentMethod: 'CASH' as PaymentMethod,
    supplierId: '',
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
    this.expenses
      .summary({ from: this.filters.from || undefined, to: this.filters.to || undefined })
      .subscribe({
        next: (data) => this.summary.set(data),
        error: () => this.summary.set(null),
      });
  }

  load(): void {
    this.loading.set(true);
    this.expenses
      .list({
        page: this.page,
        limit: this.limit,
        category: this.filters.category || undefined,
        paymentMethod: this.filters.paymentMethod || undefined,
        supplierId: this.filters.supplierId || undefined,
        from: this.filters.from || undefined,
        to: this.filters.to || undefined,
        search: this.filters.search.trim() || undefined,
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

  applyPreset(kind: 'current' | 'previous'): void {
    if (kind === 'current') {
      this.filters.from = startOfMonthIso();
      this.filters.to = todayIso();
    } else {
      const now = new Date();
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      this.filters.from = toDateInput(first);
      this.filters.to = toDateInput(last);
    }
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

  categoryTone(category: string): string {
    return CATEGORY_TONES[category] ?? 'bg-slate-100 text-slate-600';
  }

  share(value: number, total: number): number {
    return total > 0 ? Math.max(2, Math.round((value / total) * 100)) : 0;
  }

  /** Formatea un monto en la moneda en la que se pago el gasto. */
  amountIn(value: number | null | undefined, currency?: string | null): string {
    return moneyIn(value, currency);
  }

  openCreate(): void {
    this.editing.set(null);
    this.form = {
      category: 'OPERATIVO',
      description: '',
      amount: 0,
      currency: BASE_CURRENCY.code,
      date: todayIso(),
      paymentMethod: 'CASH',
      supplierId: '',
      payFromCash: true,
    };
    this.modalOpen.set(true);
  }

  openEdit(item: Expense): void {
    this.editing.set(item);
    this.form = {
      category: item.category,
      description: item.description,
      amount: item.amount,
      currency: item.currency || BASE_CURRENCY.code,
      date: toDateInput(item.date),
      paymentMethod: item.paymentMethod,
      supplierId: item.supplier?.id ?? item.supplierId ?? '',
      payFromCash: false,
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
    const isCash = this.form.paymentMethod === 'CASH';
    const payload = {
      category: this.form.category,
      description: this.form.description.trim(),
      amount: Number(this.form.amount),
      currency: this.form.currency || undefined,
      date: this.form.date || undefined,
      paymentMethod: this.form.paymentMethod,
      supplierId: this.form.supplierId || null,
    };
    const request = current
      ? this.expenses.update(current.id, payload)
      : this.expenses.create({
          ...payload,
          payFromCash: isCash ? this.form.payFromCash : undefined,
        });
    request.subscribe({
      next: () => {
        this.saving.set(false);
        this.closeModal();
        this.toast.success(current ? 'Gasto actualizado' : 'Gasto registrado');
        this.loadSummary();
        this.load();
      },
      error: (error) => {
        this.saving.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  async remove(item: Expense): Promise<void> {
    const confirmed = await this.confirm.ask({
      title: 'Eliminar gasto',
      message: `¿Eliminar "${item.description}" por ${moneyIn(item.amount, item.currency)}?`,
      confirmLabel: 'Eliminar',
      tone: 'danger',
    });
    if (!confirmed) return;
    this.expenses.remove(item.id).subscribe({
      next: () => {
        this.toast.success('Gasto eliminado');
        this.loadSummary();
        this.load();
      },
      error: (error) => this.toast.error(apiErrorMessage(error)),
    });
  }
}
