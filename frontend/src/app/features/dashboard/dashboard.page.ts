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
  templateUrl: './dashboard.page.html',
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
