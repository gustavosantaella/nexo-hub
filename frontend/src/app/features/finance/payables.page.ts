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
  template: `    <app-page-header
      title="Cuentas por pagar"
      subtitle="Controla las deudas pendientes con tus proveedores"
      icon="truck"
    >
      @if (auth.canManage()) {
        <button type="button" class="btn-primary" (click)="openCreate()">
          <app-icon name="plus" size="h-4 w-4" />
          Nueva cuenta
        </button>
      }
    </app-page-header>

    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <app-stat-card label="Saldo pendiente" [value]="summary()?.openBalance ?? 0" [isCurrency]="true" icon="alert" tone="rose" />
      <app-stat-card label="Total facturado" [value]="summary()?.openAmount ?? 0" [isCurrency]="true" icon="receipt" tone="sky" />
      <app-stat-card label="Pagado" [value]="summary()?.openPaid ?? 0" [isCurrency]="true" icon="check" tone="emerald" />
      <app-stat-card label="Cuentas abiertas" [value]="summary()?.openCount ?? 0" icon="folder" tone="amber" />
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
          <label class="label" for="p-status">Estado</label>
          <select id="p-status" class="input" [(ngModel)]="filters.status">
            <option value="">Todos</option>
            @for (opt of statusOptions; track opt.value) {
              <option [value]="opt.value">{{ opt.label }}</option>
            }
          </select>
        </div>
        <div>
          <label class="label" for="p-sup">Proveedor</label>
          <select id="p-sup" class="input" [(ngModel)]="filters.supplierId">
            <option value="">Todos</option>
            @for (sup of supplierList(); track sup.id) {
              <option [value]="sup.id">{{ sup.name }}</option>
            }
          </select>
        </div>
        <div>
          <label class="label" for="p-from">Vence desde</label>
          <input id="p-from" type="date" class="input" [(ngModel)]="filters.from" />
        </div>
        <div>
          <label class="label" for="p-to">Vence hasta</label>
          <input id="p-to" type="date" class="input" [(ngModel)]="filters.to" />
        </div>
        <div>
          <label class="label" for="p-search">Buscar</label>
          <input id="p-search" class="input" placeholder="Descripción o referencia…" [(ngModel)]="filters.search" (keyup.enter)="applyFilters()" />
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
        <app-empty-state title="Sin cuentas por pagar" message="Ajusta los filtros o registra una nueva cuenta." icon="truck" />
      } @else {
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Descripción</th>
                <th>Proveedor</th>
                <th>Referencia</th>
                <th>Moneda</th>
                <th class="text-right">Monto</th>
                <th class="text-right">Equivalente ({{ moneyBaseCode() }})</th>
                <th class="text-right">Pagado</th>
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
                  <td class="text-slate-500">{{ item.supplier?.name || '—' }}</td>
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
                        <button type="button" class="btn-secondary btn-sm" (click)="openPay(item)" title="Abonar">
                          <app-icon name="money" size="h-4 w-4" />
                          Abonar
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
      [title]="editing() ? 'Editar cuenta' : 'Nueva cuenta por pagar'"
      subtitle="Registra una deuda con un proveedor"
      (closed)="closeModal()"
    >
      <form class="space-y-4" (ngSubmit)="save()" #accountForm="ngForm">
        <div>
          <label class="label" for="a-desc">Descripción *</label>
          <input id="a-desc" name="description" class="input" required minlength="2" [(ngModel)]="form.description" placeholder="Ej. Compra de carne" />
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="label" for="a-amount">Monto *</label>
            <input id="a-amount" name="amount" type="number" class="input" required min="0.01" step="0.01" [readonly]="lockedMoney()" [(ngModel)]="form.amount" />
          </div>
          <app-currency-select
            id="a-currency"
            label="Moneda"
            [(value)]="form.currency"
            [amount]="form.amount"
            [disabled]="lockedMoney()"
          />
        </div>
        <div>
          <label class="label" for="a-due">Vencimiento</label>
          <input id="a-due" name="dueDate" type="date" class="input" [(ngModel)]="form.dueDate" />
        </div>
        <div>
          <label class="label" for="a-sup">Proveedor</label>
          <select id="a-sup" name="supplierId" class="input" [(ngModel)]="form.supplierId">
            <option value="">Sin proveedor</option>
            @for (sup of supplierList(); track sup.id) {
              <option [value]="sup.id">{{ sup.name }}</option>
            }
          </select>
        </div>
        <div>
          <label class="label" for="a-ref">Referencia</label>
          <input id="a-ref" name="reference" class="input" [(ngModel)]="form.reference" placeholder="N° de factura o comprobante" />
        </div>
        <div>
          <label class="label" for="a-notes">Notas</label>
          <textarea id="a-notes" name="notes" class="input" rows="2" [(ngModel)]="form.notes"></textarea>
        </div>
        @if (editing() && paymentCount(editing()!) > 0) {
          <p class="text-xs text-slate-500">El monto y la moneda solo pueden modificarse mientras la cuenta no tenga abonos registrados.</p>
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
      [open]="payModalOpen()"
      title="Registrar abono"
      [subtitle]="paying()?.description ?? ''"
      size="sm"
      (closed)="closePay()"
    >
      <form class="space-y-4" (ngSubmit)="submitPay()" #payFormRef="ngForm">
        <div class="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <span class="text-slate-500">Saldo pendiente</span>
          <span class="font-semibold text-slate-800"><app-money [amount]="paying()?.balance ?? 0" [strong]="true" alignEnd="true" /></span>
        </div>
        <div>
          <label class="label" for="pay-amount">Monto a abonar *</label>
          <input id="pay-amount" name="amount" type="number" class="input" required min="0.01" step="0.01" [(ngModel)]="payForm.amount" />
        </div>
        <div>
          <label class="label" for="pay-method">Método de pago</label>
          <select id="pay-method" name="method" class="input" [(ngModel)]="payForm.method">
            @for (opt of methodOptions; track opt.value) {
              <option [value]="opt.value">{{ opt.label }}</option>
            }
          </select>
        </div>
        <app-currency-select
          id="pay-currency"
          label="Moneda del pago"
          [(value)]="payForm.currency"
          [amount]="payForm.amount"
        />
        <div>
          <label class="label" for="pay-note">Nota</label>
          <input id="pay-note" name="note" class="input" [(ngModel)]="payForm.note" placeholder="Opcional" />
        </div>
        @if (payForm.method === 'CASH') {
          <div class="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <label class="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input type="checkbox" name="payFromCash" class="h-4 w-4" [(ngModel)]="payForm.payFromCash" />
              Pagar desde caja
            </label>
            @if (payForm.payFromCash && !cashOpen()) {
              <p class="mt-2 flex items-center gap-1 text-xs font-medium text-amber-600">
                <app-icon name="alert" size="h-4 w-4" />
                No hay una caja abierta: abre una caja o elige otro método de pago.
              </p>
            }
          </div>
        }
        <div modalFooter class="flex w-full justify-end gap-2">
          <button type="button" class="btn-secondary" (click)="closePay()">Cancelar</button>
          <button type="submit" class="btn-primary" [disabled]="saving() || payFormRef.invalid">
            {{ saving() ? 'Registrando…' : 'Registrar abono' }}
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
              <p class="text-xs text-slate-500">Equivalente ({{ moneyBaseCode() }})</p>
              <p class="text-sm font-semibold text-slate-800"><app-money [amount]="acc.baseAmount" /></p>
            </div>
            <div class="rounded-lg bg-slate-50 p-3">
              <p class="text-xs text-slate-500">Pagado</p>
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
              <dt class="text-slate-500">Proveedor</dt>
              <dd class="font-medium">{{ acc.supplier?.name || '—' }}</dd>
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
            <h3 class="mb-2 text-sm font-semibold text-slate-800">Abonos registrados</h3>
            @if (detailLoading()) {
              <app-loader />
            } @else if ((acc.payments?.length ?? 0) === 0) {
              <p class="text-sm text-slate-500">Aún no hay abonos registrados.</p>
            } @else {
              <div class="table-wrap">
                <table class="table">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Método</th>
                      <th>Moneda</th>
                      <th class="text-right">Monto</th>
                      <th class="text-right">Equivalente ({{ moneyBaseCode() }})</th>
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
