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
import {
  CHART_COLORS,
  chartColor,
  currencyColor,
  paymentMethodColor,
} from '../../core/constants/chart';
import type { ChartColor } from '../../core/constants/chart';
import { reportCompany } from '../../core/models/report.model';
import type { ReportData } from '../../core/models/report.model';
import { AuthService } from '../../core/services/auth.service';
import { ReportService } from '../../core/services/report.service';
import { StatsService } from '../../core/services/stats.service';
import {
  apiErrorMessage,
  compact,
  displayBaseLabel,
  moneyIn,
  moneyInCompact,
  isCompact,
  number,
  quantity,
  toDateInput,
} from '../../core/utils/format';
import { ToastService } from '../../core/services/toast.service';
import { BarChartComponent } from '../../shared/components/bar-chart.component';
import type { BarPoint } from '../../shared/components/bar-chart.component';
import { BarListComponent } from '../../shared/components/bar-list.component';
import type { BarRow } from '../../shared/components/bar-list.component';
import { DonutChartComponent } from '../../shared/components/donut-chart.component';
import type { DonutSlice } from '../../shared/components/donut-chart.component';
import { LineChartComponent } from '../../shared/components/line-chart.component';
import type { LineSeries } from '../../shared/components/line-chart.component';
import { EmptyStateComponent, LoaderComponent } from '../../shared/components/feedback.component';
import { IconComponent } from '../../shared/components/icon.component';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { MoneyComponent } from '../../shared/components/money.component';
import { StatCardComponent } from '../../shared/components/stat-card.component';
import { ReportSheetComponent } from './report-sheet.component';

/** Bloque de los graficos de composicion (anillo + ranking). */
interface CompositionItem {
  label: string;
  value: number;
  /** Dato extra junto al valor (ej. "24 unidades"). */
  caption?: string;
  /** Detalle completo (tooltip) cuando el `caption` va abreviado. */
  captionTitle?: string;
  color: ChartColor;
}

/**
 * Datos de un anillo y su ranking: las porciones, las filas del ranking y el
 * bloque mayor (para el dato central del anillo).
 */
interface Composition {
  rows: BarRow[];
  slices: DonutSlice[];
  topLabel: string;
  topShare: number;
}

/** Convierte los bloques de una composicion en porciones y filas del ranking. */
function toComposition(items: CompositionItem[]): Composition {
  const total = items.reduce((acc, item) => acc + (Number(item.value) || 0), 0);
  const top = items.reduce<CompositionItem | null>(
    (best, item) => (best === null || item.value > best.value ? item : best),
    null,
  );

  return {
    rows: items.map((item) => ({
      label: item.label,
      value: item.value,
      caption: item.caption,
      captionTitle: item.captionTitle,
      color: item.color,
    })),
    slices: items.map((item) => ({
      label: item.label,
      value: item.value,
      color: item.color,
    })),
    topLabel: top?.label ?? '',
    topShare: top && total > 0 ? (top.value / total) * 100 : 0,
  };
}

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
    BarListComponent,
    DonutChartComponent,
    LineChartComponent,
    EmptyStateComponent,
    LoaderComponent,
    ReportSheetComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './stats.page.html',
})
export class StatsPage implements OnInit {
  private readonly stats = inject(StatsService);
  private readonly reports = inject(ReportService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  readonly methodLabels = PAYMENT_METHOD_LABELS;
  readonly unitLabels = PRODUCT_UNIT_LABELS;
  readonly number = number;
  /** Cantidades/existencias: hasta 3 decimales, sin ceros de relleno. */
  readonly quantity = quantity;
  readonly baseCurrency = BASE_CURRENCY;
  /** Etiqueta de la moneda base con la que se muestran los montos. */
  readonly moneyBaseLabel = displayBaseLabel;

  /**
   * Formatea un monto en la moneda en la que se cobró. Los montos enormes (las
   * cifras en bolívares llegan a millones) se abrevian para no desbordar el
   * ranking; el detalle exacto queda en el tooltip de la fila.
   */
  amountIn(value: number | null | undefined, currency?: string | null): string {
    const amount = Number(value ?? 0);
    if (isCompact(amount)) return moneyInCompact(amount, currency);
    return moneyIn(amount, currency);
  }

  readonly loading = signal(true);
  readonly sales = signal<SalesSeries | null>(null);
  readonly topProducts = signal<TopProduct[]>([]);
  readonly paymentMethods = signal<PaymentMethodsReport | null>(null);
  readonly paymentsByCurrency = signal<PaymentsByCurrencyReport | null>(null);
  readonly categories = signal<CategorySalesReport | null>(null);
  readonly lowStock = signal<LowStockItem[]>([]);
  readonly growth = signal<number | null>(null);
  /** Reporte general abierto en la vista previa (null = cerrado). */
  readonly report = signal<ReportData | null>(null);
  readonly reportLoading = signal(false);

  filters = { from: startOfMonthIso(), to: todayIso() };

  readonly totals = computed(() => this.sales()?.totals ?? null);

  readonly chartPoints = computed<BarPoint[]>(() =>
    (this.sales()?.series ?? []).map((point) => ({
      label: this.shortPeriod(point.period),
      value: point.sales,
      secondary: point.expenses,
    })),
  );

  /** Etiquetas del eje horizontal de la tendencia. */
  readonly chartLabels = computed(() =>
    (this.sales()?.series ?? []).map((point) => this.shortPeriod(point.period)),
  );

  /** Tendencia del período: ventas, cobros y utilidad por período. */
  readonly trendSeries = computed<LineSeries[]>(() => {
    const points = this.sales()?.series ?? [];
    if (points.length === 0) return [];
    return [
      { label: 'Ventas', color: CHART_COLORS.brand, values: points.map((point) => point.sales) },
      { label: 'Cobrado', color: CHART_COLORS.sky, values: points.map((point) => point.collected) },
      { label: 'Utilidad', color: CHART_COLORS.emerald, values: points.map((point) => point.profit) },
    ];
  });

  /** Métodos de pago: anillo + ranking (con los colores fijos de cada método). */
  readonly paymentChart = computed<Composition>(() =>
    toComposition(
      (this.paymentMethods()?.items ?? []).map((row, index) => ({
        label: this.methodLabels[row.method] ?? row.method,
        value: row.amount,
        caption: this.countLabel(row.count, 'cobros'),
        color: paymentMethodColor(row.method, index),
      })),
    ),
  );

  /** Dato central del anillo de métodos de pago. */
  readonly paymentCenter = computed(() => this.centerOf(this.paymentChart()));

  /** Productos más vendidos: ranking de ingresos sobre la tabla de detalle. */
  readonly topProductRows = computed<BarRow[]>(() =>
    this.topProducts().map((item) => ({
      label: item.name,
      value: item.revenue,
      caption: this.countLabel(item.quantity, 'u.'),
    })),
  );

  /** Cobros por moneda: el ranking muestra el equivalente y el monto original. */
  readonly currencyChart = computed<Composition>(() =>
    toComposition(
      (this.paymentsByCurrency()?.items ?? []).map((row, index) => ({
        label: row.currency,
        value: row.baseAmount,
        caption: `${this.amountIn(row.amount, row.currency)} · ${this.countLabel(row.count, 'cobros')}`,
        captionTitle: `${moneyIn(row.amount, row.currency)} · ${this.countLabel(row.count, 'cobros')}`,
        color: currencyColor(row.currency, index),
      })),
    ),
  );

  /** Dato central del anillo de monedas. */
  readonly currencyCenter = computed(() => this.centerOf(this.currencyChart()));

  /** Ventas por categoría: anillo + ranking. */
  readonly categoryChart = computed<Composition>(() =>
    toComposition(
      (this.categories()?.items ?? []).map((row, index) => ({
        label: row.name,
        value: row.revenue,
        caption: this.countLabel(row.quantity, 'unidades'),
        color: chartColor(index),
      })),
    ),
  );

  /** Dato central del anillo de categorías. */
  readonly categoryCenter = computed(() => this.centerOf(this.categoryChart()));

  /** Stock bajo: existencias con el mínimo marcado sobre cada barra. */
  readonly lowStockRows = computed<BarRow[]>(() =>
    this.lowStock().map((item) => ({
      label: item.name,
      value: item.stock,
      valueText: this.countLabel(item.stock, item.unit),
      caption: `mín. ${quantity(item.minStock)}`,
      marker: item.minStock,
      markerLabel: 'Mínimo',
      color: CHART_COLORS.rose,
    })),
  );

  /** Dato central de un anillo: porcentaje y nombre del bloque mayor. */
  private centerOf(chart: Composition): { value: string; hint: string } {
    return {
      value: chart.topShare > 0 ? `${number(chart.topShare, 1)} %` : '—',
      hint: chart.topLabel,
    };
  }

  /** Cantidad con su unidad, abreviada cuando es enorme (12.5k unidades). */
  private countLabel(value: number | null | undefined, unit = ''): string {
    const amount = Number(value ?? 0);
    const text = isCompact(amount) ? compact(amount) : number(amount);
    return unit ? `${text} ${unit}` : text;
  }

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

  /**
   * Genera el reporte general con TODO lo que cayó dentro del rango de fechas
   * elegido (ventas, cobros, gastos, productos, caja, cuentas…) y lo abre en la
   * vista previa, desde donde se descarga en PDF.
   */
  generateReport(): void {
    if (this.reportLoading()) return;

    this.reportLoading.set(true);
    this.reports
      .build(this.filters.from, this.filters.to, reportCompany(this.auth.company()))
      .subscribe({
        next: (data) => {
          this.reportLoading.set(false);
          this.report.set(data);
        },
        error: (error) => {
          this.reportLoading.set(false);
          this.toast.error(apiErrorMessage(error), 'No se pudo generar el reporte');
        },
      });
  }

  closeReport(): void {
    this.report.set(null);
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
}
