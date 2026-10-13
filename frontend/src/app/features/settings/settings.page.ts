import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  BASE_CURRENCY,
  BASE_CURRENCY_CODE,
  CURRENCY_CATALOG,
  LOCAL_CURRENCY_CODE,
  RATE_META,
  currencyMeta,
  isDefaultCurrency,
} from '../../core/constants/currency';
import type { CurrencySettingPayload } from '../../core/models/currencies.model';
import type { CurrencyRateOption, CurrencyRateSource, RateKey } from '../../core/models/rates.model';
import type {
  Company,
  CompanyPayload,
  UpdateProfilePayload,
} from '../../core/models/api.model';
import { AuthService } from '../../core/services/auth.service';
import { CompaniesService } from '../../core/services/companies.service';
import { CurrenciesService } from '../../core/services/currencies.service';
import { PreferencesService, type DialogView } from '../../core/services/preferences.service';
import { ThemeService, type Theme } from '../../core/services/theme.service';
import { RatesService } from '../../core/services/rates.service';
import { ToastService } from '../../core/services/toast.service';
import { bs, dateTime, rate, signedPercent, apiErrorMessage } from '../../core/utils/format';
import { toLogoDataUrl } from '../../core/utils/image';
import { EmptyStateComponent, LoaderComponent } from '../../shared/components/feedback.component';
import { IconComponent } from '../../shared/components/icon.component';
import { ModalComponent } from '../../shared/components/modal.component';
import { MoneyComponent } from '../../shared/components/money.component';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { ConfirmService } from '../../shared/services/confirm.service';

/**
 * Pestañas de Configuración: cada una agrupa una de las secciones de la pantalla.
 *
 * `rates` muestra el estado de las tasas, `appearance` las preferencias de
 * interfaz, `company` los datos de la empresa activa y `profile` los del usuario.
 */
export type SettingsSection = 'rates' | 'appearance' | 'company' | 'profile';

/**
 * Configuración del sistema, dividida en pestañas (Tasas, Apariencia, Empresa y
 * Mis datos) para no mezclar formularios ni obligar a bajar por toda la página.
 *
 * La pestaña «Tasas» muestra las tasas del BCV (dólar y euro) tal cual las
 * publica dolarvzla —solo lectura— y permite guardar una **tasa
 * personalizada**. Las tasas activas son 2 mientras no exista la personalizada y
 * 3 cuando se define; con cualquiera de ellas la interfaz muestra todos los
 * montos "al cambio".
 */
/** Fila editable de la tabla de monedas aceptadas. */
interface CurrencyRow {
  code: string;
  label: string;
  symbol: string;
  enabled: boolean;
  /** Tasa en bolívares por unidad (texto editable; vacío = usar la del BCV). */
  rate: string;
  /** Bolívares por 1 unidad que el sistema está usando ahora mismo. */
  bsPerUnit: number | null;
  /** De dónde sale esa tasa: BCV, personalizada, manual o el propio bolívar. */
  source: CurrencyRateSource;
  isBase: boolean;
  /** Moneda por defecto (USD, VES, EUR): no se puede quitar, solo desactivar. */
  isDefault: boolean;
}

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    FormsModule,
    IconComponent,
    PageHeaderComponent,
    MoneyComponent,
    LoaderComponent,
    EmptyStateComponent,
    ModalComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header title="Configuración" [subtitle]="activeHint()" icon="settings">
      @if (section() === 'rates') {
        <button
          type="button"
          class="btn-secondary"
          [disabled]="loading()"
          (click)="refresh()"
        >
          <app-icon name="refresh" size="h-4 w-4" />
          Actualizar tasas
        </button>
      }
    </app-page-header>

    <!-- Pestañas: cada una pinta solo su sección, así no se mezclan los
         formularios ni hay que bajar por toda la página. Las flechas del teclado
         también cambian de pestaña (patrón tablist de ARIA). -->
    <nav class="mb-4" role="tablist" aria-label="Secciones de configuración">
      <div class="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-card">
        @for (tab of tabs; track tab.value) {
          <button
            type="button"
            role="tab"
            [id]="tab.value + '-tab'"
            [attr.aria-controls]="tab.value + '-panel'"
            [attr.aria-selected]="section() === tab.value"
            [attr.tabindex]="section() === tab.value ? 0 : -1"
            class="flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-brand-300"
            [class]="
              section() === tab.value
                ? 'bg-brand-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-700'
            "
            (click)="setSection(tab.value)"
            (keydown)="onTabKeydown($event, tab.value)"
          >
            <app-icon [name]="tab.icon" size="h-4 w-4" />
            {{ tab.label }}
          </button>
        }
      </div>
    </nav>

    <div
      role="tabpanel"
      [id]="section() + '-panel'"
      [attr.aria-labelledby]="section() + '-tab'"
      tabindex="0"
      class="focus:outline-none"
    >
      <!-- Sección: Apariencia -->
      @if (section() === 'appearance') {

        <!-- Apariencia: modo claro u oscuro para toda la interfaz. -->
        <section class="card mb-4">
          <div class="card-header">
            <div>
              <h2 class="text-sm font-semibold text-slate-900">Apariencia</h2>
              <p class="mt-0.5 text-xs text-slate-500">
                Modo claro u oscuro de todo el sistema: pantallas, tablas y formularios. Se
                guarda en este navegador.
              </p>
            </div>
            <span class="badge bg-slate-100 text-slate-600">{{ themeLabel() }}</span>
          </div>

          <div class="card-body grid gap-3 sm:grid-cols-2">
            @for (option of themeOptions; track option.value) {
              <button
                type="button"
                class="flex items-start gap-3 rounded-xl border px-4 py-3 text-left transition"
                [class]="
                  theme() === option.value
                    ? 'border-brand-300 bg-brand-50/60'
                    : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                "
                [attr.aria-pressed]="theme() === option.value"
                (click)="setTheme(option.value)"
              >
                <app-icon
                  [name]="option.icon"
                  size="h-5 w-5 shrink-0"
                  [class]="theme() === option.value ? 'text-brand-600' : 'text-slate-400'"
                />
                <span class="min-w-0">
                  <span class="block text-sm font-semibold text-slate-900">
                    {{ option.label }}
                  </span>
                  <span class="mt-0.5 block text-xs text-slate-500">{{ option.hint }}</span>
                </span>
              </button>
            }
          </div>
        </section>

        <!-- Formularios de caja y pedidos: elegir cómo se abren. -->
        <section class="card mb-4">
          <div class="card-header">
            <div>
              <h2 class="text-sm font-semibold text-slate-900">
                Formularios de caja y pedidos
              </h2>
              <p class="mt-0.5 text-xs text-slate-500">
                Cómo se abren los formularios de caja y de pedidos. Se guarda en este navegador.
              </p>
            </div>
            <span class="badge bg-slate-100 text-slate-600">{{ dialogViewLabel() }}</span>
          </div>

          <div class="card-body grid gap-3 sm:grid-cols-2">
            @for (option of dialogViewOptions; track option.value) {
              <button
                type="button"
                class="flex items-start gap-3 rounded-xl border px-4 py-3 text-left transition"
                [class]="
                  dialogView() === option.value
                    ? 'border-brand-300 bg-brand-50/60'
                    : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                "
                [attr.aria-pressed]="dialogView() === option.value"
                (click)="setDialogView(option.value)"
              >
                <app-icon
                  [name]="option.icon"
                  size="h-5 w-5 shrink-0"
                  [class]="dialogView() === option.value ? 'text-brand-600' : 'text-slate-400'"
                />
                <span class="min-w-0">
                  <span class="block text-sm font-semibold text-slate-900">
                    {{ option.label }}
                  </span>
                  <span class="mt-0.5 block text-xs text-slate-500">{{ option.hint }}</span>
                </span>
              </button>
            }
          </div>
        </section>

      }

      <!-- Sección: Tasas -->
      @if (section() === 'rates') {

        @if (loading() && !snapshot()) {
          <app-loader label="Consultando las tasas del BCV…" />
        } @else if (!snapshot()) {
          <app-empty-state
            title="Sin tasas disponibles"
            message="No se pudieron obtener las tasas del BCV. Verifica la conexión e inténtalo de nuevo."
            icon="alert"
          >
            <button type="button" class="btn-primary" (click)="refresh()">Reintentar</button>
          </app-empty-state>
        } @else {
          @if (stale()) {
            <div class="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <app-icon name="alert" size="h-5 w-5 shrink-0" />
              <p>
                No se pudo consultar el BCV en este momento: se muestra la última tasa
                conocida ({{ lastUpdate() }}).
              </p>
            </div>
          }

          <div class="grid gap-4 lg:grid-cols-3">
            <section class="card lg:col-span-2">
              <div class="card-header">
                <div>
                  <h2 class="text-sm font-semibold text-slate-900">Tasas BCV (solo lectura)</h2>
                  <p class="mt-0.5 text-xs text-slate-500">
                    Última consulta: {{ lastUpdate() }}
                  </p>
                </div>
                <span class="badge bg-sky-100 text-sky-700">
                  <app-icon name="info" size="h-3.5 w-3.5" />
                  {{ bcv()?.current?.date }}
                </span>
              </div>

              <div class="table-wrap">
                <table class="table">
                  <thead>
                    <tr>
                      <th>Moneda</th>
                      <th class="text-right">Tasa (Bs)</th>
                      <th class="text-right">Tasa anterior</th>
                      <th class="text-right">Variación</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of bcvRows(); track row.key) {
                      <tr>
                        <td>
                          <span class="flex items-center gap-2">
                            <span class="badge" [class]="rateMeta[row.key].badge">
                              {{ rateMeta[row.key].label }}
                            </span>
                            <span class="text-xs text-slate-500">{{ row.currency }}</span>
                          </span>
                        </td>
                        <td class="text-right font-semibold text-slate-900">{{ rate(row.rate) }}</td>
                        <td class="text-right text-slate-500">
                          {{ row.previousRate ? rate(row.previousRate) : '—' }}
                        </td>
                        <td class="text-right" [class]="variationClass(row.changePercentage)">
                          {{ signedPercent(row.changePercentage) }}
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>

              <div class="border-t border-slate-200 px-5 py-3 text-[11px] text-slate-400">
                Fuente:
                <a class="underline" [href]="bcv()?.sourceUrl" target="_blank" rel="noopener">
                  {{ bcv()?.sourceUrl }}
                </a>
                · valores publicados por el Banco Central de Venezuela, sin edición.
              </div>
            </section>
            <section class="card">
              <div class="card-header">
                <h2 class="text-sm font-semibold text-slate-900">Tasa personalizada</h2>
                @if (hasCustom()) {
                  <span class="badge bg-amber-100 text-amber-700">Activa</span>
                } @else {
                  <span class="badge bg-slate-100 text-slate-600">No definida</span>
                }
              </div>
              <div class="card-body space-y-3">
                <div>
                  <label class="label" for="custom-rate">Bolívares por dólar</label>
                  <input
                    id="custom-rate"
                    type="number"
                    class="input"
                    min="0"
                    step="0.0001"
                    placeholder="Ej. 905.5000"
                    [disabled]="!canManage()"
                    [ngModel]="customInput"
                    (ngModelChange)="customInput = $event; dirty = true"
                  />
                  @if (hasCustom()) {
                    <p class="mt-1 text-xs text-slate-500">
                      Guardada por {{ custom()?.updatedBy ?? 'el sistema' }} el
                      {{ customUpdatedAt() }}
                    </p>
                  } @else {
                    <p class="mt-1 text-xs text-slate-500">
                      Mientras no definas una tasa personalizada solo se muestran las dos
                      tasas del BCV (dólar y euro).
                    </p>
                  }
                </div>

                @if (canManage()) {
                  <div class="flex flex-wrap gap-2">
                    <button
                      type="button"
                      class="btn-primary"
                      [disabled]="saving"
                      (click)="saveCustom()"
                    >
                      <app-icon name="check" size="h-4 w-4" />
                      Guardar tasa
                    </button>
                    @if (hasCustom()) {
                      <button
                        type="button"
                        class="btn-danger"
                        [disabled]="saving"
                        (click)="clearCustom()"
                      >
                        <app-icon name="trash" size="h-4 w-4" />
                        Eliminar
                      </button>
                    }
                  </div>
                } @else {
                  <p class="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                    Solo Administrador y Encargado pueden editar la tasa personalizada.
                  </p>
                }

                <p class="rounded-lg bg-brand-50/60 px-3 py-2 text-xs text-slate-600">
                  <span class="font-semibold">Tasas activas: {{ rates().length }}</span>
                  — {{ hasCustom() ? 'BCV dólar, BCV euro y personalizada' : 'BCV dólar y BCV euro' }}.
                </p>
              </div>
            </section>

          </div>

          <!-- Tasa USDT/VES de una fuente externa: solo informativa. -->
          <section class="card mt-4">
            <div class="card-header">
              <div>
                <h2 class="text-sm font-semibold text-slate-900">Tasa USDT de referencia</h2>
                <p class="mt-0.5 text-xs text-slate-500">
                  Tasa del mercado (Binance P2P). Es solo informativa: no se usa para
                  calcular montos ni aparece en los montos al cambio.
                </p>
              </div>
              @if (reference(); as ref) {
                <span class="badge bg-slate-100 text-slate-600">{{ ref.label }}</span>
              }
            </div>

            @if (reference(); as ref) {
              <div class="card-body grid gap-4 sm:grid-cols-3">
                <div>
                  <p class="text-xs text-slate-500">Par</p>
                  <p class="mt-1 text-sm font-semibold text-slate-900">{{ ref.pair }}</p>
                </div>
                <div>
                  <p class="text-xs text-slate-500">Tasa (Bs por USDT)</p>
                  <p class="mt-1 text-lg font-semibold text-slate-900">
                    {{ rate(ref.price) }}
                  </p>
                </div>
                <div>
                  <p class="text-xs text-slate-500">Publicada</p>
                  <p class="mt-1 text-sm text-slate-700">{{ referenceAsOf() }}</p>
                </div>

                @if (ref.stale) {
                  <div
                    class="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 sm:col-span-3"
                  >
                    <app-icon name="alert" size="h-4 w-4 shrink-0" />
                    <p>
                      No se pudo consultar la fuente en este momento: se muestra la
                      última tasa conocida.
                    </p>
                  </div>
                }

                <p class="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 sm:col-span-3">
                  Fuente: {{ ref.source }} · {{ ref.method }} — consultada el
                  {{ referenceFetchedAt() }}.
                  <a class="underline" [href]="ref.sourceUrl" target="_blank" rel="noopener">
                    Ver fuente
                  </a>
                </p>
              </div>
            } @else {
              <div class="card-body text-sm text-slate-500">
                No se pudo obtener la tasa USDT de referencia en este momento.
              </div>
            }
          </section>

          <div class="mt-4 grid gap-4 lg:grid-cols-3">
            <section class="card lg:col-span-2">
              <div class="card-header">
                <div>
                  <h2 class="text-sm font-semibold text-slate-900">
                    Tasas activas para los montos al cambio
                  </h2>
                  <p class="mt-0.5 text-xs text-slate-500">
                    Con estas tasas se muestra el equivalente en bolívares de cada monto.
                  </p>
                </div>
                <span class="badge bg-brand-50 text-brand-700">{{ rates().length }} tasas</span>
              </div>

              <div class="table-wrap">
                <table class="table">
                  <thead>
                    <tr>
                      <th>Tasa</th>
                      <th>Fuente</th>
                      <th>Fecha</th>
                      <th class="text-right">Bs por unidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of rates(); track row.key) {
                      <tr>
                        <td>
                          <span class="flex items-center gap-2">
                            <span class="badge" [class]="rateMeta[row.key].badge">
                              {{ rateMeta[row.key].label }}
                            </span>
                            @if (row.key === activeKey()) {
                              <span class="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                predeterminada
                              </span>
                            }
                          </span>
                        </td>
                        <td class="text-slate-500">{{ rateMeta[row.key].source }}</td>
                        <td class="text-slate-500">{{ row.date ?? 'Definida por el local' }}</td>
                        <td class="text-right font-semibold text-slate-900">{{ rate(row.rate) }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>

              <label
                class="flex cursor-pointer items-center gap-2 border-t border-slate-200 px-5 py-3 text-sm text-slate-600"
              >
                <input
                  type="checkbox"
                  class="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-300"
                  [ngModel]="showConversions()"
                  (ngModelChange)="toggleConversions()"
                />
                Mostrar los montos al cambio en todo el sistema
              </label>
            </section>

            <section class="card">
              <div class="card-header">
                <h2 class="text-sm font-semibold text-slate-900">Vista previa</h2>
              </div>
              <div class="card-body space-y-3">
                <div>
                  <label class="label" for="preview-amount">Monto en dólares</label>
                  <input
                    id="preview-amount"
                    type="number"
                    class="input"
                    min="0"
                    step="0.01"
                    [(ngModel)]="previewAmount"
                  />
                  <p class="mt-1 text-xs text-slate-400">
                    Moneda base del sistema: {{ baseCurrency.label }} ({{ baseCurrency.code }})
                  </p>
                </div>

                <div class="space-y-1">
                  @for (row of preview(); track row.key) {
                    <div
                      class="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2"
                    >
                      <span class="badge" [class]="row.meta.badge">{{ row.meta.label }}</span>
                      <span class="text-right">
                        <span class="block text-sm font-semibold text-slate-900">
                          {{ bs(row.converted) }}
                        </span>
                        <span class="block text-[10px] text-slate-400">× {{ rate(row.rate) }}</span>
                      </span>
                    </div>
                  }
                </div>
              </div>
            </section>
          </div>

          <section class="card mt-4">
            <div class="card-header">
              <div>
                <h2 class="text-sm font-semibold text-slate-900">Monedas aceptadas</h2>
                <p class="mt-0.5 text-xs text-slate-500">
                  Con qué monedas se puede cobrar y pagar.
                  <span class="font-medium text-slate-600">USD</span>,
                  <span class="font-medium text-slate-600">VES</span> y
                  <span class="font-medium text-slate-600">EUR</span> son las monedas
                  por defecto y no se pueden quitar: el dólar y el euro toman su tasa
                  de la API del BCV ({{ bcv()?.current?.date }}) y el bolívar queda a
                  1 Bs = 1 Bs. Desactiva las que no uses (el dólar no se puede
                  desactivar) y, si defines una tasa personalizada del dólar, esa es
                  la que se usa para convertir a {{ baseCurrency.label }}.
                </p>
              </div>
              <span class="badge bg-slate-100 text-slate-600">
                {{ currencyRows.length }} configuradas
              </span>
            </div>

            <div class="table-wrap">
              <table class="table">
                <thead>
                  <tr>
                    <th>Moneda</th>
                    <th class="text-right">Tasa (Bs por unidad)</th>
                    <th class="text-center">Aceptada</th>
                    <th class="text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of currencyRows; track row.code) {
                    <tr>
                      <td>
                        <span class="flex items-center gap-2">
                          <span class="badge bg-slate-100 text-slate-700">
                            {{ row.code }}
                          </span>
                          <span class="text-slate-600">{{ row.label }}</span>
                          @if (row.isBase) {
                            <span class="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                              moneda base
                            </span>
                          }
                          @if (row.code === localCurrency.code) {
                            <span class="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                              tasa 1
                            </span>
                          }
                        </span>
                      </td>
                      <td class="text-right">
                        @if (row.isBase) {
                          <span class="flex flex-col items-end leading-tight">
                            <span class="text-sm font-semibold text-slate-900">
                              Bs {{ rate(row.bsPerUnit) }}
                            </span>
                            <span
                              class="text-[10px] uppercase tracking-wide"
                              [class]="
                                row.source === 'CUSTOM'
                                  ? 'text-amber-600'
                                  : 'text-sky-600'
                              "
                            >
                              {{ sourceLabel(row) }}
                            </span>
                          </span>
                        } @else if (row.code === localCurrency.code) {
                          <span class="text-xs text-slate-400">1 Bs = 1 Bs</span>
                        } @else {
                          <div class="flex items-center justify-end gap-2">
                            <input
                              type="number"
                              class="input w-32 text-right"
                              min="0"
                              step="0.0001"
                              [attr.aria-label]="'Bolívares por 1 ' + row.code"
                              [attr.placeholder]="
                                row.source === 'BCV' && row.bsPerUnit
                                  ? rate(row.bsPerUnit)
                                  : 'sin tasa'
                              "
                              [disabled]="!canManage()"
                              [(ngModel)]="row.rate"
                              (ngModelChange)="currencyDirty = true"
                            />
                            <span class="w-24 text-left text-[10px] uppercase tracking-wide text-slate-400">
                              {{ sourceLabel(row) }}
                            </span>
                          </div>
                        }
                      </td>
                      <td class="text-center">
                        <input
                          type="checkbox"
                          class="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-300"
                          [disabled]="!canManage() || row.isBase"
                          [ngModel]="row.enabled"
                          (ngModelChange)="row.enabled = $event; currencyDirty = true"
                        />
                      </td>
                      <td class="text-right">
                        @if (row.isDefault) {
                          <span
                            class="text-[10px] font-semibold uppercase tracking-wide text-slate-400"
                          >
                            por defecto
                          </span>
                        } @else {
                          <button
                            type="button"
                            class="btn-ghost btn-sm text-rose-600"
                            [disabled]="!canManage()"
                            (click)="removeCurrency(row.code)"
                          >
                            <app-icon name="trash" size="h-4 w-4" />
                            Quitar
                          </button>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>

            <div class="card-body flex flex-wrap items-end gap-2 border-t border-slate-200">
              <div>
                <label class="label" for="new-currency">Agregar moneda</label>
                <select id="new-currency" class="input" [(ngModel)]="newCurrencyCode">
                  @for (option of availableCurrencies; track option.code) {
                    <option [value]="option.code">
                      {{ option.label }} ({{ option.code }})
                    </option>
                  }
                </select>
              </div>
              <button
                type="button"
                class="btn-secondary"
                [disabled]="!canManage() || availableCurrencies.length === 0"
                (click)="addCurrency()"
              >
                <app-icon name="plus" size="h-4 w-4" />
                Agregar
              </button>

              <div class="ml-auto flex gap-2">
                <button
                  type="button"
                  class="btn-secondary"
                  [disabled]="!currencyDirty || currencySaving()"
                  (click)="resetCurrencies()"
                >
                  Descartar
                </button>
                <button
                  type="button"
                  class="btn-primary"
                  [disabled]="!canManage() || !currencyDirty || currencySaving()"
                  (click)="saveCurrencies()"
                >
                  <app-icon name="check" size="h-4 w-4" />
                  {{ currencySaving() ? 'Guardando…' : 'Guardar monedas' }}
                </button>
              </div>
            </div>
          </section>


        }

      }

      <!-- Sección: Empresa -->
      @if (section() === 'company') {

        <!-- Datos de la empresa -->
        <section class="card">
          <div class="card-header">
            <div>
              <h2 class="text-sm font-semibold text-slate-900">Datos de la empresa</h2>
              <p class="mt-0.5 text-xs text-slate-500">
                Nombre comercial, RIF y datos de contacto de la empresa activa.
              </p>
            </div>
            @if (!canManage()) {
              <span class="badge bg-slate-100 text-slate-600">Solo lectura</span>
            }
          </div>

          <form class="card-body space-y-4" (ngSubmit)="saveCompany()" #companyFormEl="ngForm">
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label class="label" for="company-name">Nombre *</label>
                <input
                  id="company-name"
                  name="companyName"
                  class="input"
                  required
                  minlength="2"
                  [readonly]="!canManage()"
                  [(ngModel)]="companyForm.name"
                />
              </div>
              <div>
                <label class="label" for="company-rif">RIF *</label>
                <input
                  id="company-rif"
                  name="companyRif"
                  class="input"
                  required
                  [readonly]="!canManage()"
                  [(ngModel)]="companyForm.rif"
                />
              </div>
              <div>
                <label class="label" for="company-phone">Teléfono</label>
                <input
                  id="company-phone"
                  name="companyPhone"
                  type="tel"
                  class="input"
                  [readonly]="!canManage()"
                  [(ngModel)]="companyForm.phone"
                />
              </div>
              <div>
                <label class="label" for="company-email">Correo</label>
                <input
                  id="company-email"
                  name="companyEmail"
                  type="email"
                  class="input"
                  [readonly]="!canManage()"
                  [(ngModel)]="companyForm.email"
                />
              </div>
              <div class="sm:col-span-2">
                <label class="label" for="company-address">Dirección</label>
                <input
                  id="company-address"
                  name="companyAddress"
                  class="input"
                  [readonly]="!canManage()"
                  [(ngModel)]="companyForm.address"
                />
              </div>

              <!-- Logo que encabeza los reportes -->
              <div class="sm:col-span-2">
                <span class="label">Logo de la empresa</span>
                <div class="flex flex-wrap items-start gap-4">
                  <span
                    class="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50"
                  >
                    @if (companyForm.logoUrl) {
                      <img
                        class="h-full w-full object-contain"
                        [src]="companyForm.logoUrl"
                        alt="Logo de la empresa"
                      />
                    } @else {
                      <app-icon name="image" size="h-7 w-7" class="text-slate-400" />
                    }
                  </span>

                  <div class="min-w-[220px] flex-1 space-y-2">
                    @if (canManage()) {
                      <div class="flex flex-wrap items-center gap-2">
                        <label class="btn-secondary btn-sm cursor-pointer" for="company-logo">
                          <app-icon name="image" size="h-4 w-4" />
                          {{ logoReading() ? 'Leyendo…' : 'Subir imagen' }}
                        </label>
                        <input
                          id="company-logo"
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/svg+xml"
                          class="hidden"
                          (change)="onLogoSelected($event)"
                        />
                        @if (companyForm.logoUrl) {
                          <button
                            type="button"
                            class="btn-ghost btn-sm text-rose-600"
                            (click)="clearLogo()"
                          >
                            <app-icon name="trash" size="h-4 w-4" />
                            Quitar
                          </button>
                        }
                      </div>
                      <input
                        name="companyLogo"
                        class="input"
                        placeholder="…o pega la URL del logo"
                        [(ngModel)]="companyForm.logoUrl"
                      />
                    }
                    <p class="text-xs text-slate-500">
                      Aparece en la esquina superior izquierda de los reportes. La imagen
                      se reduce sola a 400 px para guardarla en el sistema.
                    </p>
                    @if (logoError(); as error) {
                      <p class="text-xs font-medium text-rose-600">{{ error }}</p>
                    }
                  </div>
                </div>
              </div>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-4">
              <button type="button" class="btn-secondary" (click)="openCompanyModal()">
                <app-icon name="plus" size="h-4 w-4" />
                Crear otra empresa
              </button>
              @if (canManage()) {
                <button
                  type="submit"
                  class="btn-primary"
                  [disabled]="companySaving() || companyFormEl.invalid"
                >
                  <app-icon name="check" size="h-4 w-4" />
                  {{ companySaving() ? 'Guardando…' : 'Guardar empresa' }}
                </button>
              }
            </div>
          </form>
        </section>

      }

      <!-- Sección: Mis datos -->
      @if (section() === 'profile') {

        <!-- Mis datos -->
        <section class="card">
          <div class="card-header">
            <div>
              <h2 class="text-sm font-semibold text-slate-900">Mis datos</h2>
              <p class="mt-0.5 text-xs text-slate-500">
                Tu información personal y credenciales de acceso.
              </p>
            </div>
          </div>

          <form class="card-body space-y-4" (ngSubmit)="saveProfile()" #profileFormEl="ngForm">
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label class="label" for="profile-name">Nombre completo *</label>
                <input
                  id="profile-name"
                  name="profileName"
                  class="input"
                  required
                  minlength="2"
                  [(ngModel)]="profileForm.name"
                />
              </div>
              <div>
                <label class="label" for="profile-document">Cédula</label>
                <input
                  id="profile-document"
                  name="profileDocument"
                  class="input"
                  [(ngModel)]="profileForm.documentId"
                />
              </div>
              <div>
                <label class="label" for="profile-email">Correo *</label>
                <input
                  id="profile-email"
                  name="profileEmail"
                  type="email"
                  class="input"
                  required
                  [(ngModel)]="profileForm.email"
                />
              </div>
              <div>
                <label class="label" for="profile-phone">Teléfono</label>
                <input
                  id="profile-phone"
                  name="profilePhone"
                  type="tel"
                  class="input"
                  [(ngModel)]="profileForm.phone"
                />
              </div>
            </div>

            <label class="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                name="changePassword"
                class="h-4 w-4"
                [(ngModel)]="changePassword"
              />
              Cambiar mi contraseña
            </label>

            @if (changePassword) {
              <div class="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3">
                <div>
                  <label class="label" for="profile-current">Contraseña actual *</label>
                  <input
                    id="profile-current"
                    name="currentPassword"
                    type="password"
                    class="input"
                    autocomplete="current-password"
                    [required]="changePassword"
                    [(ngModel)]="passwordForm.current"
                  />
                </div>
                <div>
                  <label class="label" for="profile-new">Nueva contraseña *</label>
                  <input
                    id="profile-new"
                    name="newPassword"
                    type="password"
                    class="input"
                    autocomplete="new-password"
                    minlength="6"
                    [required]="changePassword"
                    [(ngModel)]="passwordForm.next"
                  />
                </div>
                <div>
                  <label class="label" for="profile-confirm">Repetir contraseña *</label>
                  <input
                    id="profile-confirm"
                    name="confirmPassword"
                    type="password"
                    class="input"
                    autocomplete="new-password"
                    minlength="6"
                    [required]="changePassword"
                    [(ngModel)]="passwordForm.confirm"
                  />
                </div>
                @if (newPasswordMismatch()) {
                  <p class="text-xs text-rose-600 sm:col-span-3">Las contraseñas no coinciden.</p>
                }
              </div>
            }

            <div class="flex justify-end border-t border-slate-200 pt-4">
              <button
                type="submit"
                class="btn-primary"
                [disabled]="profileSaving() || profileFormEl.invalid"
              >
                <app-icon name="check" size="h-4 w-4" />
                {{ profileSaving() ? 'Guardando…' : 'Guardar mis datos' }}
              </button>
            </div>
          </form>
        </section>

      }

    </div>

    <!-- Crear otra empresa -->
    <app-modal
      [open]="companyModalOpen()"
      title="Crear otra empresa"
      subtitle="Registra una empresa nueva y pásate a ella"
      size="lg"
      (closed)="closeCompanyModal()"
    >
      <form class="space-y-4" (ngSubmit)="createCompany()" #newCompanyForm="ngForm">
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div class="sm:col-span-2">
            <label class="label" for="new-company-name">Nombre *</label>
            <input
              id="new-company-name"
              name="newCompanyName"
              class="input"
              required
              minlength="3"
              placeholder="Ej. Sucursal Centro"
              [(ngModel)]="companyDraft.name"
            />
          </div>
          <div>
            <label class="label" for="new-company-rif">RIF *</label>
            <input
              id="new-company-rif"
              name="newCompanyRif"
              class="input"
              required
              minlength="5"
              placeholder="J-12345678-9"
              [(ngModel)]="companyDraft.rif"
            />
          </div>
          <div>
            <label class="label" for="new-company-phone">Teléfono</label>
            <input
              id="new-company-phone"
              name="newCompanyPhone"
              type="tel"
              class="input"
              [(ngModel)]="companyDraft.phone"
            />
          </div>
          <div>
            <label class="label" for="new-company-email">Correo</label>
            <input
              id="new-company-email"
              name="newCompanyEmail"
              type="email"
              class="input"
              [(ngModel)]="companyDraft.email"
            />
          </div>
          <div>
            <label class="label" for="new-company-address">Dirección</label>
            <input
              id="new-company-address"
              name="newCompanyAddress"
              class="input"
              [(ngModel)]="companyDraft.address"
            />
          </div>
        </div>

        <div modalFooter class="flex w-full justify-end gap-2">
          <button type="button" class="btn-secondary" (click)="closeCompanyModal()">
            Cancelar
          </button>
          <button
            type="submit"
            class="btn-primary"
            [disabled]="companyCreating() || newCompanyForm.invalid"
          >
            {{ companyCreating() ? 'Creando…' : 'Crear empresa' }}
          </button>
        </div>
      </form>
    </app-modal>

  `,
})
export class SettingsPage implements OnInit {
  private readonly ratesService = inject(RatesService);
  private readonly currenciesService = inject(CurrenciesService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly companiesService = inject(CompaniesService);
  private readonly preferences = inject(PreferencesService);
  private readonly themeService = inject(ThemeService);
  readonly auth = inject(AuthService);

  readonly rateMeta = RATE_META;
  readonly baseCurrency = BASE_CURRENCY;
  readonly baseCode = BASE_CURRENCY_CODE;
  readonly localCurrency = currencyMeta(LOCAL_CURRENCY_CODE);
  readonly rate = rate;
  readonly bs = bs;
  readonly signedPercent = signedPercent;
  readonly canManage = this.auth.canManage;

  // --------------------------------- Pestañas --------------------------------
  /** Pestaña visible: solo se pinta la sección elegida. */
  readonly section = signal<SettingsSection>('rates');

  /** Pestañas disponibles, con el icono y la pista que las describe. */
  readonly tabs: { value: SettingsSection; label: string; icon: string; hint: string }[] = [
    {
      value: 'rates',
      label: 'Tasas',
      icon: 'exchange',
      hint: 'Tasas del BCV, tasa personalizada y monedas aceptadas.',
    },
    {
      value: 'appearance',
      label: 'Apariencia',
      icon: 'sun',
      hint: 'Modo claro u oscuro y cómo se abren los formularios.',
    },
    {
      value: 'company',
      label: 'Empresa',
      icon: 'building',
      hint: 'Datos de la empresa activa y creación de otras empresas.',
    },
    {
      value: 'profile',
      label: 'Mis datos',
      icon: 'user-cog',
      hint: 'Tu información personal y tus credenciales de acceso.',
    },
  ];

  /** Bajada de la cabecera según la pestaña activa. */
  readonly activeHint = computed(
    () => this.tabs.find((tab) => tab.value === this.section())?.hint ?? '',
  );

  readonly loading = this.ratesService.loading;
  readonly snapshot = this.ratesService.snapshot;
  readonly bcv = this.ratesService.bcv;
  readonly custom = this.ratesService.custom;
  readonly hasCustom = this.ratesService.hasCustom;
  readonly rates = this.ratesService.rates;
  readonly stale = this.ratesService.stale;
  readonly activeKey = this.ratesService.activeKey;
  readonly showConversions = this.ratesService.showConversions;
  /** Tasa USDT/VES de referencia (informativa, no entra en los cálculos). */
  readonly reference = this.ratesService.reference;

  // --------------------------------- Apariencia ------------------------------
  /** Tema visual activo: `light` (claro) u `dark` (oscuro). */
  readonly theme = this.themeService.theme;

  /** Temas disponibles y qué los distingue. */
  readonly themeOptions: {
    value: Theme;
    label: string;
    hint: string;
    icon: string;
  }[] = [
    {
      value: 'light',
      label: 'Modo claro',
      hint: 'Fondos claros, la presentación de siempre.',
      icon: 'sun',
    },
    {
      value: 'dark',
      label: 'Modo oscuro',
      hint: 'Fondos oscuros, más cómodo con poca luz.',
      icon: 'moon',
    },
  ];

  /** Nombre del tema elegido (chip de la cabecera). */
  readonly themeLabel = computed(
    () => this.themeOptions.find((option) => option.value === this.theme())?.label ?? '',
  );

  // -------------------------- Formularios de caja y pedidos ------------------
  /** Cómo se abren los formularios de caja y pedidos: `modal` o `sidebar`. */
  readonly dialogView = this.preferences.dialogView;

  /** Presentaciones disponibles y qué las distingue. */
  readonly dialogViewOptions: {
    value: DialogView;
    label: string;
    hint: string;
    icon: string;
  }[] = [
    {
      value: 'modal',
      label: 'Ventana modal',
      hint: 'El formulario aparece centrado sobre la página y se cierra al terminar.',
      icon: 'box',
    },
    {
      value: 'sidebar',
      label: 'Panel lateral',
      hint: 'El formulario se desliza desde la derecha sin tapar toda la página.',
      icon: 'menu',
    },
  ];

  /** Nombre de la presentación elegida (chip de la cabecera). */
  readonly dialogViewLabel = computed(
    () => this.dialogViewOptions.find((option) => option.value === this.dialogView())?.label ?? '',
  );

  // ----------------------------- Monedas aceptadas ---------------------------
  readonly currencySaving = this.currenciesService.saving;
  /** Filas editables de la tabla de monedas. */
  currencyRows: CurrencyRow[] = [];
  /** Moneda pendiente de agregar (select del catalogo). */
  newCurrencyCode = 'EUR';
  /** `true` cuando hay cambios sin guardar en la tabla de monedas. */
  currencyDirty = false;

  /** Tasa personalizada en edición ('' = sin definir). */
  customInput = '';
  /** Evita que la respuesta del backend pise lo que el usuario está escribiendo. */
  dirty = false;
  saving = false;
  previewAmount = 100;

  readonly customUpdatedAt = () => dateTime(this.custom()?.updatedAt);
  readonly lastUpdate = () => dateTime(this.bcv()?.fetchedAt);
  readonly referenceAsOf = () => dateTime(this.reference()?.asOf);
  readonly referenceFetchedAt = () => dateTime(this.reference()?.fetchedAt);

  // ------------------------------ Empresa activa -----------------------------
  /** Datos de la empresa activa (se sincronizan con la sesión). */
  companyForm = { name: '', rif: '', phone: '', email: '', address: '', logoUrl: '' };
  readonly companySaving = signal(false);
  readonly companyCreating = signal(false);
  readonly companyModalOpen = signal(false);
  /** Lectura del archivo del logo en curso y error del último intento. */
  readonly logoReading = signal(false);
  readonly logoError = signal<string | null>(null);
  /** Borrador para crear otra empresa. */
  companyDraft = { name: '', rif: '', phone: '', email: '', address: '' };

  // -------------------------------- Mis datos --------------------------------
  profileForm = { name: '', documentId: '', email: '', phone: '' };
  passwordForm = { current: '', next: '', confirm: '' };
  changePassword = false;
  readonly profileSaving = signal(false);

  constructor() {
    effect(() => {
      const custom = this.custom();
      if (!this.dirty) this.customInput = custom ? String(custom.usd) : '';
    });

    effect(() => {
      const currencies = this.ratesService.currencies();
      if (!this.currencyDirty) this.currencyRows = this.toRows(currencies);
    });

    // La empresa activa puede cambiar de empresa desde la cabecera; el
    // formulario siempre refleja la sesión vigente.
    effect(() => {
      const company = this.auth.company();
      if (company) this.applyCompany(company);
    });

    // Igual con los datos del usuario (se repintan al refrescar la sesión).
    effect(() => {
      const user = this.auth.user();
      if (user) {
        this.profileForm = {
          name: user.name,
          documentId: user.documentId ?? '',
          email: user.email,
          phone: user.phone ?? '',
        };
      }
    });
  }

  newPasswordMismatch(): boolean {
    return !!this.passwordForm.next && this.passwordForm.next !== this.passwordForm.confirm;
  }

  // ------------------------------ Datos de empresa ---------------------------

  private applyCompany(company: Company): void {
    this.companyForm = {
      name: company.name,
      rif: company.rif,
      phone: company.phone ?? '',
      email: company.email ?? '',
      address: company.address ?? '',
      logoUrl: company.logoUrl ?? '',
    };
  }

  /**
   * Lee el archivo elegido y lo deja en el formulario como data URL ya reducido
   * (así no viaja un archivo de varios megabytes en cada petición de sesión).
   */
  async onLogoSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Se limpia el input para poder volver a elegir el mismo archivo.
    input.value = '';
    if (!file) return;

    this.logoError.set(null);
    this.logoReading.set(true);
    try {
      this.companyForm.logoUrl = await toLogoDataUrl(file);
    } catch (error) {
      this.logoError.set(apiErrorMessage(error));
    } finally {
      this.logoReading.set(false);
    }
  }

  /** Quita el logo de la empresa (se guarda al enviar el formulario). */
  clearLogo(): void {
    this.companyForm.logoUrl = '';
    this.logoError.set(null);
  }

  private loadCompany(): void {
    this.companiesService.current().subscribe({
      next: (company) => this.applyCompany(company),
    });
  }

  saveCompany(): void {
    if (!this.canManage() || this.companySaving()) return;

    this.companySaving.set(true);
    this.companiesService
      .updateCurrent({
        name: this.companyForm.name.trim(),
        rif: this.companyForm.rif.trim(),
        phone: this.companyForm.phone.trim(),
        email: this.companyForm.email.trim(),
        address: this.companyForm.address.trim(),
        logoUrl: this.companyForm.logoUrl.trim(),
      })
      .subscribe({
        next: () => {
          this.companySaving.set(false);
          this.toast.success('Datos de la empresa actualizados');
          this.auth.refreshProfile().subscribe();
        },
        error: () => this.companySaving.set(false),
      });
  }

  openCompanyModal(): void {
    this.companyDraft = { name: '', rif: '', phone: '', email: '', address: '' };
    this.companyModalOpen.set(true);
  }

  closeCompanyModal(): void {
    this.companyModalOpen.set(false);
  }

  /** Crea la empresa y pasa la sesión a ella (token y tasas nuevas). */
  createCompany(): void {
    if (this.companyCreating()) return;

    const payload: CompanyPayload = {
      name: this.companyDraft.name.trim(),
      rif: this.companyDraft.rif.trim(),
      phone: this.companyDraft.phone.trim() || undefined,
      email: this.companyDraft.email.trim() || undefined,
      address: this.companyDraft.address.trim() || undefined,
    };

    this.companyCreating.set(true);
    this.companiesService.create(payload).subscribe({
      next: (response) => {
        this.companyCreating.set(false);
        this.closeCompanyModal();
        this.toast.success(`${response.company.name} creada`, 'Nueva empresa');
        this.auth.switchCompany(response.company.id).subscribe();
      },
      error: () => this.companyCreating.set(false),
    });
  }

  // -------------------------------- Mis datos --------------------------------

  saveProfile(): void {
    if (this.profileSaving()) return;

    const payload: UpdateProfilePayload = {
      name: this.profileForm.name.trim(),
      documentId: this.profileForm.documentId.trim(),
      email: this.profileForm.email.trim().toLowerCase(),
      phone: this.profileForm.phone.trim(),
    };

    if (this.changePassword && this.passwordForm.next) {
      if (this.passwordForm.next.length < 6) {
        this.toast.warning('La nueva contraseña debe tener al menos 6 caracteres.');
        return;
      }
      if (this.passwordForm.next !== this.passwordForm.confirm) {
        this.toast.warning('Las contraseñas no coinciden.');
        return;
      }
      if (!this.passwordForm.current) {
        this.toast.warning('Ingresa tu contraseña actual para poder cambiarla.');
        return;
      }
      payload.password = this.passwordForm.next;
      payload.currentPassword = this.passwordForm.current;
    }

    this.profileSaving.set(true);
    this.auth.updateProfile(payload).subscribe({
      next: () => {
        this.profileSaving.set(false);
        this.changePassword = false;
        this.passwordForm = { current: '', next: '', confirm: '' };
        this.toast.success('Tus datos se actualizaron');
        this.auth.refreshProfile().subscribe();
      },
      error: () => this.profileSaving.set(false),
    });
  }

  ngOnInit(): void {
    this.ratesService.ensureLoaded();
    this.loadCompany();
  }

  refresh(): void {
    this.dirty = false;
    this.ratesService.load(true);
  }

  /**
   * Cambia de pestaña. La sección elegida vive mientras la pantalla está
   * abierta: al volver a entrar se muestra «Tasas».
   */
  setSection(section: SettingsSection): void {
    this.section.set(section);
  }

  /**
   * Navegación por teclado del tablist (←/→, Inicio y Fin), como pide ARIA:
   * mueve la selección y el foco a la pestaña vecina.
   */
  onTabKeydown(event: KeyboardEvent, current: SettingsSection): void {
    const index = this.tabs.findIndex((tab) => tab.value === current);
    if (index < 0) return;

    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    let next: number | null =
      step === 0 ? null : (index + step + this.tabs.length) % this.tabs.length;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = this.tabs.length - 1;
    if (next === null) return;

    event.preventDefault();
    const target = this.tabs[next];
    this.setSection(target.value);
    // El foco acompaña a la selección (patrón "roving tabindex").
    (event.currentTarget as HTMLElement)
      .closest('[role="tablist"]')
      ?.querySelector<HTMLElement>(`#${target.value}-tab`)
      ?.focus();
  }

  toggleConversions(): void {
    this.ratesService.setConversions(!this.showConversions());
  }

  /**
   * Cambia la presentación de los formularios de caja y pedidos. Como el resto
   * de las preferencias de interfaz, se guarda solo en este navegador.
   */
  setDialogView(view: DialogView): void {
    if (this.dialogView() === view) return;
    this.preferences.setDialogView(view);
  }

  /**
   * Cambia entre modo claro y oscuro. El tema se aplica de inmediato a todo el
   * sistema (la clase `dark` en <html> reescribe los colores) y, como el resto
   * de las preferencias de interfaz, se guarda solo en este navegador.
   */
  setTheme(theme: Theme): void {
    if (this.theme() === theme) return;
    this.themeService.setTheme(theme);
  }

  saveCustom(): void {
    const raw = String(this.customInput ?? '').trim().replace(',', '.');
    const value = Number(raw);

    if (!raw) {
      this.toast.warning('Ingresa la tasa personalizada en bolívares por dólar.');
      return;
    }
    if (!Number.isFinite(value) || value <= 0) {
      this.toast.warning('La tasa personalizada debe ser mayor a cero.');
      return;
    }

    this.saving = true;
    this.ratesService.setCustomRate(value, () => {
      this.saving = false;
      this.dirty = false;
      this.toast.success('Tasa personalizada guardada', 'Configuración');
    });
  }

  async clearCustom(): Promise<void> {
    const confirmed = await this.confirm.ask({
      title: 'Eliminar tasa personalizada',
      message:
        'El sistema volverá a mostrar únicamente las tasas del BCV (dólar y euro). ¿Continuar?',
      confirmLabel: 'Eliminar',
      tone: 'danger',
    });
    if (!confirmed) return;

    this.saving = true;
    this.ratesService.setCustomRate(null, () => {
      this.saving = false;
      this.dirty = false;
      this.customInput = '';
      this.toast.success('Tasa personalizada eliminada', 'Configuración');
    });
  }

  // ----------------------------- Monedas aceptadas ---------------------------

  /** Monedas del catalogo que aun no estan configuradas. */
  get availableCurrencies() {
    const configured = new Set(this.currencyRows.map((row) => row.code));
    return CURRENCY_CATALOG.filter((item) => !configured.has(item.code));
  }

  /** Convierte la configuracion del backend en filas editables. */
  private toRows(currencies: CurrencyRateOption[]): CurrencyRow[] {
    return currencies.map((item) => ({
      code: item.code,
      label: item.label,
      symbol: item.symbol,
      enabled: item.enabled,
      // La tasa manual se edita solo cuando existe; si no, se deja vacia para
      // que el sistema siga usando la del BCV (USD y EUR) o la del bolivar.
      rate: item.source === 'MANUAL' && item.bsPerUnit ? String(item.bsPerUnit) : '',
      bsPerUnit: item.bsPerUnit,
      source: item.source,
      isBase: item.isBase,
      isDefault: isDefaultCurrency(item.code),
    }));
  }

  /** Descripcion de la tasa que el sistema esta usando para una moneda. */
  sourceLabel(row: CurrencyRow): string {
    switch (row.source) {
      case 'BCV':
        return 'BCV (automática)';
      case 'CUSTOM':
        return 'personalizada';
      case 'MANUAL':
        return 'manual';
      case 'BASE':
        return '1 Bs = 1 Bs';
      default:
        return 'sin tasa';
    }
  }

  addCurrency(): void {
    const meta = currencyMeta(this.newCurrencyCode);
    if (this.currencyRows.some((row) => row.code === meta.code)) return;

    this.currencyRows = [
      ...this.currencyRows,
      {
        code: meta.code,
        label: meta.label,
        symbol: meta.symbol,
        enabled: true,
        rate: '',
        // Aun sin guardar no hay tasa: el usuario debe escribirla.
        bsPerUnit: null,
        source: 'NONE',
        isBase: meta.code === BASE_CURRENCY_CODE,
        isDefault: isDefaultCurrency(meta.code),
      },
    ];
    this.currencyDirty = true;
  }

  removeCurrency(code: string): void {
    // USD, VES y EUR son monedas por defecto: se desactivan, no se quitan.
    if (code === BASE_CURRENCY_CODE || isDefaultCurrency(code)) return;
    this.currencyRows = this.currencyRows.filter((row) => row.code !== code);
    this.currencyDirty = true;
  }

  /** Descarta los cambios y vuelve a la configuracion guardada. */
  resetCurrencies(): void {
    this.currencyDirty = false;
    this.currencyRows = this.toRows(this.ratesService.currencies());
  }

  saveCurrencies(): void {
    if (!this.currencyDirty || this.currencySaving()) return;

    const payload: CurrencySettingPayload[] = [];
    for (const row of this.currencyRows) {
      const raw = String(row.rate ?? '').trim().replace(',', '.');
      const rate = raw ? Number(raw) : null;

      if (raw && (!Number.isFinite(rate) || (rate ?? 0) <= 0)) {
        this.toast.warning(`La tasa de ${row.code} debe ser mayor a cero.`);
        return;
      }
      const needsRate =
        row.enabled &&
        row.code !== BASE_CURRENCY_CODE &&
        row.code !== LOCAL_CURRENCY_CODE &&
        row.code !== 'EUR';

      if (needsRate && rate === null) {
        this.toast.warning(
          `Configura la tasa de ${row.code} (bolívares por 1 ${row.code}) o desactívala.`,
        );
        return;
      }

      payload.push({
        code: row.code,
        enabled: row.enabled,
        rate,
        label: row.label,
        symbol: row.symbol,
      });
    }

    this.currenciesService.save(payload, () => {
      this.currencyDirty = false;
      this.toast.success('Monedas actualizadas', 'Configuración');
    });
  }

  /** Filas de solo lectura con los datos publicados por el BCV. */
  bcvRows() {
    return this.rates().filter((item) => item.source === 'BCV');
  }

  /** Equivalente en bolívares del monto de vista previa para cada tasa activa. */
  preview() {
    const amount = Number(this.previewAmount) || 0;
    return this.rates().map((item) => ({
      ...item,
      meta: RATE_META[item.key],
      converted: amount * item.rate,
      isActive: item.key === this.activeKey(),
    }));
  }

  rateLabel(key: RateKey): string {
    return RATE_META[key]?.label ?? key;
  }

  variationClass(value: number | null | undefined): string {
    const amount = Number(value ?? 0);
    if (amount > 0) return 'text-emerald-600';
    if (amount < 0) return 'text-rose-600';
    return 'text-slate-500';
  }
}
