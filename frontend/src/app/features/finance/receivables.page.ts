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
  template: `    <app-page-header
      title="Cuentas por cobrar"
      subtitle="Controla los saldos pendientes de tus clientes"
      icon="wallet"
    >
      @if (auth.canManage()) {
        <button type="button" class="btn-primary" (click)="openCreate()">
          <app-icon name="plus" size="h-4 w-4" />
          Nueva cuenta
        </button>
      }
    </app-page-header>

    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <app-stat-card label="Saldo por cobrar" [value]="summary()?.openBalance ?? 0" [isCurrency]="true" icon="alert" tone="amber" />
      <app-stat-card label="Total facturado" [value]="summary()?.openAmount ?? 0" [isCurrency]="true" icon="receipt" tone="sky" />
      <app-stat-card label="Cobrado" [value]="summary()?.openPaid ?? 0" [isCurrency]="true" icon="check" tone="emerald" />
      <app-stat-card label="Cuentas abiertas" [value]="number(summary()?.openCount ?? 0)" icon="folder" tone="brand" />
    </div>

    <div class="mt-4 flex flex-wrap gap-2">
      @for (row of summary()?.byStatus ?? []; track row.status) {
        <span class="badge" [class]="statusClasses[row.status]">
          {{ statusLabels[row.status] }} · {{ number(row.count) }} ·
          <app-money class="align-middle text-[11px]" [amount]="row.balance" />
        </span>
      }
    </div>

    <section class="card mt-4">
      <div class="card-header">
        <h2 class="text-sm font-semibold text-slate-800">Filtros</h2>
        <label class="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" class="h-4 w-4" [(ngModel)]="filters.overdueOnly" (change)="applyFilters()" />
          Solo vencidas
        </label>
      </div>
      <div class="card-body grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <div>
          <label class="label" for="r-status">Estado</label>
          <select id="r-status" class="input" [(ngModel)]="filters.status">
            <option value="">Todos</option>
            @for (opt of statusOptions; track opt.value) {
              <option [value]="opt.value">{{ opt.label }}</option>
            }
          </select>
        </div>
        <div>
          <label class="label" for="r-cust">Cliente</label>
          <select id="r-cust" class="input" [(ngModel)]="filters.customerId">
            <option value="">Todos</option>
            @for (cust of customerList(); track cust.id) {
              <option [value]="cust.id">{{ cust.name }}</option>
            }
          </select>
        </div>
        <div>
          <label class="label" for="r-from">Vence desde</label>
          <input id="r-from" type="date" class="input" [(ngModel)]="filters.from" />
        </div>
        <div>
          <label class="label" for="r-to">Vence hasta</label>
          <input id="r-to" type="date" class="input" [(ngModel)]="filters.to" />
        </div>
        <div>
          <label class="label" for="r-search">Buscar</label>
          <input id="r-search" class="input" placeholder="Descripción o referencia…" [(ngModel)]="filters.search" (keyup.enter)="applyFilters()" />
        </div>
      </div>
      <div class="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
        <button type="button" class="btn-secondary btn-sm" (click)="clearFilters()">Limpiar</button>
        <button type="button" class="btn-primary btn-sm" (click)="applyFilters()">
          <app-icon name="filter" size="h-4 w-4" />
          Aplicar filtros
        </button>
      </div>
    </section>
    <section class="card mt-4">
      <div class="card-header">
        <h2 class="text-sm font-semibold text-slate-800">Cuentas registradas</h2>
        <span class="text-xs text-slate-500">{{ number(meta().total) }} registros</span>
      </div>
      @if (loading()) {
        <app-loader />
      } @else if (items().length === 0) {
        <app-empty-state title="Sin cuentas por cobrar" message="Ajusta los filtros o registra una nueva cuenta." icon="wallet" />
      } @else {
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Descripción</th>
                <th>Cliente</th>
                <th>Referencia</th>
                <th>Moneda</th>
                <th class="text-right">Monto</th>
                <th class="text-right">Equivalente ({{ baseCurrency.code }})</th>
                <th class="text-right">Cobrado</th>
                <th class="text-right">Saldo</th>
                <th>Vencimiento</th>
                <th>Estado</th>
                <th class="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              @for (item of items(); track item.id) {
                <tr>
                  <td class="max-w-xs truncate font-medium text-slate-900">{{ item.description }}</td>
                  <td class="text-slate-500">{{ item.customer?.name || '—' }}</td>
                  <td class="text-slate-500">{{ item.reference || '—' }}</td>
                  <td>
                    <span class="badge bg-slate-100 text-slate-700">
                      {{ item.currency || baseCurrency.code }}
                    </span>
                  </td>
                  <td class="text-right font-medium">{{ amountIn(item.amount, item.currency) }}</td>
                  <td class="text-right"><app-money [amount]="item.baseAmount" alignEnd="true" /></td>
                  <td class="text-right text-emerald-700"><app-money [amount]="item.paidAmount" alignEnd="true" /></td>
                  <td class="text-right font-medium"><app-money [amount]="item.balance" alignEnd="true" /></td>
                  <td [class]="isOverdue(item) ? 'font-semibold text-rose-600' : 'text-slate-600'">
                    {{ item.dueDate ? shortDate(item.dueDate) : '—' }}
                  </td>
                  <td>
                    <span class="badge" [class]="statusClasses[item.status]">{{ statusLabels[item.status] }}</span>
                  </td>
                  <td>
                    <div class="flex justify-end gap-1">
                      @if (item.status !== 'CANCELLED' && item.status !== 'PAID') {
                        <button type="button" class="btn-secondary btn-sm" (click)="openCollect(item)" title="Cobrar">
                          <app-icon name="money" size="h-4 w-4" />
                          Cobrar
                        </button>
                      }
                      <button type="button" class="btn-ghost btn-sm" (click)="openDetail(item)" title="Ver detalle">
                        <app-icon name="info" size="h-4 w-4" />
                      </button>
                      @if (auth.canManage()) {
                        <button type="button" class="btn-ghost btn-sm" (click)="openEdit(item)" title="Editar">
                          <app-icon name="edit" size="h-4 w-4" />
                        </button>
                        @if (item.paidAmount === 0 && item.status !== 'CANCELLED') {
                          <button type="button" class="btn-ghost btn-sm text-amber-600" (click)="cancel(item)" title="Anular">
                            <app-icon name="close" size="h-4 w-4" />
                          </button>
                        }
                      }
                      @if (auth.isAdmin() && paymentCount(item) === 0) {
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
      [title]="editing() ? 'Editar cuenta' : 'Nueva cuenta por cobrar'"
      subtitle="Registra un saldo pendiente de un cliente"
      (closed)="closeModal()"
    >
      <form class="space-y-4" (ngSubmit)="save()" #accountForm="ngForm">
        <div>
          <label class="label" for="c-desc">Descripción *</label>
          <input id="c-desc" name="description" class="input" required minlength="2" [(ngModel)]="form.description" placeholder="Ej. Consumo a crédito" />
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="label" for="c-amount">Monto *</label>
            <input id="c-amount" name="amount" type="number" class="input" required min="0.01" step="0.01" [readonly]="lockedMoney()" [(ngModel)]="form.amount" />
          </div>
          <app-currency-select
            id="c-currency"
            label="Moneda"
            [(value)]="form.currency"
            [amount]="form.amount"
            [disabled]="lockedMoney()"
          />
        </div>
        <div>
          <label class="label" for="c-due">Vencimiento</label>
          <input id="c-due" name="dueDate" type="date" class="input" [(ngModel)]="form.dueDate" />
        </div>
        <div>
          <label class="label" for="c-cust">Cliente</label>
          <select id="c-cust" name="customerId" class="input" [(ngModel)]="form.customerId">
            <option value="">Sin cliente</option>
            @for (cust of customerList(); track cust.id) {
              <option [value]="cust.id">{{ cust.name }}</option>
            }
          </select>
        </div>
        <div>
          <label class="label" for="c-ref">Referencia</label>
          <input id="c-ref" name="reference" class="input" [(ngModel)]="form.reference" placeholder="N° de comprobante" />
        </div>
        <div>
          <label class="label" for="c-notes">Notas</label>
          <textarea id="c-notes" name="notes" class="input" rows="2" [(ngModel)]="form.notes"></textarea>
        </div>
        @if (editing() && paymentCount(editing()!) > 0) {
          <p class="text-xs text-slate-500">El monto y la moneda solo pueden modificarse mientras la cuenta no tenga cobros registrados.</p>
        }
        <div modalFooter class="flex w-full justify-end gap-2">
          <button type="button" class="btn-secondary" (click)="closeModal()">Cancelar</button>
          <button type="submit" class="btn-primary" [disabled]="saving() || accountForm.invalid">
            {{ saving() ? 'Guardando…' : 'Guardar' }}
          </button>
        </div>
      </form>
    </app-modal>

    <app-modal
      [open]="collectModalOpen()"
      title="Registrar cobro"
      [subtitle]="collecting()?.description ?? ''"
      size="sm"
      (closed)="closeCollect()"
    >
      <form class="space-y-4" (ngSubmit)="submitCollect()" #collectForm="ngForm">
        <div class="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <span class="text-slate-500">Saldo pendiente</span>
          <span class="font-semibold text-slate-800"><app-money [amount]="collecting()?.balance ?? 0" [strong]="true" alignEnd="true" /></span>
        </div>
        <div>
          <label class="label" for="col-amount">Monto a cobrar *</label>
          <input id="col-amount" name="amount" type="number" class="input" required min="0.01" step="0.01" [(ngModel)]="payForm.amount" />
        </div>
        <div>
          <label class="label" for="col-method">Método de pago</label>
          <select id="col-method" name="method" class="input" [(ngModel)]="payForm.method">
            @for (opt of methodOptions; track opt.value) {
              <option [value]="opt.value">{{ opt.label }}</option>
            }
          </select>
        </div>
        <app-currency-select
          id="col-currency"
          label="Moneda del cobro"
          [(value)]="payForm.currency"
          [amount]="payForm.amount"
        />
        <div>
          <label class="label" for="col-note">Nota</label>
          <input id="col-note" name="note" class="input" [(ngModel)]="payForm.note" placeholder="Opcional" />
        </div>
        @if (payForm.method === 'CASH') {
          <div class="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <label class="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input type="checkbox" name="depositToCash" class="h-4 w-4" [(ngModel)]="payForm.depositToCash" />
              Depositar en caja
            </label>
            @if (payForm.depositToCash && !cashOpen()) {
              <p class="mt-2 flex items-center gap-1 text-xs font-medium text-amber-600">
                <app-icon name="alert" size="h-4 w-4" />
                No hay una caja abierta: abre una caja o elige otro método de pago.
              </p>
            }
          </div>
        }
        <div modalFooter class="flex w-full justify-end gap-2">
          <button type="button" class="btn-secondary" (click)="closeCollect()">Cancelar</button>
          <button type="submit" class="btn-primary" [disabled]="saving() || collectForm.invalid">
            {{ saving() ? 'Registrando…' : 'Registrar cobro' }}
          </button>
        </div>
      </form>
    </app-modal>
    <app-modal
      [open]="detailModalOpen()"
      title="Detalle de cuenta"
      [subtitle]="detail()?.description ?? ''"
      size="lg"
      (closed)="closeDetail()"
    >
      @if (detail(); as acc) {
        <div class="space-y-4">
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            <div class="rounded-lg bg-slate-50 p-3">
              <p class="text-xs text-slate-500">Monto ({{ acc.currency || baseCurrency.code }})</p>
              <p class="text-sm font-semibold text-slate-800">{{ amountIn(acc.amount, acc.currency) }}</p>
            </div>
            <div class="rounded-lg bg-slate-50 p-3">
              <p class="text-xs text-slate-500">Equivalente ({{ baseCurrency.code }})</p>
              <p class="text-sm font-semibold text-slate-800"><app-money [amount]="acc.baseAmount" /></p>
            </div>
            <div class="rounded-lg bg-slate-50 p-3">
              <p class="text-xs text-slate-500">Cobrado</p>
              <p class="text-sm font-semibold text-emerald-700"><app-money [amount]="acc.paidAmount" /></p>
            </div>
            <div class="rounded-lg bg-slate-50 p-3">
              <p class="text-xs text-slate-500">Saldo</p>
              <p class="text-sm font-semibold text-slate-800"><app-money [amount]="acc.balance" /></p>
            </div>
            <div class="rounded-lg bg-slate-50 p-3">
              <p class="text-xs text-slate-500">Estado</p>
              <span class="badge mt-1" [class]="statusClasses[acc.status]">{{ statusLabels[acc.status] }}</span>
            </div>
          </div>

          <dl class="grid gap-2 text-sm sm:grid-cols-2">
            <div class="flex justify-between">
              <dt class="text-slate-500">Cliente</dt>
              <dd class="font-medium">{{ acc.customer?.name || '—' }}</dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-slate-500">Referencia</dt>
              <dd class="font-medium">{{ acc.reference || '—' }}</dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-slate-500">Vencimiento</dt>
              <dd class="font-medium">{{ acc.dueDate ? shortDate(acc.dueDate) : '—' }}</dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-slate-500">Creada</dt>
              <dd class="font-medium">{{ shortDate(acc.createdAt) }}</dd>
            </div>
          </dl>

          @if (acc.notes) {
            <p class="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{{ acc.notes }}</p>
          }

          <div>
            <h3 class="mb-2 text-sm font-semibold text-slate-800">Cobros registrados</h3>
            @if (detailLoading()) {
              <app-loader />
            } @else if ((acc.payments?.length ?? 0) === 0) {
              <p class="text-sm text-slate-500">Aún no hay cobros registrados.</p>
            } @else {
              <div class="table-wrap">
                <table class="table">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Método</th>
                      <th>Moneda</th>
                      <th class="text-right">Monto</th>
                      <th class="text-right">Equivalente ({{ baseCurrency.code }})</th>
                      <th>Registrado por</th>
                      <th>Nota</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (p of acc.payments ?? []; track p.id) {
                      <tr>
                        <td>{{ shortDate(p.createdAt) }}</td>
                        <td>{{ methodLabels[p.method] }}</td>
                        <td>
                          <span class="badge bg-slate-100 text-slate-700">
                            {{ p.currency || baseCurrency.code }}
                          </span>
                        </td>
                        <td class="text-right font-medium">
                          {{ amountIn(p.amount, p.currency) }}
                        </td>
                        <td class="text-right">
                          <app-money [amount]="p.baseAmount" alignEnd="true" />
                        </td>
                        <td class="text-slate-500">{{ p.createdBy?.name || '—' }}</td>
                        <td class="text-slate-500">{{ p.note || '—' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </div>
        </div>
      } @else {
        <app-loader />
      }
      <div modalFooter class="flex w-full justify-end">
        <button type="button" class="btn-secondary" (click)="closeDetail()">Cerrar</button>
      </div>
    </app-modal>
  `,
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
