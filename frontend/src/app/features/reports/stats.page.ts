import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import type {
  CategorySalesReport,
  LowStockItem,
  PaymentMethodsReport,
  PaymentsByCurrencyReport,
  SalesSeries,
  TopProduct,
} from '../../core/models/stats.model';
import {
  PAYMENT_METHOD_LABELS,
  PRODUCT_UNIT_LABELS,
  startOfMonthIso,
  todayIso,
} from '../../core/constants/domain';
import { BASE_CURRENCY } from '../../core/constants/currency';
import { StatsService } from '../../core/services/stats.service';
import { moneyIn, number, toDateInput } from '../../core/utils/format';
import { BarChartComponent } from '../../shared/components/bar-chart.component';
import type { BarPoint } from '../../shared/components/bar-chart.component';
import { EmptyStateComponent, LoaderComponent } from '../../shared/components/feedback.component';
import { IconComponent } from '../../shared/components/icon.component';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { MoneyComponent } from '../../shared/components/money.component';
import { StatCardComponent } from '../../shared/components/stat-card.component';

/** Reportes: ventas, gastos, utilidad, métodos de pago, categorías y stock bajo. */
@Component({
  selector: 'app-stats',
  standalone: true,
  imports: [
    FormsModule,
    IconComponent,
    PageHeaderComponent,
    StatCardComponent,
    MoneyComponent,
    BarChartComponent,
    EmptyStateComponent,
    LoaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `    <app-page-header
      title="Reportes"
      subtitle="Ventas, gastos, utilidad y rotación en el rango seleccionado"
      icon="chart"
    >
      <button type="button" class="btn-secondary" (click)="load()">
        <app-icon name="refresh" size="h-4 w-4" />
        Actualizar
      </button>
    </app-page-header>

    <section class="card">
      <div class="card-header">
        <h2 class="text-sm font-semibold text-slate-800">Rango de fechas</h2>
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" class="btn-secondary btn-sm" (click)="applyPreset('today')">Hoy</button>
          <button type="button" class="btn-secondary btn-sm" (click)="applyPreset('week')">Últimos 7 días</button>
          <button type="button" class="btn-secondary btn-sm" (click)="applyPreset('month')">Este mes</button>
          <button type="button" class="btn-secondary btn-sm" (click)="applyPreset('previous')">Mes anterior</button>
        </div>
      </div>
      <div class="card-body grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label class="label" for="s-from">Desde</label>
          <input id="s-from" type="date" class="input" [(ngModel)]="filters.from" />
        </div>
        <div>
          <label class="label" for="s-to">Hasta</label>
          <input id="s-to" type="date" class="input" [(ngModel)]="filters.to" />
        </div>
        <div class="flex items-end">
          <button type="button" class="btn-primary" (click)="load()">
            <app-icon name="filter" size="h-4 w-4" />
            Aplicar
          </button>
        </div>
      </div>
    </section>

    @if (loading()) {
      <app-loader />
    } @else {
      <div class="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <app-stat-card label="Ventas" [value]="totals()?.sales ?? 0" [isCurrency]="true" [hint]="growthHint()" icon="receipt" tone="brand" />
        <app-stat-card label="Cobrado" [value]="totals()?.collected ?? 0" [isCurrency]="true" icon="wallet" tone="emerald" />
        <app-stat-card label="Gastos" [value]="totals()?.expenses ?? 0" [isCurrency]="true" icon="money" tone="rose" />
        <app-stat-card label="Utilidad" [value]="totals()?.profit ?? 0" [isCurrency]="true" icon="trend-up" tone="emerald" />
        <app-stat-card label="Pedidos" [value]="number(totals()?.orders ?? 0)" icon="box" tone="sky" />
        <app-stat-card label="Ticket promedio" [value]="totals()?.ticketAverage ?? 0" [isCurrency]="true" icon="chart" tone="amber" />
      </div>

      <section class="card mt-4">
        <div class="card-header">
          <h2 class="text-sm font-semibold text-slate-800">Ventas vs. gastos</h2>
          <div class="flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span class="flex items-center gap-1"><span class="h-2.5 w-2.5 rounded-sm bg-brand-500"></span> Ventas</span>
            <span class="flex items-center gap-1"><span class="h-2.5 w-2.5 rounded-sm bg-rose-400"></span> Gastos</span>
            @if (granularityLabel()) {
              <span class="text-slate-400">· {{ granularityLabel() }}</span>
            }
          </div>
        </div>
        <div class="card-body">
          @if (chartPoints().length === 0) {
            <p class="text-sm text-slate-500">Sin datos en el rango seleccionado.</p>
          } @else {
            <app-bar-chart [points]="chartPoints()" [isCurrency]="true" />
          }
        </div>
      </section>
      <section class="card mt-4">
        <div class="card-header">
          <h2 class="text-sm font-semibold text-slate-800">Productos más vendidos</h2>
          <span class="text-xs text-slate-500">Top 10</span>
        </div>
        @if (topProducts().length === 0) {
          <app-empty-state title="Sin ventas" message="No hay productos vendidos en el rango seleccionado." icon="box" />
        } @else {
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Producto</th>
                  <th>SKU</th>
                  <th class="text-right">Cantidad</th>
                  <th class="text-right">Ingresos</th>
                  <th class="text-right">Costo</th>
                  <th class="text-right">Utilidad</th>
                </tr>
              </thead>
              <tbody>
                @for (item of topProducts(); track item.productId; let i = $index) {
                  <tr>
                    <td class="text-slate-400">{{ i + 1 }}</td>
                    <td class="font-medium text-slate-900">{{ item.name }}</td>
                    <td class="text-slate-500">{{ item.sku }}</td>
                    <td class="text-right">{{ number(item.quantity) }}</td>
                    <td class="text-right"><app-money [amount]="item.revenue" alignEnd="true" /></td>
                    <td class="text-right text-slate-500"><app-money [amount]="item.cost" alignEnd="true" /></td>
                    <td class="text-right font-medium"><app-money [amount]="item.profit" alignEnd="true" /></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>

      <div class="mt-4 grid gap-4 lg:grid-cols-2">
        <section class="card">
          <div class="card-header">
            <h2 class="text-sm font-semibold text-slate-800">Métodos de pago</h2>
            <app-money class="text-xs text-slate-500" [amount]="paymentMethods()?.total ?? 0" alignEnd="true" />
          </div>
          <div class="card-body space-y-3">
            @if ((paymentMethods()?.items?.length ?? 0) === 0) {
              <p class="text-sm text-slate-500">Sin pagos en el rango seleccionado.</p>
            } @else {
              @for (row of paymentMethods()!.items; track row.method) {
                <div>
                  <div class="flex items-center justify-between text-sm">
                    <span class="font-medium text-slate-700">{{ methodLabels[row.method] }}</span>
                    <app-money class="text-slate-600" [amount]="row.amount" alignEnd="true" />
                    <span class="text-[10px] text-slate-400">{{ number(row.count) }} cobros</span>
                  </div>
                  <div class="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div class="h-full rounded-full bg-brand-500" [style.width.%]="share(row.amount, paymentMethods()!.total)"></div>
                  </div>
                </div>
              }
            }
          </div>
        </section>
        <section class="card">
          <div class="card-header">
            <div>
              <h2 class="text-sm font-semibold text-slate-800">Cobros por moneda</h2>
              <p class="mt-0.5 text-xs text-slate-500">
                Cuánto entró en cada moneda y su equivalente en
                {{ baseCurrency.label }}.
              </p>
            </div>
            <app-money class="text-xs text-slate-500" [amount]="paymentsByCurrency()?.total ?? 0" alignEnd="true" />
          </div>
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Moneda</th>
                  <th class="text-right">Cobrado</th>
                  <th class="text-right">Equivalente ({{ baseCurrency.code }})</th>
                  <th class="text-right">Cobros</th>
                </tr>
              </thead>
              <tbody>
                @if ((paymentsByCurrency()?.items?.length ?? 0) === 0) {
                  <tr>
                    <td colspan="4" class="py-4 text-center text-sm text-slate-500">
                      Sin cobros en el rango seleccionado.
                    </td>
                  </tr>
                } @else {
                  @for (row of paymentsByCurrency()!.items; track row.currency) {
                    <tr>
                      <td>
                        <span class="badge bg-slate-100 text-slate-700">
                          {{ row.currency }}
                        </span>
                      </td>
                      <td class="text-right font-medium">
                        {{ amountIn(row.amount, row.currency) }}
                      </td>
                      <td class="text-right text-slate-600">
                        <app-money [amount]="row.baseAmount" alignEnd="true" />
                      </td>
                      <td class="text-right text-slate-500">{{ number(row.count) }}</td>
                    </tr>
                  }
                }
              </tbody>
            </table>
          </div>
        </section>

        <section class="card">
          <div class="card-header">
            <h2 class="text-sm font-semibold text-slate-800">Ventas por categoría</h2>
            <app-money class="text-xs text-slate-500" [amount]="categories()?.total ?? 0" alignEnd="true" />
          </div>
          <div class="card-body space-y-3">
            @if ((categories()?.items?.length ?? 0) === 0) {
              <p class="text-sm text-slate-500">Sin ventas en el rango seleccionado.</p>
            } @else {
              @for (row of categories()!.items; track row.name) {
                <div>
                  <div class="flex items-center justify-between text-sm">
                    <span class="font-medium text-slate-700">{{ row.name }}</span>
                    <app-money class="text-slate-600" [amount]="row.revenue" alignEnd="true" />
                    <span class="text-[10px] text-slate-400">{{ number(row.quantity) }} unidades</span>
                  </div>
                  <div class="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div class="h-full rounded-full bg-emerald-500" [style.width.%]="share(row.revenue, categories()!.total)"></div>
                  </div>
                </div>
              }
            }
          </div>
        </section>
      </div>

      <section class="card mt-4">
        <div class="card-header">
          <h2 class="text-sm font-semibold text-slate-800">Stock bajo</h2>
          <span class="text-xs text-slate-500">Top 10</span>
        </div>
        @if (lowStock().length === 0) {
          <app-empty-state title="Todo en orden" message="No hay productos por debajo del stock mínimo." icon="box" />
        } @else {
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>SKU</th>
                  <th class="text-right">Stock</th>
                  <th class="text-right">Mínimo</th>
                  <th>Unidad</th>
                </tr>
              </thead>
              <tbody>
                @for (item of lowStock(); track item.id) {
                  <tr>
                    <td class="font-medium text-slate-900">{{ item.name }}</td>
                    <td class="text-slate-500">{{ item.sku }}</td>
                    <td class="text-right font-semibold text-rose-600">{{ number(item.stock) }}</td>
                    <td class="text-right text-slate-500">{{ number(item.minStock) }}</td>
                    <td>{{ unitLabels[item.unit] || item.unit }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>
    }
  `,
})
export class StatsPage implements OnInit {
  private readonly stats = inject(StatsService);

  readonly methodLabels = PAYMENT_METHOD_LABELS;
  readonly unitLabels = PRODUCT_UNIT_LABELS;
  readonly number = number;
  readonly baseCurrency = BASE_CURRENCY;

  /** Formatea un monto en la moneda en la que se cobró. */
  amountIn(value: number | null | undefined, currency?: string | null): string {
    return moneyIn(value, currency);
  }

  readonly loading = signal(true);
  readonly sales = signal<SalesSeries | null>(null);
  readonly topProducts = signal<TopProduct[]>([]);
  readonly paymentMethods = signal<PaymentMethodsReport | null>(null);
  readonly paymentsByCurrency = signal<PaymentsByCurrencyReport | null>(null);
  readonly categories = signal<CategorySalesReport | null>(null);
  readonly lowStock = signal<LowStockItem[]>([]);
  readonly growth = signal<number | null>(null);

  filters = { from: startOfMonthIso(), to: todayIso() };

  readonly totals = computed(() => this.sales()?.totals ?? null);

  readonly chartPoints = computed<BarPoint[]>(() =>
    (this.sales()?.series ?? []).map((point) => ({
      label: this.shortPeriod(point.period),
      value: point.sales,
      secondary: point.expenses,
    })),
  );

  readonly granularityLabel = computed(() => {
    const granularity = this.sales()?.range.granularity;
    if (granularity === 'day') return 'por día';
    if (granularity === 'week') return 'por semana';
    if (granularity === 'month') return 'por mes';
    return '';
  });

  readonly growthHint = computed(() => {
    const growth = this.growth();
    if (growth === null) return undefined;
    return `${growth > 0 ? '+' : ''}${growth.toFixed(1)}% vs. mes anterior`;
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    const query = { from: this.filters.from, to: this.filters.to };
    forkJoin({
      sales: this.stats.sales(query),
      topProducts: this.stats.topProducts({ ...query, limit: 10 }),
      paymentMethods: this.stats.paymentMethods(query),
      paymentsByCurrency: this.stats.paymentsByCurrency(query),
      categories: this.stats.salesByCategory(query),
      lowStock: this.stats.lowStock({ limit: 10 }),
    }).subscribe({
      next: (data) => {
        this.sales.set(data.sales);
        this.topProducts.set(data.topProducts);
        this.paymentMethods.set(data.paymentMethods);
        this.paymentsByCurrency.set(data.paymentsByCurrency);
        this.categories.set(data.categories);
        this.lowStock.set(data.lowStock);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });

    this.stats.dashboard().subscribe({
      next: (data) => this.growth.set(data.month.growth),
      error: () => this.growth.set(null),
    });
  }

  applyPreset(kind: 'today' | 'week' | 'month' | 'previous'): void {
    const now = new Date();
    if (kind === 'today') {
      this.filters.from = todayIso();
      this.filters.to = todayIso();
    } else if (kind === 'week') {
      const start = new Date(now);
      start.setDate(now.getDate() - 6);
      this.filters.from = toDateInput(start);
      this.filters.to = todayIso();
    } else if (kind === 'month') {
      this.filters.from = startOfMonthIso();
      this.filters.to = todayIso();
    } else {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      this.filters.from = toDateInput(first);
      this.filters.to = toDateInput(last);
    }
    this.load();
  }

  shortPeriod(period: string): string {
    const date = new Date(period);
    if (Number.isNaN(date.getTime())) return period;
    return new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short' }).format(date);
  }

  share(value: number, total: number): number {
    return total > 0 ? Math.max(2, Math.round((value / total) * 100)) : 0;
  }
}
