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
  template: `    <app-page-header
      title="Gastos"
      subtitle="Registra y controla los gastos operativos del negocio"
      icon="money"
    >
      <button type="button" class="btn-primary" (click)="openCreate()">
        <app-icon name="plus" size="h-4 w-4" />
        Nuevo gasto
      </button>
    </app-page-header>

    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <app-stat-card label="Total gastado" [value]="summary()?.total ?? 0" [isCurrency]="true" icon="money" tone="rose" />
      <app-stat-card label="Cantidad de gastos" [value]="number(summary()?.count ?? 0)" icon="receipt" tone="sky" />
      <app-stat-card
        label="Mayor rubro"
        [value]="topCategoryLabel()"
        [hint]="topCategory() ? money(topCategory()!.amount) + ' · ' + number(topCategory()!.count) + ' gastos' : 'Sin datos en el rango'"
        icon="chart"
        tone="amber"
      />
    </div>

    <section class="card mt-4">
      <div class="card-header">
        <h2 class="text-sm font-semibold text-slate-800">Filtros</h2>
        <div class="flex items-center gap-2">
          <button type="button" class="btn-secondary btn-sm" (click)="applyPreset('current')">Este mes</button>
          <button type="button" class="btn-secondary btn-sm" (click)="applyPreset('previous')">Mes anterior</button>
        </div>
      </div>
      <div class="card-body grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <div>
          <label class="label" for="f-cat">Categoría</label>
          <select id="f-cat" class="input" [(ngModel)]="filters.category">
            <option value="">Todas</option>
            @for (opt of categoryOptions; track opt.value) {
              <option [value]="opt.value">{{ opt.label }}</option>
            }
          </select>
        </div>
        <div>
          <label class="label" for="f-method">Método</label>
          <select id="f-method" class="input" [(ngModel)]="filters.paymentMethod">
            <option value="">Todos</option>
            @for (opt of methodOptions; track opt.value) {
              <option [value]="opt.value">{{ opt.label }}</option>
            }
          </select>
        </div>
        <div>
          <label class="label" for="f-sup">Proveedor</label>
          <select id="f-sup" class="input" [(ngModel)]="filters.supplierId">
            <option value="">Todos</option>
            @for (sup of supplierList(); track sup.id) {
              <option [value]="sup.id">{{ sup.name }}</option>
            }
          </select>
        </div>
        <div>
          <label class="label" for="f-from">Desde</label>
          <input id="f-from" type="date" class="input" [(ngModel)]="filters.from" />
        </div>
        <div>
          <label class="label" for="f-to">Hasta</label>
          <input id="f-to" type="date" class="input" [(ngModel)]="filters.to" />
        </div>
        <div>
          <label class="label" for="f-search">Buscar</label>
          <input id="f-search" class="input" placeholder="Descripción…" [(ngModel)]="filters.search" (keyup.enter)="applyFilters()" />
        </div>
      </div>
      <div class="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
        <button type="button" class="btn-primary btn-sm" (click)="applyFilters()">
          <app-icon name="filter" size="h-4 w-4" />
          Aplicar filtros
        </button>
      </div>
    </section>

    <div class="mt-4 grid gap-4 lg:grid-cols-2">
      <section class="card">
        <div class="card-header">
          <h2 class="text-sm font-semibold text-slate-800">Por categoría</h2>
          <app-money class="text-xs text-slate-500" [amount]="summary()?.total ?? 0" alignEnd="true" />
        </div>
        <div class="card-body space-y-3">
          @if ((summary()?.byCategory?.length ?? 0) === 0) {
            <p class="text-sm text-slate-500">Sin datos en el rango seleccionado.</p>
          } @else {
            @for (row of summary()!.byCategory; track row.category) {
              <div>
                <div class="flex items-center justify-between text-sm">
                  <span class="font-medium text-slate-700">{{ categoryLabels[row.category] }}</span>
                  <app-money class="text-slate-600" [amount]="row.amount" alignEnd="true" />
                </div>
                <div class="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div class="h-full rounded-full bg-brand-500" [style.width.%]="share(row.amount, summary()!.total)"></div>
                </div>
              </div>
            }
          }
        </div>
      </section>
      <section class="card">
        <div class="card-header">
          <h2 class="text-sm font-semibold text-slate-800">Por método de pago</h2>
        </div>
        <div class="card-body space-y-3">
          @if ((summary()?.byMethod?.length ?? 0) === 0) {
            <p class="text-sm text-slate-500">Sin datos en el rango seleccionado.</p>
          } @else {
            @for (row of summary()!.byMethod; track row.method) {
              <div>
                <div class="flex items-center justify-between text-sm">
                  <span class="font-medium text-slate-700">{{ methodLabels[row.method] }}</span>
                  <app-money class="text-slate-600" [amount]="row.amount" alignEnd="true" />
                </div>
                <div class="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div class="h-full rounded-full bg-emerald-500" [style.width.%]="share(row.amount, summary()!.total)"></div>
                </div>
              </div>
            }
          }
        </div>
      </section>
    </div>
    <section class="card mt-4">
      <div class="card-header">
        <h2 class="text-sm font-semibold text-slate-800">Gastos registrados</h2>
        <span class="text-xs text-slate-500">{{ number(meta().total) }} registros</span>
      </div>
      @if (loading()) {
        <app-loader />
      } @else if (items().length === 0) {
        <app-empty-state title="Sin gastos" message="Ajusta los filtros o registra un nuevo gasto." icon="money" />
      } @else {
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Categoría</th>
                <th>Descripción</th>
                <th>Proveedor</th>
                <th>Método</th>
                <th>Moneda</th>
                <th class="text-right">Monto</th>
                <th class="text-right">Equivalente ({{ baseCurrency.code }})</th>
                <th>Registrado por</th>
                <th class="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              @for (item of items(); track item.id) {
                <tr>
                  <td>{{ shortDate(item.date) }}</td>
                  <td>
                    <span class="badge" [class]="categoryTone(item.category)">{{ categoryLabels[item.category] }}</span>
                  </td>
                  <td class="max-w-xs truncate text-slate-700">{{ item.description }}</td>
                  <td class="text-slate-500">{{ item.supplier?.name || '—' }}</td>
                  <td>{{ methodLabels[item.paymentMethod] }}</td>
                  <td>
                    <span class="badge bg-slate-100 text-slate-700">
                      {{ item.currency || baseCurrency.code }}
                    </span>
                  </td>
                  <td class="text-right font-medium">
                    {{ amountIn(item.amount, item.currency) }}
                  </td>
                  <td class="text-right">
                    <app-money [amount]="item.baseAmount" alignEnd="true" />
                  </td>
                  <td class="text-slate-500">{{ item.createdBy?.name || '—' }}</td>
                  <td>
                    <div class="flex justify-end gap-1">
                      @if (auth.canManage()) {
                        <button type="button" class="btn-ghost btn-sm" (click)="openEdit(item)" title="Editar">
                          <app-icon name="edit" size="h-4 w-4" />
                        </button>
                        <button type="button" class="btn-ghost btn-sm text-rose-600" (click)="remove(item)" title="Eliminar">
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
        <app-pagination [meta]="meta()" (pageChange)="changePage($event)" (limitChange)="changeLimit($event)" />
      }
    </section>

    <app-modal
      [open]="modalOpen()"
      [title]="editing() ? 'Editar gasto' : 'Nuevo gasto'"
      subtitle="Los gastos en efectivo pueden descontarse de la caja abierta"
      (closed)="closeModal()"
    >
      <form class="space-y-4" (ngSubmit)="save()" #expenseForm="ngForm">
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="label" for="exp-cat">Categoría *</label>
            <select id="exp-cat" name="category" class="input" required [(ngModel)]="form.category">
              @for (opt of categoryOptions; track opt.value) {
                <option [value]="opt.value">{{ opt.label }}</option>
              }
            </select>
          </div>
          <div>
            <label class="label" for="exp-method">Método de pago</label>
            <select id="exp-method" name="paymentMethod" class="input" [(ngModel)]="form.paymentMethod">
              @for (opt of methodOptions; track opt.value) {
                <option [value]="opt.value">{{ opt.label }}</option>
              }
            </select>
          </div>
        </div>
        <div>
          <label class="label" for="exp-desc">Descripción *</label>
          <input id="exp-desc" name="description" class="input" required minlength="2" [(ngModel)]="form.description" placeholder="Ej. Compra de insumos" />
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="label" for="exp-amount">Monto *</label>
            <input id="exp-amount" name="amount" type="number" class="input" required min="0.01" step="0.01" [(ngModel)]="form.amount" />
          </div>
          <app-currency-select
            id="exp-currency"
            label="Moneda del pago"
            [(value)]="form.currency"
            [amount]="form.amount"
          />
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="label" for="exp-date">Fecha</label>
            <input id="exp-date" name="date" type="date" class="input" [(ngModel)]="form.date" />
          </div>
        </div>
        <div>
          <label class="label" for="exp-sup">Proveedor</label>
          <select id="exp-sup" name="supplierId" class="input" [(ngModel)]="form.supplierId">
            <option value="">Sin proveedor</option>
            @for (sup of supplierList(); track sup.id) {
              <option [value]="sup.id">{{ sup.name }}</option>
            }
          </select>
        </div>
        @if (form.paymentMethod === 'CASH') {
          <div class="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <label class="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input type="checkbox" name="payFromCash" class="h-4 w-4" [(ngModel)]="form.payFromCash" />
              Pagar desde caja (genera un egreso de efectivo)
            </label>
            @if (form.payFromCash && !cashOpen()) {
              <p class="mt-2 flex items-center gap-1 text-xs font-medium text-amber-600">
                <app-icon name="alert" size="h-4 w-4" />
                No hay una caja abierta: abre una caja para registrar el pago en efectivo o desmarca la opción.
              </p>
            }
          </div>
        }
        <div modalFooter class="flex w-full justify-end gap-2">
          <button type="button" class="btn-secondary" (click)="closeModal()">Cancelar</button>
          <button type="submit" class="btn-primary" [disabled]="saving() || expenseForm.invalid">
            {{ saving() ? 'Guardando…' : 'Guardar' }}
          </button>
        </div>
      </form>
    </app-modal>
  `,

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
