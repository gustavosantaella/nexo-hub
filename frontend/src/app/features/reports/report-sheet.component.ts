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
import { bs, dateTime, money, moneyIn, number, rate, shortDate } from '../../core/utils/format';
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
  template: `
    <div class="rp-shell" (click)="onBackdrop($event)">
      <div class="rp-toolbar">
        <div class="rp-toolbar-title">
          <app-icon name="receipt" size="h-5 w-5" />
          <span>
            Reporte general
            <span class="rp-toolbar-hint">
              {{ data.company.name }} · {{ data.range.label }} · en el cuadro de
              impresión elige «Guardar como PDF».
            </span>
          </span>
        </div>
        <div class="rp-toolbar-actions">
          <button type="button" class="btn-secondary" (click)="close()">
            <app-icon name="close" size="h-4 w-4" />
            Cerrar
          </button>
          <button type="button" class="btn-primary" (click)="print(paper)">
            <app-icon name="download" size="h-4 w-4" />
            Descargar PDF
          </button>
        </div>
      </div>

      <article class="rp" #paper>
        <div class="rp-bar"></div>

        <header class="rp-head">
          <div class="rp-brand">
            @if (data.company.logoUrl) {
              <div class="rp-logo">
                <img [src]="data.company.logoUrl" [alt]="'Logo de ' + data.company.name" />
              </div>
            } @else {
              <div class="rp-logo">
                <span>{{ initials() }}</span>
              </div>
            }
            <div>
              <p class="rp-company-name">{{ data.company.name }}</p>
              <p class="rp-company-rif">RIF {{ data.company.rif }}</p>
              <div class="rp-company-lines">
                @if (data.company.address) {
                  <span>{{ data.company.address }}</span>
                }
                @if (data.company.phone) {
                  <span>Tel. {{ data.company.phone }}</span>
                }
                @if (data.company.email) {
                  <span>{{ data.company.email }}</span>
                }
              </div>
            </div>
          </div>

          <div class="rp-doc">
            <p class="rp-doc-title">Reporte general</p>
            <p class="rp-doc-range">{{ data.range.label }}</p>
            <p class="rp-doc-meta">Generado el {{ generatedText }}</p>
            <p class="rp-doc-meta">Nexo Hub · Gestión de locales</p>
          </div>
        </header>

        <div class="rp-rule"></div>
        <!-- Resumen del período -->
        <section class="rp-section">
          <h2 class="rp-section-title">
            Resumen del período
            <small>{{ data.range.label }}</small>
          </h2>
          <div class="rp-cards">
            <div class="rp-card is-brand">
              <p class="rp-card-label">Ventas</p>
              <p class="rp-card-value">{{ money(data.totals.sales) }}</p>
              @if (bsOf(data.totals.sales); as hint) {
                <p class="rp-card-hint">{{ hint }}</p>
              }
            </div>
            <div class="rp-card is-good">
              <p class="rp-card-label">Cobrado</p>
              <p class="rp-card-value">{{ money(data.totals.collected) }}</p>
              <p class="rp-card-hint">
                @if (data.totals.sales > 0) {
                  {{ percent((data.totals.collected / data.totals.sales) * 100) }} de las ventas
                } @else {
                  Sin cobros en el período
                }
              </p>
            </div>
            <div class="rp-card is-bad">
              <p class="rp-card-label">Gastos</p>
              <p class="rp-card-value">{{ money(data.totals.expenses) }}</p>
              <p class="rp-card-hint">{{ data.expenseSummary.count }} gasto(s) registrados</p>
            </div>
            <div class="rp-card" [class.is-bad]="data.totals.profit < 0" [class.is-good]="data.totals.profit >= 0">
              <p class="rp-card-label">Utilidad</p>
              <p class="rp-card-value">{{ money(data.totals.profit) }}</p>
              <p class="rp-card-hint">Ventas menos gastos</p>
            </div>
            <div class="rp-card">
              <p class="rp-card-label">Pedidos</p>
              <p class="rp-card-value">{{ number(data.totals.orders) }}</p>
              <p class="rp-card-hint">
                Ticket promedio {{ money(data.totals.ticketAverage) }}
              </p>
            </div>
            <div class="rp-card">
              <p class="rp-card-label">Saldo por cobrar</p>
              <p class="rp-card-value">{{ money(data.receivables.openBalance) }}</p>
              <p class="rp-card-hint">
                Ventas menos cobros del rango:
                {{ money(data.totals.sales - data.totals.collected) }}
              </p>
            </div>
          </div>
        </section>

        <!-- Ventas, gastos y utilidad del período -->
        <section class="rp-section">
          <h2 class="rp-section-title">
            Ventas, cobros, gastos y utilidad
            <small>{{ granularityLabel }}</small>
          </h2>

          @if (data.series.length === 0) {
            <p class="rp-empty">Sin movimientos registrados en el período.</p>
          } @else {
            <table class="rp-table">
              <thead>
                <tr>
                  <th>Período</th>
                  <th class="rp-num">Pedidos</th>
                  <th class="rp-num">Ventas</th>
                  <th class="rp-num">Cobrado</th>
                  <th class="rp-num">Gastos</th>
                  <th class="rp-num">Utilidad</th>
                </tr>
              </thead>
              <tbody>
                @for (point of data.series; track point.period) {
                  <tr>
                    <td class="rp-strong">{{ periodLabel(point) }}</td>
                    <td class="rp-num">{{ number(point.orders) }}</td>
                    <td class="rp-num">{{ money(point.sales) }}</td>
                    <td class="rp-num">{{ money(point.collected) }}</td>
                    <td class="rp-num rp-dim">{{ money(point.expenses) }}</td>
                    <td class="rp-num" [class.rp-neg]="point.profit < 0" [class.rp-pos]="point.profit >= 0">
                      {{ money(point.profit) }}
                    </td>
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr>
                  <td>Total del rango</td>
                  <td class="rp-num">{{ number(data.totals.orders) }}</td>
                  <td class="rp-num">{{ money(data.totals.sales) }}</td>
                  <td class="rp-num">{{ money(data.totals.collected) }}</td>
                  <td class="rp-num">{{ money(data.totals.expenses) }}</td>
                  <td class="rp-num">{{ money(data.totals.profit) }}</td>
                </tr>
              </tfoot>
            </table>
          }
        </section>
        <div class="rp-cols">
          <!-- Cobros por método de pago -->
          <section class="rp-section">
            <h2 class="rp-section-title">
              Cobros por método
              <small>Total {{ money(data.paymentMethods.total) }}</small>
            </h2>
            @if (data.paymentMethods.items.length === 0) {
              <p class="rp-empty">Sin cobros en el período.</p>
            } @else {
              <table class="rp-table">
                <thead>
                  <tr>
                    <th>Método</th>
                    <th class="rp-num">Cobros</th>
                    <th class="rp-num">Monto</th>
                    <th class="rp-num">%</th>
                  </tr>
                </thead>
                <tbody>
                  @for (item of data.paymentMethods.items; track item.method) {
                    <tr>
                      <td class="rp-strong">{{ label(paymentMethodLabels, item.method) }}</td>
                      <td class="rp-num rp-dim">{{ number(item.count) }}</td>
                      <td class="rp-num">{{ money(item.amount) }}</td>
                      <td class="rp-num rp-dim">{{ percent(item.share) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          </section>

          <!-- Cobros por moneda -->
          <section class="rp-section">
            <h2 class="rp-section-title">
              Cobros por moneda
              <small>Equivalente en {{ baseCurrency.label }}</small>
            </h2>
            @if (data.paymentsByCurrency.items.length === 0) {
              <p class="rp-empty">Sin cobros en el período.</p>
            } @else {
              <table class="rp-table">
                <thead>
                  <tr>
                    <th>Moneda</th>
                    <th class="rp-num">Cobros</th>
                    <th class="rp-num">Monto</th>
                    <th class="rp-num">Equivalente</th>
                  </tr>
                </thead>
                <tbody>
                  @for (item of data.paymentsByCurrency.items; track item.currency) {
                    <tr>
                      <td class="rp-strong">{{ item.currency }}</td>
                      <td class="rp-num rp-dim">{{ number(item.count) }}</td>
                      <td class="rp-num">{{ moneyIn(item.amount, item.currency) }}</td>
                      <td class="rp-num">{{ money(item.baseAmount) }}</td>
                    </tr>
                  }
                </tbody>
                <tfoot>
                  <tr>
                    <td colspan="3">Total cobrado</td>
                    <td class="rp-num">{{ money(data.paymentsByCurrency.total) }}</td>
                  </tr>
                </tfoot>
              </table>
            }
          </section>
        </div>

        <!-- Ventas por categoría -->
        <section class="rp-section">
          <h2 class="rp-section-title">
            Ventas por categoría
            <small>Total {{ money(data.categories.reduce(revenueOf, 0)) }}</small>
          </h2>
          @if (data.categories.length === 0) {
            <p class="rp-empty">Sin ventas por categoría en el período.</p>
          } @else {
            <table class="rp-table">
              <thead>
                <tr>
                  <th>Categoría</th>
                  <th class="rp-num">Unidades</th>
                  <th class="rp-num">Ingresos</th>
                  <th class="rp-num">%</th>
                </tr>
              </thead>
              <tbody>
                @for (item of data.categories; track item.name) {
                  <tr>
                    <td class="rp-strong">{{ item.name }}</td>
                    <td class="rp-num rp-dim">{{ number(item.quantity) }}</td>
                    <td class="rp-num">{{ money(item.revenue) }}</td>
                    <td class="rp-num rp-dim">{{ percent(item.share) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </section>

        <!-- Productos más vendidos -->
        <section class="rp-section">
          <h2 class="rp-section-title">
            Productos más vendidos
            <small>{{ data.topProducts.length }} producto(s)</small>
          </h2>
          @if (data.topProducts.length === 0) {
            <p class="rp-empty">Sin productos vendidos en el período.</p>
          } @else {
            <table class="rp-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Producto</th>
                  <th>SKU</th>
                  <th class="rp-num">Cantidad</th>
                  <th class="rp-num">Ingresos</th>
                  <th class="rp-num">Costo</th>
                  <th class="rp-num">Utilidad</th>
                </tr>
              </thead>
              <tbody>
                @for (item of data.topProducts; track item.productId; let i = $index) {
                  <tr>
                    <td class="rp-dim">{{ i + 1 }}</td>
                    <td class="rp-strong">{{ item.name }}</td>
                    <td class="rp-dim">{{ item.sku }}</td>
                    <td class="rp-num">{{ number(item.quantity) }}</td>
                    <td class="rp-num">{{ money(item.revenue) }}</td>
                    <td class="rp-num rp-dim">{{ money(item.cost) }}</td>
                    <td class="rp-num" [class.rp-neg]="item.profit < 0" [class.rp-pos]="item.profit >= 0">
                      {{ money(item.profit) }}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </section>
        <!-- Detalle de ventas / pedidos -->
        <section class="rp-section">
          <h2 class="rp-section-title">
            Detalle de pedidos
            <small>{{ number(data.orders.length) }} de {{ number(data.ordersTotal) }} pedido(s)</small>
          </h2>
          @if (data.orders.length === 0) {
            <p class="rp-empty">Sin pedidos en el período.</p>
          } @else {
            <table class="rp-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Fecha y hora</th>
                  <th>Cliente</th>
                  <th>Tipo</th>
                  <th>Estado</th>
                  <th class="rp-num">Total</th>
                  <th class="rp-num">Cobrado</th>
                  <th class="rp-num">Saldo</th>
                </tr>
              </thead>
              <tbody>
                @for (order of data.orders; track order.id) {
                  <tr>
                    <td class="rp-strong">{{ order.code }}</td>
                    <td class="rp-dim">{{ dateTime(order.createdAt) }}</td>
                    <td>{{ order.customer?.name || 'Consumidor final' }}</td>
                    <td>{{ label(orderTypeLabels, order.type) }}</td>
                    <td>
                      <span class="rp-badge">{{ label(orderStatusLabels, order.status) }}</span>
                    </td>
                    <td class="rp-num">{{ money(order.total) }}</td>
                    <td class="rp-num rp-dim">{{ money(order.paidAmount) }}</td>
                    <td class="rp-num" [class.rp-neg]="balance(order) > 0">
                      {{ money(balance(order)) }}
                    </td>
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr>
                  <td colspan="5">Total de los {{ number(data.orders.length) }} pedidos listados</td>
                  <td class="rp-num">{{ money(ordersTotal()) }}</td>
                  <td class="rp-num">{{ money(ordersPaid()) }}</td>
                  <td class="rp-num">{{ money(ordersTotal() - ordersPaid()) }}</td>
                </tr>
              </tfoot>
            </table>
            @if (ordersCut) {
              <p class="rp-note">
                El rango tiene {{ number(data.ordersTotal) }} pedidos y aquí se listan
                los {{ number(data.orders.length) }} más recientes. Acorta las fechas
                para ver el detalle completo.
              </p>
            }
          }
        </section>

        <!-- Detalle de gastos -->
        <section class="rp-section">
          <h2 class="rp-section-title">
            Detalle de gastos
            <small>
              {{ number(data.expenses.length) }} de {{ number(data.expensesTotal) }} gasto(s) ·
              {{ money(data.expenseSummary.total) }}
            </small>
          </h2>
          @if (data.expenses.length === 0) {
            <p class="rp-empty">Sin gastos en el período.</p>
          } @else {
            <table class="rp-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Categoría</th>
                  <th>Descripción</th>
                  <th>Proveedor</th>
                  <th>Pago</th>
                  <th class="rp-num">Monto</th>
                  <th class="rp-num">Equivalente</th>
                </tr>
              </thead>
              <tbody>
                @for (expense of data.expenses; track expense.id) {
                  <tr>
                    <td class="rp-dim">{{ shortDate(expense.date || expense.createdAt) }}</td>
                    <td>{{ label(expenseCategoryLabels, expense.category) }}</td>
                    <td class="rp-strong">{{ expense.description }}</td>
                    <td class="rp-dim">{{ expense.supplier?.name || '—' }}</td>
                    <td>{{ label(paymentMethodLabels, expense.paymentMethod) }}</td>
                    <td class="rp-num">{{ moneyIn(expense.amount, expense.currency) }}</td>
                    <td class="rp-num rp-dim">{{ money(expense.baseAmount) }}</td>
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr>
                  <td colspan="5">Total de los {{ number(data.expenses.length) }} gastos listados</td>
                  <td colspan="2" class="rp-num">{{ money(expensesSum()) }}</td>
                </tr>
              </tfoot>
            </table>
            @if (expensesCut) {
              <p class="rp-note">
                El rango tiene {{ number(data.expensesTotal) }} gastos y aquí se listan
                los {{ number(data.expenses.length) }} más recientes.
              </p>
            }
          }
        </section>
        <div class="rp-cols">
          <!-- Caja del período -->
          <section class="rp-section">
            <h2 class="rp-section-title">
              Caja
              <small>{{ data.cashSessions.length }} sesión(es)</small>
            </h2>
            @if (data.cashSessions.length === 0) {
              <p class="rp-empty">Sin sesiones de caja en el período.</p>
            } @else {
              <table class="rp-table">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Apertura</th>
                    <th class="rp-num">Fondo</th>
                    <th class="rp-num">Esperado</th>
                    <th class="rp-num">Contado</th>
                    <th class="rp-num">Diferencia</th>
                  </tr>
                </thead>
                <tbody>
                  @for (session of data.cashSessions; track session.id) {
                    <tr>
                      <td class="rp-strong">{{ session.code }}</td>
                      <td class="rp-dim">{{ shortDate(session.openedAt) }}</td>
                      <td class="rp-num">{{ money(session.openingAmount) }}</td>
                      <td class="rp-num">{{ money(session.expectedAmount) }}</td>
                      <td class="rp-num">{{ money(session.countedAmount) }}</td>
                      <td
                        class="rp-num"
                        [class.rp-neg]="(session.difference ?? 0) < 0"
                        [class.rp-pos]="(session.difference ?? 0) > 0"
                      >
                        {{ money(session.difference) }}
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          </section>

          <!-- Inventario: productos por debajo del mínimo -->
          <section class="rp-section">
            <h2 class="rp-section-title">
              Stock bajo
              <small>{{ data.lowStock.length }} producto(s) · estado actual</small>
            </h2>
            @if (data.lowStock.length === 0) {
              <p class="rp-empty">Ningún producto por debajo del mínimo.</p>
            } @else {
              <table class="rp-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Producto</th>
                    <th class="rp-num">Stock</th>
                    <th class="rp-num">Mínimo</th>
                    <th>Unidad</th>
                  </tr>
                </thead>
                <tbody>
                  @for (item of data.lowStock; track item.id) {
                    <tr>
                      <td class="rp-dim">{{ item.sku }}</td>
                      <td class="rp-strong">{{ item.name }}</td>
                      <td class="rp-num rp-neg">{{ number(item.stock) }}</td>
                      <td class="rp-num rp-dim">{{ number(item.minStock) }}</td>
                      <td class="rp-dim">{{ label(unitLabels, item.unit) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          </section>
        </div>
        <!-- Cuentas por cobrar y por pagar (saldo actual) -->
        <section class="rp-section">
          <h2 class="rp-section-title">
            Cuentas por cobrar y por pagar
            <small>Saldo a la fecha del reporte</small>
          </h2>
          <div class="rp-cols">
            <table class="rp-table">
              <thead>
                <tr>
                  <th>Cuentas por cobrar</th>
                  <th class="rp-num">Cuentas</th>
                  <th class="rp-num">Saldo</th>
                </tr>
              </thead>
              <tbody>
                @for (row of data.receivables.byStatus; track row.status) {
                  <tr>
                    <td class="rp-strong">{{ label(accountStatusLabels, row.status) }}</td>
                    <td class="rp-num rp-dim">{{ number(row.count) }}</td>
                    <td class="rp-num">{{ money(row.balance) }}</td>
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr>
                  <td>Pendiente por cobrar ({{ number(data.receivables.openCount) }} abierta/s)</td>
                  <td class="rp-num">—</td>
                  <td class="rp-num">{{ money(data.receivables.openBalance) }}</td>
                </tr>
              </tfoot>
            </table>

            <table class="rp-table">
              <thead>
                <tr>
                  <th>Cuentas por pagar</th>
                  <th class="rp-num">Cuentas</th>
                  <th class="rp-num">Saldo</th>
                </tr>
              </thead>
              <tbody>
                @for (row of data.payables.byStatus; track row.status) {
                  <tr>
                    <td class="rp-strong">{{ label(accountStatusLabels, row.status) }}</td>
                    <td class="rp-num rp-dim">{{ number(row.count) }}</td>
                    <td class="rp-num">{{ money(row.balance) }}</td>
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr>
                  <td>Pendiente por pagar ({{ number(data.payables.openCount) }} abierta/s)</td>
                  <td class="rp-num">—</td>
                  <td class="rp-num">{{ money(data.payables.openBalance) }}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <div class="rp-sign">
          <div>Elaborado por · {{ userName }}</div>
          <div>Revisado por</div>
        </div>

        <footer class="rp-foot">
          <span>
            @if (data.rates.length > 0) {
              <strong>Tasas vigentes:</strong>
              @for (item of data.rates; track item.label) {
                {{ item.label }} {{ rate(item.rate) }} Bs ·
              }
            } @else {
              <strong>Sin tasas cargadas en el sistema</strong>
            }
          </span>
          <span>Generado automáticamente por Nexo Hub · {{ generatedText }}</span>
        </footer>
      </article>
    </div>
  `,
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

  /** Helpers de formato. */
  readonly money = money;
  readonly moneyIn = moneyIn;
  readonly number = number;
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
    return round(this.data.orders.reduce((total, order) => total + Number(order.total ?? 0), 0));
  }

  ordersPaid(): number {
    return round(
      this.data.orders.reduce((total, order) => total + Number(order.paidAmount ?? 0), 0),
    );
  }

  /** Suma en moneda base de los gastos listados. */
  expensesSum(): number {
    return round(
      this.data.expenses.reduce((total, expense) => total + Number(expense.baseAmount ?? 0), 0),
    );
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
    return Math.round((Number(order.total ?? 0) - Number(order.paidAmount ?? 0)) * 100) / 100;
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

/** Redondeo monetario (centavos), igual que en el resto del sistema. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}
