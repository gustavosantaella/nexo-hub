import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostListener,
  Input,
  Output,
  inject,
} from '@angular/core';
import {
  ACCOUNT_STATUS_LABELS,
  CASH_CATEGORY_LABELS,
  EXPENSE_CATEGORY_LABELS,
  ORDER_STATUS_LABELS,
  ORDER_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  PRODUCT_UNIT_LABELS,
} from '../../core/constants/domain';
import { BASE_CURRENCY } from '../../core/constants/currency';
import type { ReportData } from '../../core/models/report.model';
import type { SalesPoint } from '../../core/models/stats.model';
import { bs, dateTime, displayBaseLabel, money, moneyIn, number, quantity, rate, shortDate } from '../../core/utils/format';
import { AuthService } from '../../core/services/auth.service';
import { IconComponent } from '../../shared/components/icon.component';
import { REPORT_CSS, REPORT_PRINT_CSS } from './report.styles';

/**
 * Documento del reporte: una hoja A4 con el logo, el RIF y el nombre de la
 * empresa y TODO lo que cayó dentro del rango de fechas seleccionado.
 *
 * Se muestra como vista previa a pantalla completa y el botón «Descargar PDF»
 * lo lleva a una ventana limpia (solo el papel, con los mismos estilos) y abre
 * el cuadro de impresión del navegador, donde se elige «Guardar como PDF».
 */
@Component({
  selector: 'app-report-sheet',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [REPORT_CSS],
  templateUrl: './report-sheet.component.html',
})
export class ReportSheetComponent {
  private readonly auth = inject(AuthService);

  @Input({ required: true }) data!: ReportData;
  @Output() readonly closed = new EventEmitter<void>();

  /** Etiquetas de los enums, expuestas a la plantilla. */
  readonly orderStatusLabels = ORDER_STATUS_LABELS;
  readonly orderTypeLabels = ORDER_TYPE_LABELS;
  readonly paymentMethodLabels = PAYMENT_METHOD_LABELS;
  readonly expenseCategoryLabels = EXPENSE_CATEGORY_LABELS;
  readonly accountStatusLabels = ACCOUNT_STATUS_LABELS;
  readonly cashCategoryLabels = CASH_CATEGORY_LABELS;
  readonly unitLabels = PRODUCT_UNIT_LABELS;
  readonly baseCurrency = BASE_CURRENCY;
  /** Etiqueta de la moneda base con la que se muestran los montos. */
  readonly moneyBaseLabel = displayBaseLabel;

  /** Helpers de formato. */
  readonly money = money;
  readonly moneyIn = moneyIn;
  readonly number = number;
  /** Cantidades/existencias: hasta 3 decimales, sin ceros de relleno. */
  readonly quantity = quantity;
  readonly rate = rate;
  readonly shortDate = shortDate;
  readonly dateTime = dateTime;

  /** Suma de ingresos de las categorías (para el total de la sección). */
  readonly revenueOf = (total: number, item: { revenue: number }): number =>
    total + Number(item.revenue ?? 0);

  get userName(): string {
    return this.auth.user()?.name ?? '';
  }

  /** Total (y cobrado) de los pedidos que se están listando. */
  ordersTotal(): number {
    return this.data.orders.reduce((total, order) => total + Number(order.total ?? 0), 0);
  }

  ordersPaid(): number {
    return this.data.orders.reduce((total, order) => total + Number(order.paidAmount ?? 0), 0);
  }

  /** Suma en moneda base de los gastos listados. */
  expensesSum(): number {
    return this.data.expenses.reduce((total, expense) => total + Number(expense.baseAmount ?? 0), 0);
  }

  close(): void {
    this.closed.emit();
  }

  /** Cierra al pulsar el fondo (nunca al pulsar dentro de la hoja). */
  onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.close();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }

  get generatedText(): string {
    return dateTime(this.data.range.generatedAt);
  }

  /** Texto de un enum (cae al código si no hay etiqueta para ese valor). */
  label(labels: Record<string, string>, key: string): string {
    return labels[key] ?? key;
  }

  /** Iniciales de la empresa, para cuando todavía no hay logo configurado. */
  initials(): string {
    const parts = this.data.company.name.split(' ').filter(Boolean).slice(0, 2);
    const letters = parts.map((part) => part[0]?.toUpperCase() ?? '').join('');
    return letters || 'NH';
  }

  /** Equivalente en bolívares de un monto base (con la primera tasa vigente). */
  bsOf(amount: number): string | null {
    const first = this.data.rates[0];
    if (!first || !first.rate) return null;
    return `≈ ${bs(Number(amount ?? 0) * first.rate)}`;
  }

  /** Porcentaje tal como lo calcula el backend (`share` ya viene en %). */
  percent(share: number): string {
    return `${number(share, 1)} %`;
  }

  /** Fecha (o período) de un punto de la serie según su granularidad. */
  periodLabel(point: SalesPoint): string {
    const date = new Date(`${point.period}T12:00:00`);
    if (Number.isNaN(date.getTime())) return point.period;
    const granularity = this.data.range.granularity;
    if (granularity === 'month') {
      const text = new Intl.DateTimeFormat('es-PE', {
        month: 'long',
        year: 'numeric',
      }).format(date);
      return text.charAt(0).toUpperCase() + text.slice(1);
    }
    if (granularity === 'week') return `Semana del ${shortDate(date)}`;
    return shortDate(date);
  }

  get granularityLabel(): string {
    const granularity = this.data.range.granularity;
    if (granularity === 'day') return 'Detalle por día';
    if (granularity === 'week') return 'Detalle por semana';
    return 'Detalle por mes';
  }

  /** `true` cuando el detalle impreso no alcanza a cubrir todo el rango. */
  get ordersCut(): boolean {
    return this.data.ordersTotal > this.data.orders.length;
  }

  get expensesCut(): boolean {
    return this.data.expensesTotal > this.data.expenses.length;
  }

  /** Saldo pendiente de un pedido (total menos lo cobrado). */
  balance(order: { total: number; paidAmount: number }): number {
    return Number(order.total ?? 0) - Number(order.paidAmount ?? 0);
  }

  /**
   * Abre el documento en una ventana aparte y lanza la impresión. Solo se copia
   * el papel (con los estilos del reporte) para que el PDF salga limpio, sin la
   * barra lateral ni los botones de la aplicación.
   */
  async print(paper: HTMLElement): Promise<void> {
    const popup = window.open('', '_blank', 'width=1024,height=900');
    if (!popup) return;

    popup.document.open();
    popup.document.write(
      '<!doctype html><html lang="es"><head><meta charset="utf-8">' +
        `<title>Reporte ${escapeHtml(this.data.company.name)} · ${escapeHtml(this.data.range.label)}</title>` +
        `<style>${REPORT_CSS}${REPORT_PRINT_CSS}</style>` +
        `</head><body>${paper.outerHTML}</body></html>`,
    );
    popup.document.close();

    await this.waitForAssets(popup);
    popup.focus();
    popup.print();
  }

  /** Espera al logo y a las fuentes para que no se imprima a medio pintar. */
  private async waitForAssets(popup: Window): Promise<void> {
    const images = Array.from(popup.document.images).map(
      (image) =>
        new Promise<void>((resolve) => {
          if (image.complete) return resolve();
          image.addEventListener('load', () => resolve(), { once: true });
          image.addEventListener('error', () => resolve(), { once: true });
        }),
    );
    await Promise.all(images);
    await popup.document.fonts?.ready?.catch(() => undefined);
  }
}

/** Escapa el texto que va dentro del `<title>` de la ventana de impresión. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

