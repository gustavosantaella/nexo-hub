import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  effect,
  inject,
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
import { AuthService } from '../../core/services/auth.service';
import { CurrenciesService } from '../../core/services/currencies.service';
import { RatesService } from '../../core/services/rates.service';
import { ToastService } from '../../core/services/toast.service';
import { bs, dateTime, rate, signedPercent } from '../../core/utils/format';
import { EmptyStateComponent, LoaderComponent } from '../../shared/components/feedback.component';
import { IconComponent } from '../../shared/components/icon.component';
import { MoneyComponent } from '../../shared/components/money.component';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { ConfirmService } from '../../shared/services/confirm.service';

/**
 * Configuración del sistema.
 *
 * Muestra las tasas del BCV (dólar y euro) tal cual las publica dolarvzla —
 * solo lectura — y permite guardar una **tasa personalizada**. Las tasas
 * activas son 2 mientras no exista la personalizada y 3 cuando se define; con
 * cualquiera de ellas la interfaz muestra todos los montos "al cambio".
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
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header
      title="Configuración"
      subtitle="Tasas de cambio y montos al cambio en todo el sistema"
      icon="settings"
    >
      <button
        type="button"
        class="btn-secondary"
        [disabled]="loading()"
        (click)="refresh()"
      >
        <app-icon name="refresh" size="h-4 w-4" />
        Actualizar tasas
      </button>
    </app-page-header>

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
  `,
})
export class SettingsPage implements OnInit {
  private readonly ratesService = inject(RatesService);
  private readonly currenciesService = inject(CurrenciesService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  readonly auth = inject(AuthService);

  readonly rateMeta = RATE_META;
  readonly baseCurrency = BASE_CURRENCY;
  readonly baseCode = BASE_CURRENCY_CODE;
  readonly localCurrency = currencyMeta(LOCAL_CURRENCY_CODE);
  readonly rate = rate;
  readonly bs = bs;
  readonly signedPercent = signedPercent;
  readonly canManage = this.auth.canManage;

  readonly loading = this.ratesService.loading;
  readonly snapshot = this.ratesService.snapshot;
  readonly bcv = this.ratesService.bcv;
  readonly custom = this.ratesService.custom;
  readonly hasCustom = this.ratesService.hasCustom;
  readonly rates = this.ratesService.rates;
  readonly stale = this.ratesService.stale;
  readonly activeKey = this.ratesService.activeKey;
  readonly showConversions = this.ratesService.showConversions;

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

  constructor() {
    effect(() => {
      const custom = this.custom();
      if (!this.dirty) this.customInput = custom ? String(custom.usd) : '';
    });

    effect(() => {
      const currencies = this.ratesService.currencies();
      if (!this.currencyDirty) this.currencyRows = this.toRows(currencies);
    });
  }

  ngOnInit(): void {
    this.ratesService.ensureLoaded();
  }

  refresh(): void {
    this.dirty = false;
    this.ratesService.load(true);
  }

  toggleConversions(): void {
    this.ratesService.setConversions(!this.showConversions());
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
