import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { PaginationMeta } from '../../core/models/api.model';
import type {
  CashCurrentResponse,
  CashMovement,
  CashMovementPayload,
  CashOpeningLine,
  CashSession,
  CashSummary,
  CurrencyBreakdown,
} from '../../core/models/operations.model';
import {
  CASH_CATEGORY_LABELS,
  CASH_CATEGORY_OPTIONS,
  CASH_IN_CATEGORIES,
  CASH_OUT_CATEGORIES,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHOD_OPTIONS,
} from '../../core/constants/domain';
import { BASE_CURRENCY, MIXED_CURRENCY_CODE } from '../../core/constants/currency';
import { CurrencySelectComponent } from '../../shared/components/currency-select.component';
import { RateConversionsComponent } from '../../shared/components/rate-conversions.component';
import { RatesService } from '../../core/services/rates.service';
import { CashService } from '../../core/services/cash.service';
import { PreferencesService } from '../../core/services/preferences.service';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmService } from '../../shared/services/confirm.service';
import {
  apiErrorMessage,
  dateTime,
  displayBaseCode,
  displayBaseLabel,
  money,
  moneyIn,
  rate,
  sumMoney,
} from '../../core/utils/format';
import { EmptyStateComponent, LoaderComponent } from '../../shared/components/feedback.component';
import { IconComponent } from '../../shared/components/icon.component';
import { PosComponent } from './pos.component';
import { DialogComponent } from '../../shared/components/dialog.component';
import { MoneyComponent } from '../../shared/components/money.component';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { PaginationComponent } from '../../shared/components/pagination.component';
import { StatCardComponent } from '../../shared/components/stat-card.component';

type CashCategory = CashMovementPayload['category'];

const EMPTY_META: PaginationMeta = {
  total: 0,
  page: 1,
  limit: 20,
  totalPages: 0,
  hasNextPage: false,
  hasPreviousPage: false,
};

/** Pagina de caja: arqueo de la sesion actual, movimientos e historial. */
@Component({
  selector: 'app-cash',
  standalone: true,
  imports: [
    FormsModule,
    IconComponent,
    PageHeaderComponent,
    PaginationComponent,
    DialogComponent,
    StatCardComponent,
    PosComponent,
    MoneyComponent,
    CurrencySelectComponent,
    RateConversionsComponent,
    EmptyStateComponent,
    LoaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (view() === 'arqueo') {
      <app-page-header
        title="Caja"
        subtitle="Control de la sesión de caja y arqueo en vivo"
        icon="wallet"
      >
        <button type="button" class="btn-primary" (click)="openPos()">
          <app-icon name="shopping-cart" size="h-4 w-4" />
          Vista de cajero
        </button>
        @if (session()) {
          <button type="button" class="btn-secondary" (click)="openMovement()">
            <app-icon name="plus" size="h-4 w-4" />
            Registrar movimiento
          </button>
          <button type="button" class="btn-primary" (click)="openClose()">
            <app-icon name="wallet" size="h-4 w-4" />
            Cerrar caja
          </button>
        }
      </app-page-header>
    }

    @if (view() === 'pos') {
      <app-pos (exit)="closePos()" />
    } @else {

    @if (loading()) {
      <app-loader />
    } @else if (!session()) {
      <div class="card mx-auto max-w-lg">
        <div class="card-body space-y-4">
          <div class="flex items-center gap-3">
            <span
              class="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-600"
            >
              <app-icon name="wallet" size="h-6 w-6" />
            </span>
            <div>
              <h2 class="text-lg font-semibold text-slate-900">Abrir caja</h2>
              <p class="text-sm text-slate-500">No hay una sesión de caja abierta.</p>
            </div>
          </div>
          <div class="space-y-3">
            <div class="flex items-center justify-between gap-2">
              <label class="label mb-0">Fondo inicial</label>
              <button
                type="button"
                class="btn-ghost btn-sm"
                [disabled]="openForm.lines.length >= maxOpeningLines"
                (click)="addOpeningLine()"
              >
                <app-icon name="plus" size="h-4 w-4" />
                Agregar moneda
              </button>
            </div>

            @for (line of openForm.lines; track $index) {
              <div class="grid items-start gap-3 sm:grid-cols-[2fr_3fr_auto]">
                <div>
                  <input
                    type="number"
                    class="input"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    [attr.aria-label]="'Monto en ' + line.currency"
                    [(ngModel)]="line.amount"
                  />
                </div>
                <app-currency-select
                  [id]="'opening-currency-' + $index"
                  [showLabel]="false"
                  [(value)]="line.currency"
                  [amount]="line.amount"
                />
                <button
                  type="button"
                  class="btn-ghost btn-sm text-rose-600"
                  [disabled]="openForm.lines.length <= 1"
                  title="Quitar esta moneda del fondo"
                  (click)="removeOpeningLine($index)"
                >
                  <app-icon name="trash" size="h-4 w-4" />
                </button>
              </div>
            }

            <div class="rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <div class="flex items-center justify-between gap-2">
                <span class="text-slate-500">
                  Fondo total
                  @if (openForm.lines.length > 1) {
                    <span class="text-slate-400">
                      ({{ openForm.lines.length }} monedas)
                    </span>
                  }
                </span>
                <app-money [amount]="openingTotal" alignEnd="true" />
              </div>
            </div>

            @if (openingMissingRates.length > 0) {
              <p class="flex items-center gap-1 text-xs text-rose-600">
                <app-icon name="alert" size="h-3.5 w-3.5" />
                Falta la tasa de {{ openingMissingRates.join(', ') }}. Definela en
                Configuración → Monedas para poder contabilizar el fondo.
              </p>
            } @else {
              <p class="text-xs text-slate-400">
                Cuenta el efectivo del cajón en cada moneda: el fondo se guarda en
                {{ baseCurrency.label }} (moneda base) con la tasa del momento para
                poder compararlo con el arqueo.
              </p>
            }
          </div>
          <div>
            <label class="label">Notas de apertura</label>
            <textarea class="input" rows="2" [(ngModel)]="openForm.openingNotes"></textarea>
          </div>
          <button
            type="button"
            class="btn-primary w-full"
            [disabled]="opening()"
            (click)="openCash()"
          >
            {{ opening() ? 'Abriendo…' : 'Abrir caja' }}
          </button>
        </div>
      </div>
    } @else {
      @if (session(); as current) {
        <div class="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <app-icon name="check" size="h-4 w-4" />
          <span>
            Sesión <strong>{{ current.code }}</strong> abierta el
            {{ dateTime(current.openedAt) }}
            @if (current.openedBy) {
              por {{ current.openedBy.name }}
            }
          </span>
        </div>
      }

      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7">
        <app-stat-card
          label="Fondo inicial"
          [value]="session()?.openingAmount ?? 0"
          icon="wallet"
          [isCurrency]="true"
          [hint]="openingStatHint"
        />
        <app-stat-card label="Ingresos" [value]="summary()?.cashIn ?? 0" icon="trend-up" tone="emerald" [isCurrency]="true" />
        <app-stat-card label="Egresos" [value]="summary()?.cashOut ?? 0" icon="trend-down" tone="rose" [isCurrency]="true" />
        <app-stat-card label="Efectivo esperado" [value]="expectedCash" icon="money" tone="brand" [isCurrency]="true" />
        <app-stat-card
          label="Ventas"
          [value]="salesTotal"
          icon="receipt"
          tone="sky"
          [isCurrency]="true"
          hint="sin propinas"
        />
        <app-stat-card
          label="Propinas"
          [value]="tipsTotal"
          icon="money"
          tone="amber"
          [isCurrency]="true"
          hint="no son ventas"
        />
        <app-stat-card label="Movimientos" [value]="summary()?.movementCount ?? 0" icon="chart" tone="slate" />
      </div>

      @if (byMethod.length > 0) {
        <div class="card mt-4">
          <div class="card-header">
            <h2 class="text-sm font-semibold text-slate-900">Desglose por método</h2>
          </div>
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Método</th>
                  <th class="text-right">Ingresos</th>
                  <th class="text-right">Egresos</th>
                  <th class="text-right">Neto</th>
                </tr>
              </thead>
              <tbody>
                @for (row of byMethod; track row.method) {
                  <tr>
                    <td class="font-medium text-slate-900">{{ methodLabels[row.method] || row.method }}</td>
                    <td class="text-right text-emerald-600"><app-money [amount]="row.in" alignEnd="true" /></td>
                    <td class="text-right text-rose-600"><app-money [amount]="row.out" alignEnd="true" /></td>
                    <td class="text-right font-medium"><app-money [amount]="row.net" alignEnd="true" /></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }

      @if (byCurrency.length > 0) {
        <div class="card mt-4">
          <div class="card-header">
            <div>
              <h2 class="text-sm font-semibold text-slate-900">
                Desglose por moneda
              </h2>
              <p class="mt-0.5 text-xs text-slate-500">
                Cuánto entró y salió en cada moneda y su equivalente en
                {{ moneyBaseLabel() }}.
              </p>
            </div>
          </div>
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Moneda</th>
                  <th class="text-right">Ingresos</th>
                  <th class="text-right">Egresos</th>
                  <th class="text-right">Neto</th>
                  <th class="text-right">Neto ({{ moneyBaseCode() }})</th>
                </tr>
              </thead>
              <tbody>
                @for (row of byCurrency; track row.currency) {
                  <tr>
                    <td>
                      <span class="badge bg-slate-100 text-slate-700">
                        {{ row.currency }}
                      </span>
                    </td>
                    <td class="text-right text-emerald-600">
                      {{ amountIn(row.in, row.currency) }}
                    </td>
                    <td class="text-right text-rose-600">
                      {{ amountIn(row.out, row.currency) }}
                    </td>
                    <td class="text-right font-medium">
                      {{ amountIn(row.net, row.currency) }}
                    </td>
                    <td class="text-right font-medium">
                      <app-money [amount]="row.baseNet" alignEnd="true" />
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }
    }

    <div class="card mt-4">
      <div class="card-header">
        <h2 class="text-sm font-semibold text-slate-900">Movimientos de caja</h2>
        <div class="flex flex-wrap items-end gap-3">
          <div>
            <label class="label">Desde</label>
            <input type="date" class="input" [(ngModel)]="movFrom" (ngModelChange)="loadMovements()" />
          </div>
          <div>
            <label class="label">Hasta</label>
            <input type="date" class="input" [(ngModel)]="movTo" (ngModelChange)="loadMovements()" />
          </div>
          <div>
            <label class="label">Tipo</label>
            <select class="input" [(ngModel)]="movType" (ngModelChange)="loadMovements()">
              <option value="">Todos</option>
              @for (option of movementTypeOptions; track option.value) {
                <option [value]="option.value">{{ option.label }}</option>
              }
            </select>
          </div>
          <div>
            <label class="label">Moneda</label>
            <select class="input" [(ngModel)]="movCurrency" (ngModelChange)="loadMovements()">
              <option value="">Todas</option>
              @for (currency of currencies(); track currency.code) {
                <option [value]="currency.code">{{ currency.label }} ({{ currency.code }})</option>
              }
            </select>
          </div>
        </div>
      </div>

      @if (movLoading()) {
        <app-loader />
      } @else if (movItems().length === 0) {
        <app-empty-state
          title="Sin movimientos"
          message="No hay movimientos de caja en el rango seleccionado."
          icon="wallet"
        />
      } @else {
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Categoría</th>
                <th>Tipo</th>
                <th>Método</th>
                <th>Moneda</th>
                <th class="text-right">Monto</th>
                <th class="text-right">Equivalente ({{ moneyBaseCode() }})</th>
                <th>Descripción</th>
                <th>Usuario</th>
                <th class="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              @for (movement of movItems(); track movement.id) {
                <tr>
                  <td>{{ dateTime(movement.createdAt) }}</td>
                  <td>{{ categoryLabels[movement.category] || movement.category }}</td>
                  <td>
                    @if (movement.type === 'IN') {
                      <span class="badge bg-emerald-100 text-emerald-700">Entrada</span>
                    } @else {
                      <span class="badge bg-rose-100 text-rose-700">Salida</span>
                    }
                  </td>
                  <td>{{ methodLabels[movement.paymentMethod] || movement.paymentMethod }}</td>
                  <td>
                    <span class="badge bg-slate-100 text-slate-700">
                      {{ movement.currency || baseCurrency.code }}
                    </span>
                  </td>
                  <td class="text-right font-medium" [class.text-emerald-600]="movement.type === 'IN'" [class.text-rose-600]="movement.type === 'OUT'">
                    {{ amountIn(movement.type === 'IN' ? movement.amount : -movement.amount, movement.currency) }}
                  </td>
                  <td class="text-right" [class.text-emerald-600]="movement.type === 'IN'" [class.text-rose-600]="movement.type === 'OUT'">
                    <app-money
                      [amount]="movement.type === 'IN' ? movement.baseAmount : -movement.baseAmount"
                      alignEnd="true"
                    />
                  </td>
                  <td>{{ movement.description || '—' }}</td>
                  <td>{{ movement.createdBy?.name || '—' }}</td>
                  <td class="text-right">
                    <button
                      type="button"
                      class="btn-ghost btn-sm"
                      (click)="openMovementDetail(movement)"
                    >
                      Ver detalle
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <app-pagination
          [meta]="movMeta()"
          (pageChange)="changeMovPage($event)"
          (limitChange)="changeMovLimit($event)"
        />
      }
    </div>

    <div class="card mt-4">
      <div class="card-header">
        <h2 class="text-sm font-semibold text-slate-900">Historial de sesiones</h2>
      </div>

      @if (sesLoading()) {
        <app-loader />
      } @else if (sesItems().length === 0) {
        <app-empty-state
          title="Sin sesiones"
          message="Aún no se han registrado sesiones de caja."
          icon="wallet"
        />
      } @else {
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Apertura</th>
                <th>Cierre</th>
                <th class="text-right">Fondo</th>
                <th class="text-right">Esperado</th>
                <th class="text-right">Contado</th>
                <th class="text-right">Diferencia</th>
                <th>Usuario</th>
                <th class="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              @for (row of sesItems(); track row.id) {
                <tr>
                  <td class="font-medium text-slate-900">{{ row.code }}</td>
                  <td>{{ dateTime(row.openedAt) }}</td>
                  <td>{{ row.closedAt ? dateTime(row.closedAt) : '—' }}</td>
                  <td class="text-right">
                    <app-money [amount]="row.openingAmount" alignEnd="true" />
                    @if (openingFundHint(row); as hint) {
                      <span class="block text-[10px] text-slate-400">{{ hint }}</span>
                    }
                  </td>
                  <td class="text-right">
                    @if (row.expectedAmount != null) {
                      <app-money [amount]="row.expectedAmount" alignEnd="true" />
                    } @else {
                      —
                    }
                  </td>
                  <td class="text-right">
                    @if (row.countedAmount != null) {
                      <app-money [amount]="row.countedAmount" alignEnd="true" />
                      @if (row.countedCurrency && row.countedCurrency !== baseCurrency.code) {
                        <span class="block text-[10px] text-slate-400">
                          contado en {{ row.countedCurrency }}
                        </span>
                      }
                    } @else {
                      —
                    }
                  </td>
                  <td class="text-right font-medium" [class.text-emerald-600]="(row.difference ?? 0) >= 0" [class.text-rose-600]="(row.difference ?? 0) < 0">
                    @if (row.difference != null) {
                      <app-money [amount]="row.difference" alignEnd="true" />
                    } @else {
                      —
                    }
                  </td>
                  <td>{{ row.openedBy?.name || '—' }}</td>
                  <td class="text-right">
                    <button type="button" class="btn-ghost btn-sm" (click)="openSessionDetail(row)">
                      Ver detalle
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <app-pagination
          [meta]="sesMeta()"
          (pageChange)="changeSesPage($event)"
          (limitChange)="changeSesLimit($event)"
        />
      }
    </div>

    <app-dialog
      [open]="movOpen()"
      [variant]="dialogView()"
      title="Registrar movimiento"
      subtitle="Entradas y salidas de efectivo de la sesión abierta"
      [body]="movementBody"
      [footer]="movementFooter"
      (closed)="closeMovement()"
    />

    <ng-template #movementBody>
      <div class="space-y-4">
        <div>
          <label class="label" for="movement-category">Categoría</label>
          <select
            id="movement-category"
            class="input"
            [(ngModel)]="movForm.category"
            (ngModelChange)="onCategoryChange()"
          >
            @for (option of categoryOptions; track option.value) {
              <option [value]="option.value">{{ option.label }}</option>
            }
          </select>
        </div>

        @if (needsManualType) {
          <div>
            <label class="label" for="movement-type">Tipo</label>
            <select id="movement-type" class="input" [(ngModel)]="movForm.type">
              @for (option of movementTypeOptions; track option.value) {
                <option [value]="option.value">{{ option.label }}</option>
              }
            </select>
          </div>
        }

        <div>
          <label class="label" for="movement-method">Método de pago</label>
          <select id="movement-method" class="input" [(ngModel)]="movForm.paymentMethod">
            @for (option of methodOptions; track option.value) {
              <option [value]="option.value">{{ option.label }}</option>
            }
          </select>
        </div>

        <div class="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
          <div>
            <label class="label" for="movement-amount">Monto</label>
            <input
              id="movement-amount"
              type="number"
              class="input"
              min="0"
              [(ngModel)]="movForm.amount"
            />
          </div>
          <app-currency-select
            id="movement-currency"
            label="Moneda del pago"
            [(value)]="movForm.currency"
            [amount]="movForm.amount"
          />
          <app-rate-conversions
            [amount]="movForm.amount"
            [currency]="movForm.currency"
          />
          <p class="text-xs text-slate-500">
            Se contabiliza en {{ baseCurrency.label }} con la tasa vigente.
          </p>
        </div>

        <div>
          <label class="label" for="movement-description">Descripción</label>
          <input
            id="movement-description"
            class="input"
            [(ngModel)]="movForm.description"
            placeholder="Opcional"
          />
        </div>
      </div>
    </ng-template>

    <ng-template #movementFooter>
      <div class="flex w-full justify-end gap-2">
        <button type="button" class="btn-secondary" (click)="closeMovement()">Cancelar</button>
        <button type="button" class="btn-primary" [disabled]="saving()" (click)="submitMovement()">
          {{ saving() ? 'Guardando…' : 'Registrar' }}
        </button>
      </div>
    </ng-template>

    <app-dialog
      [open]="closeOpen()"
      [variant]="dialogView()"
      title="Cerrar caja"
      subtitle="Cuenta el efectivo del cajón y compáralo con lo esperado"
      [body]="closeBody"
      [footer]="closeFooter"
      (closed)="closeClose()"
    />

    <ng-template #closeBody>
      <div class="space-y-4">
        <div class="space-y-2 rounded-xl border border-slate-200 p-4">
          <p class="label">Ventas del turno</p>
          <div class="flex items-center justify-between gap-3 text-sm">
            <span class="text-slate-500">Ventas (sin propinas)</span>
            <app-money [amount]="salesTotal" alignEnd="true" />
          </div>
          <div class="flex items-center justify-between gap-3 text-sm">
            <span class="text-slate-500">Propinas</span>
            <app-money [amount]="tipsTotal" alignEnd="true" />
          </div>
          <div class="flex items-center justify-between gap-3 border-t border-slate-100 pt-2 text-sm">
            <span class="font-medium text-slate-600">Total cobrado por ventas</span>
            <app-money [amount]="salesGrossTotal" [strong]="true" alignEnd="true" />
          </div>
          <p class="text-xs text-slate-400">
            Las propinas no son ventas: se cobran dentro del pedido y quedan
            separadas del consumo.
          </p>
        </div>

        <div class="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
          <div class="flex items-center justify-between gap-3 text-sm">
            <span class="text-slate-500">Efectivo esperado en el cajón</span>
            <app-money [amount]="expectedCash" alignEnd="true" />
          </div>
          <p class="text-xs text-slate-500">
            Fondo inicial + entradas − salidas, en {{ moneyBaseLabel() }}.
            Incluye las propinas del turno.
          </p>
        </div>

        @if (openingFund.length > 0) {
          <div>
            <p class="label">Fondo inicial por moneda</p>
            <ul
              class="divide-y divide-slate-100 rounded-xl border border-slate-200 text-xs text-slate-600"
            >
              @for (line of openingFund; track line.currency) {
                <li class="flex items-center justify-between gap-3 px-3 py-2">
                  <span class="text-slate-500">Fondo en {{ line.currency }}</span>
                  <span class="text-right">
                    <span class="block font-medium text-slate-800">
                      {{ amountIn(line.amount, line.currency) }}
                    </span>
                    <span class="block text-[10px] text-slate-400">
                      {{ money(line.baseAmount) }} equivalente
                    </span>
                  </span>
                </li>
              }
            </ul>
          </div>
        }

        @if (byCurrency.length > 0) {
          <div>
            <p class="label">Efectivo por moneda</p>
            <ul
              class="divide-y divide-slate-100 rounded-xl border border-slate-200 text-xs text-slate-600"
            >
              @for (row of byCurrency; track row.currency) {
                <li class="flex items-center justify-between gap-3 px-3 py-2">
                  <span class="text-slate-500">Efectivo en {{ row.currency }}</span>
                  <span class="text-right">
                    <span class="block font-medium text-slate-800">
                      {{ amountIn(row.net, row.currency) }}
                    </span>
                    <span class="block text-[10px] text-slate-400">
                      {{ money(row.baseNet) }} equivalente
                    </span>
                  </span>
                </li>
              }
            </ul>
          </div>
        }

        <div>
          <label class="label" for="counted-amount">Monto contado</label>
          <input
            id="counted-amount"
            type="number"
            class="input"
            min="0"
            [(ngModel)]="closeForm.countedAmount"
          />
        </div>

        <app-currency-select
          id="counted-currency"
          label="Moneda contada"
          [(value)]="closeForm.countedCurrency"
          [amount]="closeForm.countedAmount"
        />

        <div
          class="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm"
        >
          <span class="text-slate-500">Diferencia</span>
          <app-money
            [amount]="closeDifference"
            [strong]="true"
            alignEnd="true"
            [class.text-emerald-600]="closeDifference >= 0"
            [class.text-rose-600]="closeDifference < 0"
          />
        </div>

        <div>
          <label class="label" for="closing-notes">Notas de cierre</label>
          <textarea
            id="closing-notes"
            class="input"
            rows="3"
            [(ngModel)]="closeForm.closingNotes"
          ></textarea>
        </div>
      </div>
    </ng-template>

    <ng-template #closeFooter>
      <div class="flex w-full justify-end gap-2">
        <button type="button" class="btn-secondary" (click)="closeClose()">Cancelar</button>
        <button type="button" class="btn-primary" [disabled]="closing()" (click)="submitClose()">
          {{ closing() ? 'Cerrando…' : 'Cerrar caja' }}
        </button>
      </div>
    </ng-template>

    <app-dialog
      [open]="detailOpen()"
      [variant]="dialogView()"
      [title]="'Sesión ' + (detailSession()?.code || '')"
      subtitle="Resumen del turno y movimientos registrados"
      size="lg"
      [body]="detailBody"
      [footer]="detailFooter"
      (closed)="closeSessionDetail()"
    />

    <ng-template #detailBody>
      @if (detailSession(); as detail) {
        <div class="space-y-4">
          <div class="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div class="rounded-lg bg-slate-50 px-3 py-2">
              <p class="text-slate-500">Apertura</p>
              <p class="font-medium">{{ dateTime(detail.openedAt) }}</p>
            </div>
            <div class="rounded-lg bg-slate-50 px-3 py-2">
              <p class="text-slate-500">Cierre</p>
              <p class="font-medium">{{ detail.closedAt ? dateTime(detail.closedAt) : '—' }}</p>
            </div>
            <div class="rounded-lg bg-slate-50 px-3 py-2">
              <p class="text-slate-500">Fondo inicial</p>
              <app-money [amount]="detail.openingAmount" />
              @if ((detail.openingLines?.length ?? 0) > 0) {
                <ul class="mt-1 space-y-0.5 text-[11px] text-slate-500">
                  @for (line of detail.openingLines ?? []; track line.currency) {
                    <li>
                      {{ amountIn(line.amount, line.currency) }}
                      <span class="text-slate-400">
                        ({{ money(line.baseAmount) }})
                      </span>
                    </li>
                  }
                </ul>
              }
            </div>
            <div class="rounded-lg bg-slate-50 px-3 py-2">
              <p class="text-slate-500">Efectivo esperado</p>
              <app-money
                [amount]="detail.expectedAmount ?? detail.summary?.expectedCash ?? 0"
              />
            </div>
            <div class="rounded-lg bg-slate-50 px-3 py-2">
              <p class="text-slate-500">Contado</p>
              @if (detail.countedAmount != null) {
                <app-money [amount]="detail.countedAmount" />
              } @else {
                <p class="font-medium">—</p>
              }
            </div>
            <div class="rounded-lg bg-slate-50 px-3 py-2">
              <p class="text-slate-500">Diferencia</p>
              @if (detail.difference != null) {
                <app-money
                  [amount]="detail.difference"
                  [class.text-emerald-600]="detail.difference >= 0"
                  [class.text-rose-600]="detail.difference < 0"
                />
              } @else {
                <p class="font-medium">—</p>
              }
            </div>
            <div class="rounded-lg bg-slate-50 px-3 py-2">
              <p class="text-slate-500">Ventas</p>
              <app-money [amount]="detail.summary?.salesTotal ?? 0" />
              <p class="text-[11px] text-slate-400">sin propinas</p>
            </div>
            <div class="rounded-lg bg-slate-50 px-3 py-2">
              <p class="text-slate-500">Propinas</p>
              <app-money [amount]="detail.summary?.tipsTotal ?? 0" />
            </div>
            <div class="rounded-lg bg-slate-50 px-3 py-2">
              <p class="text-slate-500">Movimientos</p>
              <p class="font-medium">{{ detail.summary?.movementCount ?? (detail.movements?.length ?? 0) }}</p>
            </div>
          </div>

          @if (detail.closingNotes) {
            <p class="text-sm text-slate-500">Notas de cierre: {{ detail.closingNotes }}</p>
          }

          <p class="label">Movimientos de la sesión</p>

          @if ((detail.movements?.length ?? 0) === 0) {
            <p class="text-sm text-slate-400">Sin movimientos en esta sesión.</p>
          } @else {
            <div class="table-wrap rounded-lg border border-slate-200">
              <table class="table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Categoría</th>
                    <th>Tipo</th>
                    <th>Moneda</th>
                    <th class="text-right">Monto</th>
                    <th class="text-right">Equivalente ({{ moneyBaseCode() }})</th>
                  </tr>
                </thead>
                <tbody>
                  @for (movement of detail.movements ?? []; track movement.id) {
                    <tr>
                      <td>{{ dateTime(movement.createdAt) }}</td>
                      <td>{{ categoryLabels[movement.category] || movement.category }}</td>
                      <td>
                        @if (movement.type === 'IN') {
                          <span class="badge bg-emerald-100 text-emerald-700">Entrada</span>
                        } @else {
                          <span class="badge bg-rose-100 text-rose-700">Salida</span>
                        }
                      </td>
                      <td>
                        <span class="badge bg-slate-100 text-slate-700">
                          {{ movement.currency || baseCurrency.code }}
                        </span>
                      </td>
                      <td class="text-right" [class.text-emerald-600]="movement.type === 'IN'" [class.text-rose-600]="movement.type === 'OUT'">
                        {{ amountIn(movement.amount, movement.currency) }}
                      </td>
                      <td class="text-right font-medium">
                        <app-money [amount]="movement.baseAmount" alignEnd="true" />
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </div>
      }
    </ng-template>

    <ng-template #detailFooter>
      <div class="flex w-full justify-end gap-2">
        <button type="button" class="btn-secondary" (click)="closeSessionDetail()">Cerrar</button>
      </div>
    </ng-template>

    <!-- Detalle de un movimiento: incluye el comprobante de transferencia. -->
    <app-dialog
      [open]="movementDetailOpen()"
      [variant]="dialogView()"
      title="Detalle del movimiento"
      subtitle="Pago, comprobante y datos del registro"
      size="md"
      [body]="movementDetailBody"
      [footer]="movementDetailFooter"
      (closed)="closeMovementDetail()"
    />

    <ng-template #movementDetailBody>
      @if (movementDetail(); as movement) {
        <div class="space-y-4">
          <div class="grid grid-cols-2 gap-3 text-sm">
            <div class="rounded-lg bg-slate-50 px-3 py-2">
              <p class="text-slate-500">Fecha</p>
              <p class="font-medium">{{ dateTime(movement.createdAt) }}</p>
            </div>
            <div class="rounded-lg bg-slate-50 px-3 py-2">
              <p class="text-slate-500">Tipo</p>
              @if (movement.type === 'IN') {
                <span class="badge bg-emerald-100 text-emerald-700">Entrada</span>
              } @else {
                <span class="badge bg-rose-100 text-rose-700">Salida</span>
              }
            </div>
            <div class="rounded-lg bg-slate-50 px-3 py-2">
              <p class="text-slate-500">Categoría</p>
              <p class="font-medium">{{ categoryLabels[movement.category] || movement.category }}</p>
            </div>
            <div class="rounded-lg bg-slate-50 px-3 py-2">
              <p class="text-slate-500">Método de pago</p>
              <p class="font-medium">{{ methodLabels[movement.paymentMethod] || movement.paymentMethod }}</p>
            </div>
            <div class="rounded-lg bg-slate-50 px-3 py-2">
              <p class="text-slate-500">Monto</p>
              <p class="font-medium" [class.text-emerald-600]="movement.type === 'IN'" [class.text-rose-600]="movement.type === 'OUT'">
                {{ amountIn(movement.type === 'IN' ? movement.amount : -movement.amount, movement.currency) }}
              </p>
            </div>
            <div class="rounded-lg bg-slate-50 px-3 py-2">
              <p class="text-slate-500">Equivalente ({{ moneyBaseCode() }})</p>
              <app-money
                [amount]="movement.type === 'IN' ? movement.baseAmount : -movement.baseAmount"
              />
            </div>
            @if (movement.exchangeRate) {
              <div class="rounded-lg bg-slate-50 px-3 py-2">
                <p class="text-slate-500">Tasa aplicada</p>
                <p class="font-medium">{{ rate(movement.exchangeRate) }}</p>
              </div>
            }
            <div class="rounded-lg bg-slate-50 px-3 py-2">
              <p class="text-slate-500">Registrado por</p>
              <p class="font-medium">{{ movement.createdBy?.name || '—' }}</p>
            </div>
          </div>

          <div class="rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <p class="text-slate-500">Descripción</p>
            <p class="font-medium">{{ movement.description || '—' }}</p>
          </div>

          @if (movement.paymentReference || movement.paymentPhotoUrl) {
            <div class="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p class="text-xs font-semibold uppercase tracking-wide text-amber-800">
                Comprobante de transferencia / pago móvil
              </p>
              <div class="text-sm">
                <p class="text-slate-500">Referencia bancaria</p>
                <p class="font-mono text-base font-semibold tracking-wider text-slate-900">
                  {{ movement.paymentReference || '—' }}
                </p>
              </div>
              @if (movement.paymentPhotoUrl) {
                <button
                  type="button"
                  class="block w-full overflow-hidden rounded-lg border border-amber-200 bg-white"
                  [attr.aria-expanded]="movementPhotoExpanded()"
                  (click)="toggleMovementPhoto()"
                >
                  <img
                    [src]="movement.paymentPhotoUrl"
                    alt="Comprobante de pago"
                    class="w-full object-contain"
                    [class.max-h-72]="!movementPhotoExpanded()"
                  />
                </button>
                <button
                  type="button"
                  class="btn-ghost btn-sm px-2 text-amber-800"
                  (click)="toggleMovementPhoto()"
                >
                  <app-icon [name]="movementPhotoExpanded() ? 'close' : 'eye'" size="h-4 w-4" />
                  {{ movementPhotoExpanded() ? 'Reducir comprobante' : 'Ver comprobante en tamaño completo' }}
                </button>
              } @else {
                <p class="text-xs text-slate-500">El cobro no tiene foto adjunta.</p>
              }
            </div>
          }
        </div>
      }
    </ng-template>

    <ng-template #movementDetailFooter>
      <div class="flex w-full justify-end gap-2">
        <button type="button" class="btn-secondary" (click)="closeMovementDetail()">Cerrar</button>
      </div>
    </ng-template>
    }
  `,
})
export class CashPage implements OnInit {
  private readonly cash = inject(CashService);
  private readonly toast = inject(ToastService);
  private readonly rates = inject(RatesService);
  private readonly confirm = inject(ConfirmService);
  private readonly preferences = inject(PreferencesService);

  readonly dateTime = dateTime;
  readonly moneyIn = moneyIn;
  /** Monto (guardado en USD) en la moneda base con la que se muestran los montos. */
  readonly money = money;
  /** Código de la moneda base con la que se muestran los montos (USD por defecto). */
  readonly moneyBaseCode = displayBaseCode;
  /** Nombre de esa moneda: los equivalentes que pinta la pantalla van en ella. */
  readonly moneyBaseLabel = displayBaseLabel;
  readonly rate = rate;
  readonly baseCurrency = BASE_CURRENCY;
  /**
   * Cómo presenta la caja sus formularios (modal o panel lateral). El usuario lo
   * elige en Configuración → «Formularios de caja y pedidos».
   */
  readonly dialogView = this.preferences.dialogView;
  /** Monedas configuradas (para el filtro del historial). */
  readonly currencies = this.rates.currencies;

  /**
   * Vista activa de la caja: el arqueo del turno o el punto de venta del cajero
   * (misma sesión, cobros y pedidos).
   */
  readonly view = signal<'arqueo' | 'pos'>('arqueo');

  /** Abre el punto de venta dentro de la caja. */
  openPos(): void {
    this.view.set('pos');
  }

  /** Vuelve al arqueo y refresca los totales tras cobrar en el POS. */
  closePos(): void {
    this.view.set('arqueo');
    this.load();
    this.loadMovements();
  }
  readonly categoryLabels = CASH_CATEGORY_LABELS;
  /**
   * Categorias del movimiento manual. `CHANGE` (vuelto) lo genera el cobro de un
   * pedido con su metodo y moneda; no se captura a mano.
   */
  readonly categoryOptions = CASH_CATEGORY_OPTIONS.filter(
    (option) => option.value !== 'CHANGE',
  );
  readonly methodLabels = PAYMENT_METHOD_LABELS;
  readonly methodOptions = PAYMENT_METHOD_OPTIONS;
  readonly movementTypeOptions = [
    { value: 'IN', label: 'Entrada' },
    { value: 'OUT', label: 'Salida' },
  ];

  readonly loading = signal(false);
  readonly session = signal<CashSession | null>(null);
  readonly summary = signal<CashSummary | null>(null);

  readonly opening = signal(false);
  /** Máximo de monedas distintas por fondo (igual que el límite del backend). */
  readonly maxOpeningLines = 8;
  /** Una línea por cada moneda contada en el cajón al abrir la caja. */
  openForm: {
    lines: { currency: string; amount: number }[];
    openingNotes: string;
  } = { lines: [{ currency: BASE_CURRENCY.code as string, amount: 0 }], openingNotes: '' };

  readonly movOpen = signal(false);
  readonly saving = signal(false);
  movForm = {
    category: 'SALE' as CashCategory,
    type: 'IN' as 'IN' | 'OUT',
    paymentMethod: 'CASH',
    amount: 0,
    currency: BASE_CURRENCY.code as string,
    description: '',
  };

  readonly closeOpen = signal(false);
  readonly closing = signal(false);
  closeForm = {
    countedAmount: 0,
    countedCurrency: BASE_CURRENCY.code as string,
    closingNotes: '',
  };

  readonly movItems = signal<CashMovement[]>([]);
  readonly movMeta = signal<PaginationMeta>(EMPTY_META);
  readonly movLoading = signal(false);
  movFrom = '';
  movTo = '';
  movType = '';
  /** Filtro por moneda del historial de movimientos. */
  movCurrency = '';
  private movPage = 1;
  private movLimit = 20;

  readonly sesItems = signal<CashSession[]>([]);
  readonly sesMeta = signal<PaginationMeta>(EMPTY_META);
  readonly sesLoading = signal(false);
  private sesPage = 1;
  private sesLimit = 10;

  readonly detailOpen = signal(false);
  readonly detailSession = signal<CashSession | null>(null);

  readonly movementDetailOpen = signal(false);
  readonly movementDetail = signal<CashMovement | null>(null);
  /** El comprobante se muestra pequeño y se expande dentro del mismo dialogo. */
  readonly movementPhotoExpanded = signal(false);

  ngOnInit(): void {
    this.load();
    this.loadMovements();
    this.loadSessions();
  }

  load(): void {
    this.loading.set(true);
    this.cash.current().subscribe({
      next: (response) => {
        const payload = response as CashCurrentResponse | CashSession | null;
        const session =
          payload && 'status' in payload
            ? (payload as CashSession)
            : ((payload as CashCurrentResponse | null)?.session ?? null);
        const summary =
          payload && 'status' in payload
            ? ((payload as CashSession).summary ?? null)
            : ((payload as CashCurrentResponse | null)?.summary ?? null);
        this.session.set(session && session.status === 'OPEN' ? session : null);
        this.summary.set(session ? summary : null);
        this.loading.set(false);
      },
      error: () => {
        this.session.set(null);
        this.summary.set(null);
        this.loading.set(false);
      },
    });
  }

  get expectedCash(): number {
    const summary = this.summary();
    if (summary) return summary.expectedCash;
    return this.session()?.openingAmount ?? 0;
  }

  /** Ventas del turno sin propinas (moneda base). */
  get salesTotal(): number {
    return this.summary()?.salesTotal ?? 0;
  }

  /**
   * Propinas cobradas en el turno (moneda base). No son ventas: entran dentro
   * del cobro del pedido y el backend las separa del consumo en el arqueo.
   */
  get tipsTotal(): number {
    return this.summary()?.tipsTotal ?? 0;
  }

  /** Ventas + propinas: lo que entró por ventas en el turno. */
  get salesGrossTotal(): number {
    return sumMoney([this.salesTotal, this.tipsTotal]);
  }

  get byMethod(): { method: string; in: number; out: number; net: number }[] {
    return this.summary()?.byMethod ?? [];
  }

  /** Efectivo por moneda (montos originales + equivalente en la moneda base). */
  get byCurrency(): CurrencyBreakdown[] {
    return this.summary()?.byCurrency ?? [];
  }

  /** Fondo inicial contado en la sesión abierta, moneda por moneda. */
  get openingFund(): CashOpeningLine[] {
    return this.summary()?.openingByCurrency ?? [];
  }

  /** Líneas del fondo con monto (lo que se envía al abrir la caja). */
  get openingLines(): { currency: string; amount: number }[] {
    return this.openForm.lines
      .map((line) => ({
        currency: line.currency,
        amount: Number(line.amount) || 0,
      }))
      .filter((line) => line.amount > 0);
  }

  /** Fondo total de la apertura expresado en la moneda base (USD). */
  get openingTotal(): number {
    return sumMoney(
      this.openForm.lines.map(
        (line) => this.rates.toBase(Number(line.amount) || 0, line.currency) ?? 0,
      ),
    );
  }

  /** Monedas del fondo sin tasa disponible (no se pueden contabilizar). */
  get openingMissingRates(): string[] {
    return this.openForm.lines
      .filter(
        (line) =>
          (Number(line.amount) || 0) > 0 &&
          this.rates.toBase(1, line.currency) === null,
      )
      .map((line) => line.currency);
  }

  /** Resumen del fondo contado para la tarjeta del arqueo. */
  get openingStatHint(): string | undefined {
    const lines = this.session()?.openingLines ?? [];
    if (lines.length === 0) return undefined;
    return lines.length === 1
      ? `contado en ${lines[0].currency}`
      : `contado en ${lines.length} monedas`;
  }

  /** Texto del fondo de una sesión del historial (una o varias monedas). */
  openingFundHint(sessionRow: CashSession): string | null {
    const lines = Array.isArray(sessionRow.openingLines)
      ? sessionRow.openingLines
      : [];
    const counted = (code: string): string =>
      sessionRow.openingRate
        ? `contado en ${code} · × ${rate(sessionRow.openingRate)}`
        : `contado en ${code}`;

    if (lines.length > 1) {
      return `fondo en ${lines.length} monedas · ${lines
        .map((line) => line.currency)
        .join(' + ')}`;
    }
    if (lines.length === 1) return counted(lines[0].currency);

    // Sesiones anteriores al fondo multimoneda: la moneda viene en el campo.
    const code = sessionRow.openingCurrency;
    if (!code || code === BASE_CURRENCY.code || code === MIXED_CURRENCY_CODE) {
      return null;
    }
    return counted(code);
  }

  /** Agrega una línea al fondo, en la primera moneda que aún no se usa. */
  addOpeningLine(): void {
    if (this.openForm.lines.length >= this.maxOpeningLines) return;
    this.openForm.lines = [
      ...this.openForm.lines,
      { currency: this.nextOpeningCurrency(), amount: 0 },
    ];
  }

  removeOpeningLine(index: number): void {
    if (this.openForm.lines.length <= 1) return;
    this.openForm.lines = this.openForm.lines.filter(
      (_, position) => position !== index,
    );
  }

  /** Moneda sugerida para una línea nueva del fondo. */
  private nextOpeningCurrency(): string {
    const used = this.openForm.lines.map((line) => line.currency);
    const free = this.rates
      .enabledCurrencies()
      .find((item) => !used.includes(item.code));
    return free?.code ?? BASE_CURRENCY.code;
  }

  /** Deja el formulario de apertura como nuevo. */
  private resetOpenForm(): void {
    this.openForm = {
      lines: [{ currency: BASE_CURRENCY.code as string, amount: 0 }],
      openingNotes: '',
    };
  }

  /** Formatea un monto en la moneda indicada. */
  amountIn(value: number | null | undefined, currency?: string | null): string {
    return moneyIn(value, currency);
  }

  /**
   * Abre la caja con el fondo contado en una o varias monedas. Si no se indica
   * ningún monto se confirma la apertura sin fondo (fondo 0).
   */
  async openCash(): Promise<void> {
    if (this.opening()) return;

    if (this.openingMissingRates.length > 0) {
      this.toast.error(
        `Falta la tasa de ${this.openingMissingRates.join(', ')}. Configúrala en Configuración → Monedas.`,
      );
      return;
    }

    const lines = this.openingLines;
    if (lines.length === 0) {
      const confirmed = await this.confirm.ask({
        title: 'Abrir caja sin fondo',
        message:
          'No indicaste ningún monto en el fondo inicial. ¿Abrir la caja con fondo 0?',
        confirmLabel: 'Abrir sin fondo',
      });
      if (!confirmed) return;
    }

    this.opening.set(true);
    this.cash
      .open({
        openingAmount: this.openingTotal,
        openingLines: lines,
        openingNotes: this.openForm.openingNotes || undefined,
      })
      .subscribe({
        next: () => {
          this.opening.set(false);
          this.toast.success('Caja abierta');
          this.resetOpenForm();
          this.load();
        },
        error: (error) => {
          this.opening.set(false);
          this.toast.error(apiErrorMessage(error));
        },
      });
  }

  get needsManualType(): boolean {
    return (
      !CASH_IN_CATEGORIES.includes(this.movForm.category) &&
      !CASH_OUT_CATEGORIES.includes(this.movForm.category)
    );
  }

  onCategoryChange(): void {
    if (CASH_IN_CATEGORIES.includes(this.movForm.category)) {
      this.movForm.type = 'IN';
    } else if (CASH_OUT_CATEGORIES.includes(this.movForm.category)) {
      this.movForm.type = 'OUT';
    }
  }

  openMovement(): void {
    this.movForm = {
      category: 'SALE',
      type: 'IN',
      paymentMethod: 'CASH',
      amount: 0,
      currency: BASE_CURRENCY.code,
      description: '',
    };
    this.movOpen.set(true);
  }

  closeMovement(): void {
    this.movOpen.set(false);
  }

  submitMovement(): void {
    if (this.saving()) return;
    const amount = Number(this.movForm.amount);
    if (!(amount > 0)) {
      this.toast.error('El monto debe ser mayor a 0');
      return;
    }
    this.saving.set(true);
    const payload: CashMovementPayload = {
      category: this.movForm.category,
      paymentMethod: this.movForm.paymentMethod as CashMovementPayload['paymentMethod'],
      amount,
      currency: this.movForm.currency || undefined,
      description: this.movForm.description || undefined,
    };
    if (this.needsManualType) payload.type = this.movForm.type;
    this.cash.addMovement(payload).subscribe({
      next: () => {
        this.saving.set(false);
        this.toast.success('Movimiento registrado');
        this.closeMovement();
        this.load();
        this.loadMovements();
      },
      error: (error) => {
        this.saving.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  openClose(): void {
    this.closeForm = {
      countedAmount: this.expectedCash,
      countedCurrency: BASE_CURRENCY.code,
      closingNotes: '',
    };
    this.closeOpen.set(true);
  }

  closeClose(): void {
    this.closeOpen.set(false);
  }

  get closeDifference(): number {
    return Number((Number(this.closeForm.countedAmount) - this.expectedCash).toFixed(2));
  }

  submitClose(): void {
    if (this.closing()) return;
    this.closing.set(true);
    this.cash
      .close({
        countedAmount: Number(this.closeForm.countedAmount) || 0,
        countedCurrency: this.closeForm.countedCurrency || undefined,
        closingNotes: this.closeForm.closingNotes || undefined,
      })
      .subscribe({
        next: () => {
          this.closing.set(false);
          this.toast.success('Caja cerrada');
          this.closeClose();
          this.load();
          this.loadSessions();
        },
        error: (error) => {
          this.closing.set(false);
          this.toast.error(apiErrorMessage(error));
        },
      });
  }

  loadMovements(): void {
    this.movLoading.set(true);
    this.cash
      .movements({
        page: this.movPage,
        limit: this.movLimit,
        from: this.movFrom || undefined,
        to: this.movTo || undefined,
        type: this.movType || undefined,
        currency: this.movCurrency || undefined,
      })
      .subscribe({
        next: (response) => {
          this.movItems.set(response.items);
          this.movMeta.set(response.meta);
          this.movLoading.set(false);
        },
        error: () => this.movLoading.set(false),
      });
  }

  changeMovPage(page: number): void {
    this.movPage = page;
    this.loadMovements();
  }

  changeMovLimit(limit: number): void {
    this.movLimit = limit;
    this.movPage = 1;
    this.loadMovements();
  }

  loadSessions(): void {
    this.sesLoading.set(true);
    this.cash.sessions({ page: this.sesPage, limit: this.sesLimit }).subscribe({
      next: (response) => {
        this.sesItems.set(response.items);
        this.sesMeta.set(response.meta);
        this.sesLoading.set(false);
      },
      error: () => this.sesLoading.set(false),
    });
  }

  changeSesPage(page: number): void {
    this.sesPage = page;
    this.loadSessions();
  }

  changeSesLimit(limit: number): void {
    this.sesLimit = limit;
    this.sesPage = 1;
    this.loadSessions();
  }

  openSessionDetail(sessionRow: CashSession): void {
    this.detailSession.set(sessionRow);
    this.detailOpen.set(true);
    this.cash.session(sessionRow.id).subscribe({
      next: (detail) => this.detailSession.set(detail),
    });
  }

  openMovementDetail(movement: CashMovement): void {
    this.movementDetail.set(movement);
    this.movementPhotoExpanded.set(false);
    this.movementDetailOpen.set(true);
  }

  toggleMovementPhoto(): void {
    this.movementPhotoExpanded.update((expanded) => !expanded);
  }

  closeMovementDetail(): void {
    this.movementDetailOpen.set(false);
    this.movementDetail.set(null);
    this.movementPhotoExpanded.set(false);
  }

  closeSessionDetail(): void {
    this.detailOpen.set(false);
    this.detailSession.set(null);
  }
}
