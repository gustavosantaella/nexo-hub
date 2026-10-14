import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { DashboardStats } from '../../core/models/stats.model';
import { AuthService } from '../../core/services/auth.service';
import { RatesService } from '../../core/services/rates.service';
import { StatsService } from '../../core/services/stats.service';
import { PAYMENT_METHOD_LABELS } from '../../core/constants/domain';
import { BASE_CURRENCY } from '../../core/constants/currency';
import { bs, money, moneyIn, number, rate, dateTime } from '../../core/utils/format';
import { LoaderComponent } from '../../shared/components/feedback.component';
import { IconComponent } from '../../shared/components/icon.component';
import { MoneyComponent } from '../../shared/components/money.component';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { StatCardComponent } from '../../shared/components/stat-card.component';

/** Panel principal con el resumen del dia. */
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    RouterLink,
    IconComponent,
    PageHeaderComponent,
    StatCardComponent,
    LoaderComponent,
    MoneyComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `    <app-page-header
      [title]="greeting() + ', ' + (auth.user()?.name ?? '')"
      subtitle="Resumen operativo y financiero de hoy"
      icon="grid"
    >
      <button type="button" class="btn-secondary" (click)="load()">
        <app-icon name="refresh" size="h-4 w-4" />
        Actualizar
      </button>
      <a routerLink="/panel/pedidos" class="btn-primary">
        <app-icon name="plus" size="h-4 w-4" />
        Nuevo pedido
      </a>
    </app-page-header>

    @if (loading()) {
      <app-loader />
    } @else {
      @if (data(); as data) {
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <app-stat-card
          label="Ventas de hoy"
          [value]="data.today.sales"
          [isCurrency]="true"
          [hint]="number(data.today.orders) + ' pedidos · ticket ' + money(data.today.ticketAverage)"
          icon="receipt"
          tone="brand"
        />
        <app-stat-card
          label="Gastos de hoy"
          [value]="data.today.expenses"
          [isCurrency]="true"
          icon="money"
          tone="rose"
        />
        <app-stat-card
          label="Utilidad de hoy"
          [value]="data.today.profit"
          [isCurrency]="true"
          hint="Ventas completadas - gastos"
          icon="trend-up"
          tone="emerald"
        />
        <app-stat-card
          label="Por cobrar"
          [value]="data.accounts.receivable"
          [isCurrency]="true"
          [hint]="'Por pagar: ' + money(data.accounts.payable)"
          icon="wallet"
          tone="amber"
        />
      </div>

      <div class="mt-4 grid gap-4 lg:grid-cols-3">
        <section class="card">
          <div class="card-header">
            <h2 class="text-sm font-semibold text-slate-800">Caja</h2>
            <a routerLink="/panel/caja" class="text-xs font-semibold text-brand-600 hover:underline">
              Ir a caja
            </a>
          </div>
          <div class="card-body">
            @if (data.cash; as cash) {
              <div class="flex items-center gap-2">
                <span class="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
                <span class="text-sm font-medium text-emerald-700">Abierta · {{ cash.code }}</span>
              </div>
              <dl class="mt-4 space-y-2 text-sm">
                <div class="flex justify-between">
                  <dt class="text-slate-500">Fondo inicial</dt>
                  <dd class="font-medium"><app-money [amount]="cash.openingAmount" alignEnd="true" /></dd>
                </div>
                <div class="flex justify-between">
                  <dt class="text-slate-500">
                    Ventas del turno <span class="text-slate-400">(sin propinas)</span>
                  </dt>
                  <dd class="font-medium"><app-money [amount]="cash.salesTotal" alignEnd="true" /></dd>
                </div>
                <div class="flex justify-between">
                  <dt class="text-slate-500">Propinas del turno</dt>
                  <dd class="font-medium"><app-money [amount]="cash.tipsTotal" alignEnd="true" /></dd>
                </div>
                <div class="flex justify-between">
                  <dt class="text-slate-500">Efectivo in / out</dt>
                  <dd class="font-medium">
                    <app-money [amount]="cash.cashIn" alignEnd="true" />
                    <app-money [amount]="cash.cashOut" alignEnd="true" />
                  </dd>
                </div>
                <div class="flex justify-between border-t border-slate-100 pt-2">
                  <dt class="font-medium text-slate-600">Efectivo esperado</dt>
                  <dd class="text-base font-semibold text-slate-900">
                    <app-money [amount]="cash.expectedCash" alignEnd="true" strong />
                  </dd>
                </div>
              </dl>

              @if (cash.byCurrency.length > 0) {
                <div class="mt-4 border-t border-slate-100 pt-3">
                  <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Efectivo por moneda
                  </p>
                  <ul class="mt-2 space-y-1 text-sm">
                    @for (row of cash.byCurrency; track row.currency) {
                      <li class="flex items-center justify-between gap-2">
                        <span class="badge bg-slate-100 text-slate-700">{{ row.currency }}</span>
                        <span class="text-right">
                          <span class="block font-medium">{{ amountIn(row.net, row.currency) }}</span>
                          <span class="block text-[10px] text-slate-400">
                            = {{ money(row.baseNet) }}
                          </span>
                        </span>
                      </li>
                    }
                  </ul>
                </div>
              }
            } @else {
              <p class="text-sm text-slate-500">No hay una sesión de caja abierta.</p>
              <a routerLink="/panel/caja" class="btn-primary btn-sm mt-4">
                <app-icon name="plus" size="h-4 w-4" />
                Abrir caja
              </a>
            }
          </div>
        </section>

        <section class="card">
          <div class="card-header">
            <h2 class="text-sm font-semibold text-slate-800">Mes en curso</h2>
            <a routerLink="/panel/reportes" class="text-xs font-semibold text-brand-600 hover:underline">
              Ver reportes
            </a>
          </div>
          <div class="card-body space-y-3 text-sm">
            <div class="flex justify-between">
              <span class="text-slate-500">Ventas</span>
              <app-money class="font-semibold" [amount]="data.month.sales" alignEnd="true" />
            </div>
            <div class="flex justify-between">
              <span class="text-slate-500">Gastos</span>
              <app-money class="font-semibold" [amount]="data.month.expenses" alignEnd="true" />
            </div>
            <div class="flex justify-between">
              <span class="text-slate-500">Utilidad</span>
              <app-money class="font-semibold" [amount]="data.month.profit" alignEnd="true" />
            </div>
            <p class="flex items-center gap-1 text-xs font-medium" [class]="monthGrowth().tone">
              <app-icon [name]="monthGrowth().icon" size="h-4 w-4" />
              {{ monthGrowth().label }}
            </p>
            <div class="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
              <a
                routerLink="/panel/pedidos"
                class="rounded-lg bg-slate-50 px-3 py-2 transition hover:bg-slate-100"
              >
                <p class="text-xs text-slate-500">Pedidos activos</p>
                <p class="text-lg font-semibold text-slate-900">{{ data.activeOrders }}</p>
              </a>
              <a
                routerLink="/panel/inventario"
                class="rounded-lg bg-slate-50 px-3 py-2 transition hover:bg-slate-100"
              >
                <p class="text-xs text-slate-500">Bajo stock</p>
                <p class="text-lg font-semibold text-slate-900">{{ data.lowStock.count }}</p>
              </a>
            </div>
          </div>
        </section>
        <section class="card">
          <div class="card-header">
            <div>
              <h2 class="text-sm font-semibold text-slate-800">Cobros de hoy</h2>
              <p class="mt-0.5 text-xs text-slate-500">Por método de pago</p>
            </div>
            <app-money class="text-xs text-slate-500" [amount]="data.today.collected" alignEnd="true" />
          </div>
          <div class="card-body">
            @if (paymentsToday().length === 0) {
              <p class="text-sm text-slate-500">Aún no hay cobros registrados hoy.</p>
            } @else {
              <ul class="space-y-3">
                @for (payment of paymentsToday(); track payment.method) {
                  <li>
                    <div class="flex items-center justify-between text-sm">
                      <span class="text-slate-600">{{ payment.label }}</span>
                      <app-money class="font-medium" [amount]="payment.amount" alignEnd="true" />
                    </div>
                    <div class="mt-1 h-1.5 w-full rounded-full bg-slate-100">
                      <div
                        class="h-1.5 rounded-full bg-brand-500"
                        [style.width.%]="share(payment.amount)"
                      ></div>
                    </div>
                  </li>
                }
              </ul>
            }

            <div class="mt-5 border-t border-slate-100 pt-4">
              <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Inventario crítico
              </p>
              @if (data.lowStock.items.length === 0) {
                <p class="mt-2 text-sm text-slate-500">Todo el stock está sobre el mínimo.</p>
              } @else {
                <ul class="mt-2 space-y-1 text-sm">
                  @for (product of data.lowStock.items; track product.id) {
                    <li class="flex items-center justify-between">
                      <span class="truncate text-slate-600">{{ product.name }}</span>
                      <span class="font-medium text-rose-600">
                        {{ product.stock }} {{ product.unit }}
                      </span>
                    </li>
                  }
                </ul>
              }
            </div>
          </div>
        </section>
      </div>

      <section class="card mt-4">
        <div class="card-header">
          <div>
            <h2 class="text-sm font-semibold text-slate-800">Hoy en monedas</h2>
            <p class="mt-0.5 text-xs text-slate-500">
              En qué moneda entró o salió el dinero y su equivalente en
              {{ displayBase().label }}.
            </p>
          </div>
          <span class="badge bg-slate-100 text-slate-600">
            1 {{ baseCurrency.code }} = {{ rateText() }}
          </span>
        </div>
        <div class="card-body grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
          <div>
            <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Resumen del día
            </p>
            <div class="table-wrap">
              <table class="table mt-2">
                <thead>
                  <tr>
                    <th>Concepto</th>
                    <th class="text-right">{{ displayBase().code }}</th>
                    <th class="text-right">Bs</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of summaryRows(); track row.label) {
                    <tr>
                      <td class="text-slate-600">{{ row.label }}</td>
                      <td class="text-right font-medium">{{ money(row.amount) }}</td>
                      <td class="text-right text-slate-500">{{ bsAt(row.amount) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <p class="mt-2 text-[11px] text-slate-400">
              Los bolívares se calculan con la tasa activa del sistema.
            </p>
          </div>

          <div>
            <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Cobros de hoy por moneda
            </p>
            @if (salesByCurrency().length === 0) {
              <p class="mt-2 text-sm text-slate-500">Sin cobros registrados hoy.</p>
            } @else {
              <div class="table-wrap">
                <table class="table mt-2">
                  <thead>
                    <tr>
                      <th>Moneda</th>
                      <th class="text-right">Cobrado</th>
                      <th class="text-right">Equivalente</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of salesByCurrency(); track row.currency) {
                      <tr>
                        <td>
                          <span class="badge bg-slate-100 text-slate-700">{{ row.currency }}</span>
                          <span class="ml-1 text-[10px] text-slate-400">({{ row.count }})</span>
                        </td>
                        <td class="text-right font-medium">
                          {{ amountIn(row.amount, row.currency) }}
                        </td>
                        <td class="text-right text-slate-600">
                          <app-money [amount]="row.baseAmount" alignEnd="true" />
                        </td>
                      </tr>
                    }
                  </tbody>
                  <tfoot>
                    <tr class="border-t border-slate-200">
                      <td class="text-xs font-semibold text-slate-500">Total</td>
                      <td class="text-right font-semibold text-slate-900">
                        {{ bsAt(data.today.collected) }}
                      </td>
                      <td class="text-right">
                        <app-money [amount]="data.today.collected" alignEnd="true" strong />
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            }
            <p class="mt-2 text-[11px] text-slate-400">
              El número entre paréntesis son los cobros de cada moneda; las ventas
              a crédito se suman en «Por cobrar».
            </p>
          </div>

          <div>
            <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Gastos de hoy por moneda
            </p>
            @if (expensesByCurrency().length === 0) {
              <p class="mt-2 text-sm text-slate-500">Sin gastos registrados hoy.</p>
            } @else {
              <div class="table-wrap">
                <table class="table mt-2">
                  <thead>
                    <tr>
                      <th>Moneda</th>
                      <th class="text-right">Pagado</th>
                      <th class="text-right">Equivalente</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of expensesByCurrency(); track row.currency) {
                      <tr>
                        <td>
                          <span class="badge bg-slate-100 text-slate-700">{{ row.currency }}</span>
                          <span class="ml-1 text-[10px] text-slate-400">({{ row.count }})</span>
                        </td>
                        <td class="text-right font-medium">
                          {{ amountIn(row.amount, row.currency) }}
                        </td>
                        <td class="text-right text-slate-600">
                          <app-money [amount]="row.baseAmount" alignEnd="true" />
                        </td>
                      </tr>
                    }
                  </tbody>
                  <tfoot>
                    <tr class="border-t border-slate-200">
                      <td class="text-xs font-semibold text-slate-500">Total</td>
                      <td class="text-right font-semibold text-slate-900">
                        {{ bsAt(data.today.expenses) }}
                      </td>
                      <td class="text-right">
                        <app-money [amount]="data.today.expenses" alignEnd="true" strong />
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            }
            <p class="mt-2 text-[11px] text-slate-400">
              Utilidad de hoy:
              {{ money(data.today.profit) }} · {{ bsAt(data.today.profit) }}.
            </p>
          </div>
        </div>
      </section>


      <div class="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <section class="card p-5">
          <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Catálogo</p>
          <dl class="mt-3 space-y-1 text-sm">
            <div class="flex justify-between">
              <dt class="text-slate-500">Productos</dt>
              <dd class="font-medium">{{ data.catalog.products }}</dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-slate-500">Clientes</dt>
              <dd class="font-medium">{{ data.catalog.customers }}</dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-slate-500">Proveedores</dt>
              <dd class="font-medium">{{ data.catalog.suppliers }}</dd>
            </div>
          </dl>
        </section>

        <section class="card p-5">
          <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Cuentas</p>
          <dl class="mt-3 space-y-1 text-sm">
            <div class="flex justify-between">
              <dt class="text-slate-500">Por cobrar</dt>
              <dd class="font-medium text-emerald-700"><app-money [amount]="data.accounts.receivable" alignEnd="true" /></dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-slate-500">Por pagar</dt>
              <dd class="font-medium text-rose-700"><app-money [amount]="data.accounts.payable" alignEnd="true" /></dd>
            </div>
            <div class="flex justify-between border-t border-slate-100 pt-1">
              <dt class="font-medium text-slate-600">Neto</dt>
              <dd class="font-semibold"><app-money [amount]="data.accounts.net" alignEnd="true" strong /></dd>
            </div>
          </dl>
        </section>

        <section class="card p-5">
          <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Accesos rápidos
          </p>
          <div class="mt-3 grid grid-cols-2 gap-2">
            <a routerLink="/panel/productos" class="btn-secondary btn-sm">Productos</a>
            <a routerLink="/panel/inventario" class="btn-secondary btn-sm">Inventario</a>
            <a routerLink="/panel/gastos" class="btn-secondary btn-sm">Gastos</a>
            <a routerLink="/panel/cuentas-por-cobrar" class="btn-secondary btn-sm">Cobranzas</a>
          </div>
          <p class="mt-4 text-[11px] text-slate-400">Actualizado: {{ updatedAt() }}</p>
        </section>
      </div>
      }
    }
`,
})
export class DashboardPage implements OnInit {
  readonly auth = inject(AuthService);
  private readonly stats = inject(StatsService);
  private readonly rates = inject(RatesService);

  readonly loading = signal(true);
  readonly data = signal<DashboardStats | null>(null);
  readonly money = money;
  readonly number = number;
  readonly baseCurrency = BASE_CURRENCY;
  /** Moneda base con la que se muestran los montos (USD por defecto). */
  readonly displayBase = this.rates.baseCurrency;

  readonly greeting = computed(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Buenos días';
    if (hour < 19) return 'Buenas tardes';
    return 'Buenas noches';
  });

  readonly monthGrowth = computed(() => {
    const growth = this.data()?.month.growth ?? 0;
    return {
      value: growth,
      label: `${growth > 0 ? '+' : ''}${growth.toFixed(1)}% vs. mes anterior`,
      tone: growth >= 0 ? 'text-emerald-600' : 'text-rose-600',
      icon: growth >= 0 ? 'trend-up' : 'trend-down',
    };
  });

  readonly paymentsToday = computed(() =>
    (this.data()?.paymentsToday ?? []).map((item) => ({
      ...item,
      label: PAYMENT_METHOD_LABELS[item.method] ?? item.method,
    })),
  );

  readonly paymentMax = computed(() =>
    Math.max(1, ...this.paymentsToday().map((p) => p.amount)),
  );

  /** Cobros de hoy por moneda (en qué moneda entró el dinero). */
  readonly salesByCurrency = computed(
    () => this.data()?.currencies?.sales ?? [],
  );

  /** Gastos de hoy por moneda. */
  readonly expensesByCurrency = computed(
    () => this.data()?.currencies?.expenses ?? [],
  );

  /** Bolívares por USD con la tasa activa (personalizada si existe). */
  readonly rateText = computed(() => {
    const value = this.rates.bsPerUsd();
    return value === null ? '—' : `Bs ${rate(value)}`;
  });

  /**
   * Resumen del día: cada concepto en USD (moneda base) con su equivalente en
   * bolívares a la tasa activa.
   */
  readonly summaryRows = computed(() => {
    const totals = this.data()?.currencies?.totals;
    return [
      { label: 'Ventas', amount: totals?.sales ?? 0 },
      { label: 'Cobrado', amount: totals?.collected ?? 0 },
      { label: 'Gastos', amount: totals?.expenses ?? 0 },
      { label: 'Utilidad', amount: totals?.profit ?? 0 },
      { label: 'Por cobrar', amount: totals?.receivable ?? 0 },
      { label: 'Por pagar', amount: totals?.payable ?? 0 },
      { label: 'Neto', amount: totals?.net ?? 0 },
    ];
  });

  /** Formatea un monto en su moneda original. */
  amountIn(value: number | null | undefined, currency?: string | null): string {
    return moneyIn(value, currency);
  }

  /** Equivalente en bolívares con la tasa activa (`—` si aún no hay tasa). */
  bsAt(value: number | null | undefined): string {
    const converted = this.rates.toBs(value);
    return converted === null ? '—' : bs(converted);
  }

  readonly updatedAt = computed(() => dateTime(this.data()?.generatedAt));

  ngOnInit(): void {
    this.rates.ensureLoaded();
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.stats.dashboard().subscribe({
      next: (data) => {
        this.data.set(data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  share(amount: number): number {
    return Math.max(3, Math.round((amount / this.paymentMax()) * 100));
  }
}
