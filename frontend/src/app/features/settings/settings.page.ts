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
import {
  CATALOG_ENTITIES,
  CATALOG_ENTITY_LABELS,
  type CatalogEntity,
  type CatalogImportMode,
  type CatalogImportResult,
} from '../../core/models/data-transfer.model';
import type {
  Company,
  CompanyPayload,
  UpdateProfilePayload,
} from '../../core/models/api.model';
import { AuthService } from '../../core/services/auth.service';
import { CompaniesService } from '../../core/services/companies.service';
import { CurrenciesService } from '../../core/services/currencies.service';
import { DataTransferService } from '../../core/services/data-transfer.service';
import {
  catalogFileName,
  catalogFileOverview,
  catalogSum,
  downloadJson,
  readJsonFile,
  type CatalogFileOverview,
} from '../../core/utils/catalog-file';
import {
  CHARGE_RATE_KEYS,
  PreferencesService,
  TIP_PERCENT_PRESETS,
  normalizeChargeRateKey,
  normalizeTipPercent,
  type ChargeRateKey,
  type DialogView,
  type PosView,
} from '../../core/services/preferences.service';
import { ThemeService, type Theme } from '../../core/services/theme.service';
import { RatesService } from '../../core/services/rates.service';
import { ToastService } from '../../core/services/toast.service';
import { bs, dateTime, money, moneyIn, rate, signedPercent, apiErrorMessage } from '../../core/utils/format';
import { toLogoDataUrl } from '../../core/utils/image';
import { EmptyStateComponent, LoaderComponent } from '../../shared/components/feedback.component';
import { IconComponent } from '../../shared/components/icon.component';
import { ModalComponent } from '../../shared/components/modal.component';
import { MoneyComponent } from '../../shared/components/money.component';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { SwitchComponent } from '../../shared/components/switch.component';
import { ConfirmService } from '../../shared/services/confirm.service';

/**
 * Pestañas de Configuración: cada una agrupa una de las secciones de la pantalla.
 *
 * `rates` muestra el estado de las tasas, `appearance` las preferencias de
 * interfaz, `pos` las del punto de venta (propina sugerida y moneda de los
 * precios), `company` los datos
 * de la empresa activa, `profile` los del usuario y `data` el respaldo del
 * catálogo (exportar / importar), que solo ven ADMIN y MANAGER.
 */
export type SettingsSection = 'rates' | 'appearance' | 'pos' | 'company' | 'profile' | 'data';

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
  /** `true` cuando la moneda puede ser la base con la que se muestran los montos. */
  canBeBase: boolean;
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
    SwitchComponent,
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
        @for (tab of visibleTabs(); track tab.value) {
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
                Cómo se abren los formularios de caja y de pedidos. Se guarda para toda
                la empresa: el cajero que entra desde otro equipo la recibe al iniciar
                sesión.
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

      <!-- Sección: Cajero -->
      @if (section() === 'pos') {

        <!-- Vista del catálogo: el admin decide cómo lista el POS los productos
             y los menús (tarjetas, tabla o columnas sin foto). -->
        @if (canManage()) {
          <section class="card mb-4">
            <div class="card-header">
              <div>
                <h2 class="text-sm font-semibold text-slate-900">Vista del catálogo</h2>
                <p class="mt-0.5 text-xs text-slate-500">
                  Cómo lista el punto de venta los productos y los menús. Se aplica al
                  instante y se guarda para toda la empresa: el cajero que entra desde otro
                  equipo recibe la misma vista.
                </p>
              </div>
              <span class="badge bg-slate-100 text-slate-600">{{ posViewLabel() }}</span>
            </div>

            <div class="card-body grid gap-3 sm:grid-cols-3">
              @for (option of posViewOptions; track option.value) {
                <button
                  type="button"
                  class="flex items-start gap-3 rounded-xl border p-3 text-left transition"
                  [class]="
                    posView() === option.value
                      ? 'border-brand-400 bg-brand-50/60 ring-2 ring-brand-200'
                      : 'border-slate-200 hover:border-brand-300 hover:bg-slate-50'
                  "
                  [attr.aria-pressed]="posView() === option.value"
                  (click)="setPosView(option.value)"
                >
                  <span class="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-white shadow-sm">
                    <app-icon
                      [name]="option.icon"
                      size="h-5 w-5"
                      [class]="posView() === option.value ? 'text-brand-600' : 'text-slate-400'"
                    />
                  </span>
                  <span>
                    <span class="block text-sm font-semibold text-slate-800">{{ option.label }}</span>
                    <span class="mt-0.5 block text-xs text-slate-500">{{ option.hint }}</span>
                  </span>
                </button>
              }
            </div>
          </section>
        }

        <!-- Moneda en la que el cajero ve los precios: el sistema los convierte
             con las tasas configuradas y los muestra en esa moneda. -->
        <section class="card mb-4">
          <div class="card-header">
            <div>
              <h2 class="text-sm font-semibold text-slate-900">Moneda de los precios</h2>
              <p class="mt-0.5 text-xs text-slate-500">
                Moneda en la que el punto de venta muestra los precios del catálogo. El
                sistema los convierte con las tasas de Tasas → Monedas y la preferencia se
                guarda para toda la empresa al pulsar «Guardar cambios».
              </p>
            </div>
            <span class="badge bg-slate-100 text-slate-600">{{ priceCurrencyLabel() }}</span>
          </div>

          <div class="card-body space-y-4">
            <div>
              <label class="label" for="price-currency">Moneda</label>
              <select
                id="price-currency"
                class="input"
                [ngModel]="priceCurrencyDraft() ?? ''"
                (ngModelChange)="pickPriceCurrency($event)"
              >
                <option value="">Moneda base ({{ displayBase().label }})</option>
                @for (currency of priceCurrencyOptions(); track currency.code) {
                  <option [value]="currency.code">
                    {{ currency.label || currency.code }} ({{ currency.code }})
                  </option>
                }
              </select>
              <p class="mt-1 text-xs text-slate-500">{{ pricePreview() }}</p>
            </div>

            @if (canManage()) {
              <p class="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                <app-icon name="alert" size="h-3.5 w-3.5 shrink-0" />
                <span>
                  Tu rol siempre ve el precio con el que se registró cada artículo y su
                  conversión: esta preferencia la aplica el personal de caja del local,
                  también el que entra desde otro equipo.
                </span>
              </p>
            }
          </div>
        </section>

        <!-- Conversiones que ve el cajero: por defecto ninguna. El admin activa,
             moneda a moneda, qué equivalencias se muestran debajo de cada monto y,
             en la misma tarjeta, la línea del precio en dólares del BCV. -->
        <section class="card mb-4">
          <div class="card-header">
            <div>
              <h2 class="text-sm font-semibold text-slate-900">Conversiones del cajero</h2>
              <p class="mt-0.5 text-xs text-slate-500">
                Por defecto el personal de caja ve los precios solo en su moneda (arriba) y
                ninguna conversión debajo. Activa aquí las monedas en las que además puede
                ver cada monto y la línea del precio en dólares del BCV: se guarda para
                toda la empresa al pulsar «Guardar cambios».
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <span class="badge bg-slate-100 text-slate-600">{{ conversionSummary() }}</span>
              <span class="badge bg-slate-100 text-slate-600">BCV · {{ bcvPriceLabel() }}</span>
            </div>
          </div>

          <div class="card-body space-y-4">
            @if (conversionOptions().length === 0) {
              <p class="text-sm text-slate-500">
                Para activar conversiones, primero configura las monedas y sus tasas en
                Tasas → Monedas.
              </p>
            } @else {
              <div class="space-y-3">
                @for (currency of conversionOptions(); track currency.code) {
                  <app-switch
                    [checked]="showsConversion(currency.code)"
                    [label]="'Mostrar la conversión en ' + currency.label"
                    [hint]="currency.hint"
                    (checkedChange)="toggleConversion(currency.code, $event)"
                  />
                }
              </div>

              <p class="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                Debajo de cada monto va su equivalente en la otra moneda: con los
                precios en bolívares se activan Dólares (el del BCV y, si el local la
                definió, la personalizada) o Euros; con los precios en dólares se
                activa Bolívares y se pinta una línea por cada tasa.
              </p>
            }

            <!-- El precio en dólares del BCV es una línea más de las conversiones:
                 con los precios en bolívares enseña los dólares oficiales y con los
                 precios en una divisa, los bolívares. -->
            <app-switch
              [checked]="bcvPriceDraft()"
              label="Mostrar el precio en dólares BCV"
              hint="El personal de caja lo ve debajo de cada monto, además de las conversiones activadas arriba: con los precios en bolívares, cuántos dólares oficiales son; con los precios en una divisa, cuántos bolívares."
              (checkedChange)="toggleBcvPrice($event)"
            />

            <p class="text-xs text-slate-500">{{ bcvPricePreview() }}</p>

            @if (canManage()) {
              <p
                class="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500"
              >
                <app-icon name="alert" size="h-3.5 w-3.5 shrink-0" />
                <span>
                  Tu rol siempre ve todas las conversiones: esto solo cambia lo que ve el
                  personal de caja del local, también el que entra desde otro equipo.
                </span>
              </p>
            }
          </div>
        </section>

        <!-- Tasa con la que cobra el cajero: con cuál de las tasas del dólar
             convierte el saldo del pedido, el efectivo recibido y el vuelto. Por
             defecto se usa la tasa activa del sistema. -->
        <section class="card mb-4">
          <div class="card-header">
            <div>
              <h2 class="text-sm font-semibold text-slate-900">Cobro</h2>
              <p class="mt-0.5 text-xs text-slate-500">
                Tasa del dólar con la que el punto de venta cobra: el cajero convierte
                el saldo del pedido, el efectivo recibido y el vuelto con ella, sin
                preguntar nada. Por defecto se usa la tasa activa del sistema. Se
                guarda para toda la empresa al pulsar «Guardar cambios».
              </p>
            </div>
            <span class="badge bg-slate-100 text-slate-600">{{ chargeRateLabel() }}</span>
          </div>

          <div class="card-body space-y-4">
            <div>
              <label class="label" for="charge-rate">Tasa de cobro</label>
              <select
                id="charge-rate"
                class="input"
                [ngModel]="chargeRateDraft() ?? ''"
                (ngModelChange)="pickChargeRate($event)"
              >
                <option value="">Tasa activa del sistema</option>
                @for (option of chargeRateOptions(); track option.key) {
                  <option [value]="option.key" [disabled]="option.rate === null">
                    {{ option.label }}{{ option.rate === null ? ' · sin tasa' : '' }}
                  </option>
                }
              </select>
              <p class="mt-1 text-xs text-slate-500">{{ chargeRatePreview() }}</p>
            </div>
          </div>
        </section>

        <!-- Propina sugerida: el POS la propone en cada venta y es opcional. -->
        <section class="card mb-4">
          <div class="card-header">
            <div>
              <h2 class="text-sm font-semibold text-slate-900">Propina sugerida</h2>
              <p class="mt-0.5 text-xs text-slate-500">
                Porcentaje que el punto de venta aplica cuando el cajero marca la propina
                como «Sí». Al marcar «No» no se cobra propina. Al pulsar «Guardar cambios»
                se guarda para toda la empresa: el cajero que entra desde otro equipo la
                recibe al iniciar sesión.
              </p>
            </div>
            <span class="badge bg-slate-100 text-slate-600">{{ tipPercentLabel() }}</span>
          </div>

          <div class="card-body space-y-4">
            <div class="flex flex-wrap items-center gap-2">
              @for (option of tipPercentPresets; track option) {
                <button
                  type="button"
                  [class]="
                    tipDraft() === option ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'
                  "
                  [attr.aria-pressed]="tipDraft() === option"
                  (click)="pickTipPercent(option)"
                >
                  {{ option === 0 ? 'Sin propina' : option + ' %' }}
                </button>
              }
              <div class="flex items-center gap-2">
                <label class="label mb-0" for="tip-percent">Otro</label>
                <input
                  id="tip-percent"
                  class="input w-24"
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  [(ngModel)]="tipInput"
                  (change)="applyTipInput()"
                />
                <span class="text-sm text-slate-500">%</span>
              </div>
            </div>

            <p class="text-xs text-slate-500">
              En una venta de <span class="font-semibold">{{ money(100) }}</span> el cajero
              propondría una propina de
              <span class="font-semibold">{{ money(tipDraft()) }}</span>.
            </p>
          </div>
        </section>

        <!-- Acciones de la pestaña: lo elegido arriba no se aplica ni se guarda
             hasta pulsar el botón, para no cambiar la moneda ni la propina de todo
             el local con un clic de más. -->
        <section class="card">
          <div class="card-body flex flex-wrap items-center gap-3">
            <p
              class="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500"
            >
              <app-icon name="alert" size="h-3.5 w-3.5 shrink-0" />
              <span>
                {{ posDirty()
                  ? 'Tienes cambios sin guardar: la propina, la moneda de los precios, las conversiones, el precio en dólares BCV y la tasa de cobro se guardan para toda la empresa.'
                  : 'La propina, la moneda de los precios, las conversiones, el precio en dólares BCV y la tasa de cobro se guardan para toda la empresa.' }}
              </span>
            </p>

            <div class="ml-auto flex gap-2">
              <button
                type="button"
                class="btn-secondary"
                [disabled]="!posDirty()"
                (click)="discardPos()"
              >
                Descartar
              </button>
              <button
                type="button"
                class="btn-primary"
                [disabled]="!posDirty()"
                (click)="savePosPreferences()"
              >
                <app-icon name="check" size="h-4 w-4" />
                Guardar cambios
              </button>
            </div>
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

              <div class="border-t border-slate-200 px-5 py-3">
                <app-switch
                  [checked]="showConversions()"
                  label="Mostrar los montos al cambio en todo el sistema"
                  hint="Se guarda en este navegador: las tasas y las monedas se conservan."
                  (checkedChange)="setConversions($event)"
                />
              </div>
            </section>

            <section class="card">
              <div class="card-header">
                <h2 class="text-sm font-semibold text-slate-900">Vista previa</h2>
              </div>
              <div class="card-body space-y-3">
                <div>
                  <label class="label" for="preview-amount">Monto en dólares (USD)</label>
                  <input
                    id="preview-amount"
                    type="number"
                    class="input"
                    min="0"
                    step="0.01"
                    [(ngModel)]="previewAmount"
                  />
                  <p class="mt-1 text-xs text-slate-400">
                    Moneda base del sistema: {{ displayBase().label }} ({{ displayBase().code }}) —
                    así se muestra ese monto en todo el sistema.
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
                  desactivar). Si defines una tasa personalizada del dólar, esa es
                  la que se usa para convertir a {{ baseCurrency.label }}. En la
                  columna <span class="font-medium text-slate-600">Base</span> eliges
                  en qué moneda se muestran los montos del sistema (tarjetas,
                  listados y reportes): los montos se siguen guardando en dólares.
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
                    <th class="text-center">Base</th>
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
                          type="radio"
                          name="base-currency"
                          class="h-4 w-4 border-slate-300 text-brand-600 focus:ring-brand-300"
                          [attr.aria-label]="'Mostrar los montos en ' + row.code"
                          [value]="row.code"
                          [checked]="baseCode() === row.code"
                          [disabled]="!canManage() || !row.canBeBase"
                          (change)="setBaseCurrency(row.code)"
                        />
                        @if (!row.canBeBase) {
                          <span class="block text-[10px] text-slate-400">sin tasa</span>
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

            @if (baseDirty()) {
              <p class="border-t border-slate-200 px-5 py-2 text-xs text-slate-500">
                Al guardar, los montos del sistema se mostrarán primero en
                <span class="font-medium text-slate-700">{{ baseLabel() }}</span>.
              </p>
            }

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
                  [disabled]="(!currencyDirty && !baseDirty()) || currencySaving()"
                  (click)="resetCurrencies()"
                >
                  Descartar
                </button>
                <button
                  type="button"
                  class="btn-primary"
                  [disabled]="!canManage() || (!currencyDirty && !baseDirty()) || currencySaving()"
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

      <!-- Sección: Datos (respaldo del catálogo) -->
      @if (section() === 'data') {

        <!-- Exportar: el catálogo completo en un archivo JSON. -->
        <section class="card mb-4">
          <div class="card-header">
            <div>
              <h2 class="text-sm font-semibold text-slate-900">Exportar el catálogo</h2>
              <p class="mt-0.5 text-xs text-slate-500">
                Descarga las categorías, los proveedores, los productos con su stock y los
                menús con su receta en un solo archivo JSON. Guárdalo donde quieras: sirve
                para llevarte los datos a otro equipo y para volver a cargarlos tras un
                borrado accidental.
              </p>
            </div>
            <app-icon name="folder" size="h-5 w-5 text-slate-400" />
          </div>

          <div class="card-body flex flex-wrap items-center gap-3">
            <button
              type="button"
              class="btn-primary"
              [disabled]="exporting()"
              (click)="exportCatalog()"
            >
              <app-icon name="download" size="h-4 w-4" />
              {{ exporting() ? 'Preparando…' : 'Descargar respaldo' }}
            </button>
            <p class="text-xs text-slate-500">
              El archivo se descarga con la fecha del día
              (nexo-hub-catalogo-AAAA-MM-DD.json).
            </p>
          </div>
        </section>

        <!-- Importar: vuelve a cargar un archivo exportado antes. -->
        <section class="card mb-4">
          <div class="card-header">
            <div>
              <h2 class="text-sm font-semibold text-slate-900">Importar el catálogo</h2>
              <p class="mt-0.5 text-xs text-slate-500">
                Carga un archivo exportado antes. La importación es incremental: crea lo que
                falta y respeta lo que ya está, y los registros del local que no vengan en el
                archivo no se borran.
              </p>
            </div>
            <span class="badge bg-slate-100 text-slate-600">{{ importModeLabel() }}</span>
          </div>

          <div class="card-body space-y-4">
            <div class="grid gap-3 sm:grid-cols-2">
              @for (option of importModeOptions; track option.value) {
                <button
                  type="button"
                  class="flex items-start gap-3 rounded-xl border px-4 py-3 text-left transition"
                  [class]="
                    importMode() === option.value
                      ? 'border-brand-300 bg-brand-50/60'
                      : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                  "
                  [attr.aria-pressed]="importMode() === option.value"
                  (click)="setImportMode(option.value)"
                >
                  <app-icon
                    [name]="option.value === 'merge' ? 'refresh' : 'check'"
                    size="h-5 w-5 shrink-0"
                    [class]="importMode() === option.value ? 'text-brand-600' : 'text-slate-400'"
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

            <div class="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
              <input
                #catalogFileInput
                type="file"
                accept="application/json,.json"
                class="hidden"
                (change)="importCatalog($event)"
              />
              <button
                type="button"
                class="btn-secondary"
                [disabled]="importing()"
                (click)="catalogFileInput.click()"
              >
                <app-icon name="upload" size="h-4 w-4" />
                {{ importing() ? 'Importando…' : 'Elegir archivo' }}
              </button>
              <p class="text-xs text-slate-500">
                Antes de cargar nada se muestra qué trae el archivo y se pide confirmación.
              </p>
            </div>
          </div>
        </section>

        <!-- Resumen de la última importación: qué entró y qué quedó fuera. -->
        @if (importResult()) {
          <section class="card">
            <div class="card-header">
              <div>
                <h2 class="text-sm font-semibold text-slate-900">Resultado de la importación</h2>
                <p class="mt-0.5 text-xs text-slate-500">
                  {{ importSummary() }} Importar no borra nada: solo crea y actualiza.
                </p>
              </div>
              <span class="badge bg-slate-100 text-slate-600">{{ importSaved() }} guardados</span>
            </div>

            <div class="card-body space-y-4">
              <div class="table-wrap">
                <table class="table">
                  <thead>
                    <tr>
                      <th>Entidad</th>
                      <th class="text-right">Creados</th>
                      <th class="text-right">Actualizados</th>
                      <th class="text-right">Omitidos</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of importRows(); track row.entity) {
                      <tr>
                        <td class="font-medium text-slate-700">{{ row.label }}</td>
                        <td class="text-right text-emerald-700">{{ row.created }}</td>
                        <td class="text-right text-slate-600">{{ row.updated }}</td>
                        <td class="text-right text-slate-400">{{ row.skipped }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>

              @if (importIssues().length > 0) {
                <div class="space-y-2">
                  <h3 class="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Avisos
                  </h3>
                  <ul class="space-y-2">
                    @for (issue of importIssues(); track $index) {
                      <li
                        class="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs"
                        [class]="
                          issue.level === 'error'
                            ? 'border-rose-200 bg-rose-50 text-rose-700'
                            : 'border-amber-200 bg-amber-50 text-amber-700'
                        "
                      >
                        <app-icon
                          [name]="issue.level === 'error' ? 'alert' : 'info'"
                          size="h-4 w-4 shrink-0"
                        />
                        <span class="min-w-0">
                          <span class="font-semibold">{{ entityLabel(issue.entity) }}</span>
                          <span class="font-medium"> · {{ issue.reference }}</span>
                          <span class="block">{{ issue.message }}</span>
                        </span>
                      </li>
                    }
                  </ul>
                </div>
              }
            </div>
          </section>
        }

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
  private readonly dataTransfer = inject(DataTransferService);
  private readonly themeService = inject(ThemeService);
  readonly auth = inject(AuthService);

  readonly rateMeta = RATE_META;
  readonly baseCurrency = BASE_CURRENCY;
  readonly localCurrency = currencyMeta(LOCAL_CURRENCY_CODE);
  readonly rate = rate;
  readonly bs = bs;
  readonly money = money;
  readonly signedPercent = signedPercent;
  readonly canManage = this.auth.canManage;

  /** Moneda con la que el sistema muestra los montos ahora mismo. */
  readonly displayBase = this.ratesService.baseCurrency;

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
      value: 'pos',
      label: 'Cajero',
      icon: 'shopping-cart',
      hint: 'Vista del catálogo, propina sugerida, moneda, conversiones, precio en dólares BCV y tasa de cobro del cajero.',
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
    {
      value: 'data',
      label: 'Datos',
      icon: 'folder',
      hint: 'Exporta el catálogo a un archivo o impórtalo en este local.',
    },
  ];

  /**
   * Pestañas que se pueden ver. «Datos» solo aparece para ADMIN y MANAGER: la
   * importación escribe precios, costos y stock de golpe y el API la rechaza para
   * el resto de los roles, así que no se ofrece un botón que no puede funcionar.
   */
  readonly visibleTabs = computed(() =>
    this.tabs.filter((tab) => tab.value !== 'data' || this.canManage()),
  );

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

  // ------------------------------- Cajero (POS) ------------------------------
  /**
   * Cómo lista el catálogo el punto de venta. Es una preferencia de la empresa y
   * se guarda al elegirla (como la presentación de los formularios), sin esperar
   * al botón de la pestaña Cajero.
   */
  readonly posView = this.preferences.posView;

  /** Vistas del catálogo que puede elegir el admin. */
  readonly posViewOptions: {
    value: PosView;
    label: string;
    hint: string;
    icon: string;
  }[] = [
    {
      value: 'cards',
      label: 'Tarjetas',
      hint: 'Productos con foto en una grilla cómoda para tocar.',
      icon: 'grid',
    },
    {
      value: 'table',
      label: 'Tabla',
      hint: 'Listado compacto de 20 artículos por página.',
      icon: 'table',
    },
    {
      value: 'columns',
      label: 'Columnas',
      hint: 'Sin fotos: columnas de 10 artículos, uno debajo del otro.',
      icon: 'menu',
    },
  ];

  /** Nombre de la vista del catálogo elegida (chip de la cabecera). */
  readonly posViewLabel = computed(
    () => this.posViewOptions.find((option) => option.value === this.posView())?.label ?? '',
  );

  /**
   * Propina sugerida guardada en la empresa: la que el POS propone en cada venta
   * nueva. Lo que se elige en la pantalla vive en `tipDraft` hasta pulsar «Guardar
   * cambios», para que recorrer las opciones no cambie la propina de todo el local.
   */
  readonly tipPercent = this.preferences.tipPercent;

  /** Propinas de atajo que ofrece la pantalla (0 % = sin propina). */
  readonly tipPercentPresets = TIP_PERCENT_PRESETS;

  /** Propina elegida en la pantalla, todavía sin guardar. */
  readonly tipDraft = signal(this.preferences.tipPercent());

  /** Texto editable del porcentaje (se normaliza al salir del campo). */
  tipInput = String(this.preferences.tipPercent());

  /** Nombre de la propina elegida (chip de la cabecera). */
  readonly tipPercentLabel = computed(() =>
    this.tipDraft() === 0 ? 'Sin propina' : `${this.tipDraft()} %`,
  );

  /**
   * Moneda en la que el cajero ve los precios (`null` = moneda base del sistema).
   * Es una preferencia de la **empresa**, como la propina: la comparte todo el
   * personal de caja. `RatesService` la aplica a los montos de quien **no**
   * administra el local.
   */
  readonly priceCurrency = this.preferences.priceCurrency;

  /** Moneda elegida en la pantalla, todavía sin guardar. */
  readonly priceCurrencyDraft = signal<string | null>(this.preferences.priceCurrency());

  /**
   * `true` cuando hay algo elegido en la pestaña Cajero sin guardar: es lo que
   * habilita «Guardar cambios» y lo que permite descartar sin dejar rastro.
   */
  readonly posDirty = computed(
    () =>
      this.tipDraft() !== this.tipPercent() ||
      this.priceCurrencyDraft() !== this.priceCurrency() ||
      this.conversionsDirty() ||
      this.bcvPriceDirty() ||
      this.chargeRateDirty(),
  );

  /** Monedas elegibles: las habilitadas y con tasa configurada. */
  readonly priceCurrencyOptions = computed(() =>
    this.ratesService
      .currencies()
      .filter((item) => item.enabled && item.bsPerUnit !== null),
  );

  /** Nombre de la moneda elegida (chip de la cabecera). */
  readonly priceCurrencyLabel = computed(() => {
    const code = this.priceCurrencyDraft();
    if (!code) return `Moneda base (${this.displayBase().code})`;
    return this.ratesService.currencyLabel(code);
  });

  /**
   * Cómo se ve un precio de $ 10.00 con la moneda elegida: el ejemplo que la
   * pantalla muestra para comprobar la conversión antes de guardarla.
   */
  readonly pricePreview = computed(() => {
    const base = this.displayBase();
    const code = this.priceCurrencyDraft();
    if (!code || code === base.code) {
      return `Los precios se ven en ${base.label}: un producto de $ 10.00 se muestra ${money(10)}.`;
    }
    const converted = this.ratesService.fromBase(10, code);
    if (converted === null) {
      return `Falta la tasa de ${code}: los precios se ven en ${base.label}.`;
    }
    return `Un producto de $ 10.00 se ve ${moneyIn(converted, code)}.`;
  });

  /**
   * Conversiones activadas para el cajero, todavía sin guardar. Por defecto
   * ninguna: el personal de caja ve los precios en su moneda y nada debajo.
   */
  readonly conversionDraft = signal<string[]>(this.preferences.conversionCurrencies() ?? []);

  /** Monedas que se pueden activar: las habilitadas y con tasa configurada. */
  readonly conversionOptions = computed(() =>
    this.priceCurrencyOptions().map((currency) => ({
      code: currency.code,
      label: `${currency.label || currency.code} (${currency.code})`,
      hint: this.conversionHint(currency),
    })),
  );

  /** Chip de la cabecera: qué monedas verá el cajero debajo de cada monto. */
  readonly conversionSummary = computed(() => {
    const chosen = this.conversionDraft();
    return chosen.length ? chosen.join(' · ') : 'Sin conversiones';
  });

  /**
   * Precio en dólares del BCV activado para el cajero, todavía sin guardar. Por
   * defecto apagado: el cajero ve las conversiones de arriba y nada más.
   */
  readonly bcvPriceDraft = signal(this.preferences.showBcvPrice());

  /** Chip de la cabecera del precio en dólares del BCV. */
  readonly bcvPriceLabel = computed(() =>
    this.bcvPriceDraft() ? 'Activado' : 'Desactivado',
  );

  /**
   * Cómo se ve un producto de 10 unidades con el precio en dólares del BCV: el
   * ejemplo que la pantalla muestra para comprobar la línea antes de guardarla.
   * Sigue a la moneda elegida arriba: con los precios en bolívares enseña los
   * dólares oficiales de esos bolívares y con los precios en una divisa, los
   * bolívares de esa tasa.
   */
  readonly bcvPricePreview = computed(() => {
    const code = this.priceCurrencyDraft() ?? this.displayBase().code;
    const line = this.ratesService.bcvUsdConversion(10, null, code);
    if (!line) {
      return 'Todavía no hay tasa del BCV: se carga sola y se ve en Tasas → Tasas BCV.';
    }
    const sample = moneyIn(10, code);
    return `Un producto de ${sample} se ve también ${line.label} ${line.text}.`;
  });

  /**
   * Pista de cada moneda en la lista de conversiones: de dónde sale su tasa, que
   * es lo que distingue dos líneas con el mismo código (el dólar del BCV y el de
   * la tasa personalizada del local).
   */
  private conversionHint(currency: CurrencyRateOption): string {
    if (currency.code === LOCAL_CURRENCY_CODE) {
      return 'El equivalente en bolívares de cada monto, con cada tasa del sistema.';
    }
    switch (currency.source) {
      case 'CUSTOM':
        return 'Con la tasa personalizada del local.';
      case 'BCV':
        return currency.code === BASE_CURRENCY_CODE
          ? 'Con la tasa del BCV y, si el local la definió, la personalizada.'
          : 'Con la tasa del BCV.';
      case 'MANUAL':
        return 'Con la tasa manual configurada en Tasas → Monedas.';
      default:
        return 'Con la tasa configurada en Tasas → Monedas.';
    }
  }

  /** `true` cuando lo elegido para el cajero no es lo guardado (sin importar el orden). */
  private conversionsDirty(): boolean {
    const stored = this.preferences.conversionCurrencies() ?? [];
    const draft = this.conversionDraft();
    return (
      draft.length !== stored.length ||
      [...draft].sort().join(',') !== [...stored].sort().join(',')
    );
  }

  /** `true` cuando el precio en dólares del BCV de la pantalla no es lo guardado. */
  private bcvPriceDirty(): boolean {
    return this.bcvPriceDraft() !== this.preferences.showBcvPrice();
  }

  /**
   * Tasa del dólar con la que el cajero cobra, todavía sin guardar
   * (`null` = la tasa activa del sistema). Por defecto se cobra con la activa.
   */
  readonly chargeRateDraft = signal<ChargeRateKey | null>(this.preferences.chargeRateKey());

  /**
   * Tasas del dólar que el admin puede fijar como tasa de cobro: la del BCV y la
   * personalizada del local, con su valor en bolívares por dólar (o `null` cuando
   * todavía no hay tasa con la que cobrar).
   */
  readonly chargeRateOptions = computed(() => {
    const rates = this.ratesService.rates();
    return CHARGE_RATE_KEYS.map((key) => ({
      key,
      label: RATE_META[key]?.label ?? key,
      rate: rates.find((item) => item.key === key)?.rate ?? null,
    }));
  });

  /** Chip de la cabecera de la tarjeta «Cobro». */
  readonly chargeRateLabel = computed(() => {
    const key = this.chargeRateDraft();
    return key ? (RATE_META[key]?.label ?? key) : 'Tasa activa';
  });

  /**
   * Cómo cobra el cajero con la tasa elegida: el ejemplo que la pantalla muestra
   * para comprobar la tasa antes de guardarla.
   */
  readonly chargeRatePreview = computed(() => {
    const key = this.chargeRateDraft();
    if (!key) {
      return 'El cajero cobra con la tasa activa del sistema: la personalizada del dólar o, si no existe, la del BCV.';
    }
    const option = this.chargeRateOptions().find((item) => item.key === key);
    if (!option || option.rate === null) {
      return `La ${RATE_META[key]?.label ?? key} todavía no tiene tasa: configúrala en Tasas.`;
    }
    return `El cajero cobra a ${option.label} Bs ${rate(option.rate)} por $ 1.`;
  });

  /** `true` cuando la tasa de cobro de la pantalla no es lo guardado. */
  private chargeRateDirty(): boolean {
    return this.chargeRateDraft() !== this.preferences.chargeRateKey();
  }

  // ----------------------------- Monedas aceptadas ---------------------------
  readonly currencySaving = this.currenciesService.saving;
  /** Filas editables de la tabla de monedas. */
  currencyRows: CurrencyRow[] = [];
  /** Moneda pendiente de agregar (select del catalogo). */
  newCurrencyCode = 'EUR';
  /** `true` cuando hay cambios sin guardar en la tabla de monedas. */
  currencyDirty = false;
  /** Moneda base elegida sin guardar (`null` = la guardada). */
  readonly baseDraft = signal<string | null>(null);
  /** Moneda base guardada en el backend. */
  private readonly storedBaseCode = this.ratesService.baseCode;
  /** Moneda base que quedará al guardar (la elegida o la guardada). */
  readonly baseCode = computed(() => this.baseDraft() ?? this.storedBaseCode());
  /** `true` cuando la moneda base elegida aún no se ha guardado. */
  readonly baseDirty = computed(() => this.baseCode() !== this.storedBaseCode());
  /** Etiqueta de la moneda base elegida, ej. `Bolívares (VES)`. */
  readonly baseLabel = computed(() => {
    const code = this.baseCode();
    return `${currencyMeta(code).label} (${code})`;
  });

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

  // ------------------------- Datos (respaldo del catálogo) --------------------

  /** Descarga del catálogo en curso (el botón no se puede pulsar dos veces). */
  readonly exporting = signal(false);

  /** Importación en curso: elegir archivo → leer → confirmar → cargar. */
  readonly importing = signal(false);

  /** Qué hacer con los registros que ya existen (viaja en el query string). */
  readonly importMode = signal<CatalogImportMode>('merge');

  /** Resultado de la última importación (se resume debajo del botón). */
  readonly importResult = signal<CatalogImportResult | null>(null);

  /** Entidades del catálogo, en el orden en que se resumen. */
  readonly catalogEntities = CATALOG_ENTITIES;

  /** Modos de importación, con lo que hace cada uno. */
  readonly importModeOptions: {
    value: CatalogImportMode;
    label: string;
    hint: string;
  }[] = [
    {
      value: 'merge',
      label: 'Actualizar los que ya existen',
      hint: 'El archivo manda: lo que tenga el mismo nombre o SKU se sobrescribe.',
    },
    {
      value: 'skip',
      label: 'Dejar los que ya existen',
      hint: 'Solo se agregan los que faltan; lo que ya está en el local no se toca.',
    },
  ];

  /** Nombre del modo elegido (chip de la cabecera). */
  readonly importModeLabel = computed(
    () => this.importModeOptions.find((option) => option.value === this.importMode())?.label ?? '',
  );

  /** Filas del resumen de la última importación (una por entidad). */
  readonly importRows = computed(() => {
    const result = this.importResult();
    if (!result) return [];
    return this.catalogEntities.map((entity) => ({
      entity,
      label: CATALOG_ENTITY_LABELS[entity],
      created: result.created[entity] ?? 0,
      updated: result.updated[entity] ?? 0,
      skipped: result.skipped[entity] ?? 0,
    }));
  });

  /** Registros que entraron (creados + actualizados) en la última importación. */
  readonly importSaved = computed(() => {
    const result = this.importResult();
    return result ? catalogSum(result.created) + catalogSum(result.updated) : 0;
  });

  /** Registros que se dejaron como estaban (ya existían y el modo fue «omitir»). */
  readonly importSkipped = computed(() => {
    const result = this.importResult();
    return result ? catalogSum(result.skipped) : 0;
  });

  /** Resumen en una línea de la última importación. */
  readonly importSummary = computed(() => {
    const result = this.importResult();
    if (!result) return '';
    const parts = [
      `${catalogSum(result.created)} creados`,
      `${catalogSum(result.updated)} actualizados`,
    ];
    const skipped = catalogSum(result.skipped);
    if (skipped > 0) parts.push(`${skipped} omitidos (ya existían)`);
    return `${parts.join(', ')}.`;
  });

  /** Avisos de la última importación, con los errores primero. */
  readonly importIssues = computed(() => {
    const issues = [...(this.importResult()?.issues ?? [])];
    return issues.sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
  });

  /** Nombre en español de una entidad (tabla del resumen y avisos). */
  entityLabel(entity: CatalogEntity): string {
    return CATALOG_ENTITY_LABELS[entity] ?? entity;
  }

  /** Descarga el catálogo completo del local como archivo JSON. */
  exportCatalog(): void {
    if (this.exporting()) return;

    this.exporting.set(true);
    this.dataTransfer.exportCatalog().subscribe({
      next: (document) => {
        this.exporting.set(false);
        downloadJson(catalogFileName(document.exportedAt), document);
        this.toast.success(
          `${catalogSum(document.counts)} registros en el archivo`,
          'Catálogo exportado',
        );
      },
      // El aviso del error lo da el interceptor; aquí solo se libera el botón.
      error: () => this.exporting.set(false),
    });
  }

  setImportMode(mode: CatalogImportMode): void {
    this.importMode.set(mode);
  }

  /**
   * Lee el archivo elegido y, si es un respaldo del catálogo, pide confirmación
   * antes de enviarlo: importar ESCRIBE en el catálogo del local.
   */
  async importCatalog(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Se vacía el input para poder elegir el MISMO archivo otra vez (por ejemplo,
    // tras volver a exportarlo o para probar el otro modo).
    input.value = '';
    if (!file || this.importing()) return;

    this.importing.set(true);
    this.importResult.set(null);

    let payload: unknown;
    let overview: CatalogFileOverview;
    try {
      payload = await readJsonFile(file);
      overview = catalogFileOverview(payload);
    } catch (error) {
      this.importing.set(false);
      // No hubo petición al API: el aviso se da aquí (el interceptor solo cubre
      // los errores de HTTP).
      this.toast.error(apiErrorMessage(error), 'Archivo inválido');
      return;
    }

    const origen = overview.exportedAt
      ? `${overview.companyName}, exportado el ${dateTime(overview.exportedAt)}`
      : overview.companyName;
    const queHacer =
      this.importMode() === 'merge'
        ? 'Los registros que ya existan se actualizarán con el archivo.'
        : 'Solo se agregarán los que falten: lo que ya está en el local no se toca.';
    const confirmed = await this.confirm.ask({
      title: 'Importar catálogo',
      message:
        `${file.name} trae ${overview.total} registros de ${origen}. ${queHacer} ` +
        'Lo que esté en el local y no venga en el archivo no se borra. ¿Continuar?',
      confirmLabel: 'Importar',
    });
    if (!confirmed) {
      this.importing.set(false);
      return;
    }

    this.dataTransfer.importCatalog(payload, this.importMode()).subscribe({
      next: (result) => {
        this.importing.set(false);
        this.importResult.set(result);
        if (result.issues.some((issue) => issue.level === 'error')) {
          this.toast.warning(
            'Algunos registros quedaron fuera: revisa los avisos.',
            'Catálogo importado',
          );
        } else {
          this.toast.success(this.importSummary(), 'Catálogo importado');
        }
      },
      error: () => this.importing.set(false),
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
    const tabs = this.visibleTabs();
    const index = tabs.findIndex((tab) => tab.value === current);
    if (index < 0) return;

    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    let next: number | null = step === 0 ? null : (index + step + tabs.length) % tabs.length;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    if (next === null) return;

    event.preventDefault();
    const target = tabs[next];
    this.setSection(target.value);
    // El foco acompaña a la selección (patrón "roving tabindex").
    (event.currentTarget as HTMLElement)
      .closest('[role="tablist"]')
      ?.querySelector<HTMLElement>(`#${target.value}-tab`)
      ?.focus();
  }

  /** Enciende o apaga los montos "al cambio" (preferencia de este navegador). */
  setConversions(show: boolean): void {
    this.ratesService.setConversions(show);
  }

  /**
   * Cambia la presentación de los formularios de caja y pedidos: como el tema, se
   * aplica al instante. Se guarda para la empresa activa —la comparte todo el
   * personal y viaja al servidor— sin pasar por el botón de la pestaña Cajero, que
   * solo cubre la propina sugerida y la moneda de los precios.
   */
  setDialogView(view: DialogView): void {
    if (this.dialogView() === view) return;
    this.preferences.setDialogView(view);
  }

  /**
   * Cambia la vista del catálogo del cajero (tarjetas, tabla o columnas). Se
   * aplica al instante y viaja a la empresa, así que el POS de cualquier equipo
   * la recibe al actualizar sus preferencias.
   */
  setPosView(view: PosView): void {
    if (this.posView() === view) return;
    this.preferences.setPosView(view);
  }

  // --------------------------------- Cajero ----------------------------------

  /**
   * Elige una propina en la pantalla. Todavía no se guarda: la pestaña espera al
   * botón «Guardar cambios» para que recorrer las opciones no cambie la propina
   * que comparte todo el local.
   */
  pickTipPercent(percent: number): void {
    this.tipDraft.set(normalizeTipPercent(percent));
    this.tipInput = String(this.tipDraft());
  }

  /** Normaliza el porcentaje escrito a mano (0-100) en lo elegido en pantalla. */
  applyTipInput(): void {
    this.pickTipPercent(Number(this.tipInput));
  }

  /** Elige la moneda de los precios en la pantalla (`''` = moneda base). */
  pickPriceCurrency(code: string | null): void {
    this.priceCurrencyDraft.set(code || null);
  }

  /** `true` cuando esa moneda está activada en la pantalla (aún sin guardar). */
  showsConversion(code: string): boolean {
    return this.conversionDraft().includes(code);
  }

  /**
   * Enciende o apaga una conversión del cajero. Como la propina y la moneda, no se
   * guarda hasta pulsar «Guardar cambios»: recorrer los interruptores no cambia lo
   * que ve el personal del local. Lo elegido queda en el orden de la lista, para
   * que lo guardado se lea igual que se ve en la pantalla.
   */
  toggleConversion(code: string, show: boolean): void {
    const enabled = new Set(this.conversionDraft());
    if (show) enabled.add(code);
    else enabled.delete(code);
    this.conversionDraft.set(
      this.conversionOptions()
        .map((option) => option.code)
        .filter((item) => enabled.has(item)),
    );
  }

  /**
   * Enciende o apaga el **precio en dólares del BCV** en la pantalla. Como la
   * propina, la moneda y las conversiones, no se guarda hasta pulsar «Guardar
   * cambios».
   */
  toggleBcvPrice(show: boolean): void {
    this.bcvPriceDraft.set(show);
  }

  /** Elige la tasa de cobro en la pantalla (`''` = la tasa activa del sistema). */
  pickChargeRate(key: string | null): void {
    this.chargeRateDraft.set(normalizeChargeRateKey(key));
  }

  /** Deshace lo elegido en la pestaña Cajero y vuelve a lo que está guardado. */
  discardPos(): void {
    this.tipDraft.set(this.tipPercent());
    this.priceCurrencyDraft.set(this.priceCurrency());
    this.conversionDraft.set(this.preferences.conversionCurrencies() ?? []);
    this.bcvPriceDraft.set(this.preferences.showBcvPrice());
    this.chargeRateDraft.set(this.preferences.chargeRateKey());
    this.tipInput = String(this.tipPercent());
  }

  /**
   * Guarda las preferencias del cajero. Las cinco **viajan a la empresa**
   * (`PATCH /preferences`): la propina sugerida, la moneda en la que se ven los
   * precios, las conversiones que puede ver debajo de cada monto, el precio en
   * dólares del BCV y la tasa de cobro las comparte todo el personal, así que el
   * cajero que entra desde otro equipo las recibe al iniciar sesión. Los montos
   * de esta sesión se repintan con la moneda nueva sin esperar a la próxima carga
   * de tasas.
   */
  savePosPreferences(): void {
    if (!this.posDirty()) return;

    this.preferences.setPosPreferences(
      this.tipDraft(),
      this.priceCurrencyDraft(),
      this.conversionDraft(),
      this.bcvPriceDraft(),
      this.chargeRateDraft(),
    );
    this.ratesService.applyDisplayPreference();

    // El servicio normaliza lo guardado: la pantalla refleja eso, no el borrador.
    this.tipInput = String(this.tipPercent());
    this.toast.success(
      'La propina, la moneda de los precios, las conversiones, el precio en dólares BCV y la tasa de cobro se guardan para toda la empresa.',
      'Preferencias guardadas',
    );
  }

  /**
   * Cambia entre modo claro y oscuro. El tema se aplica de inmediato a todo el
   * sistema (la clase `dark` en <html> reescribe los colores) y, como el menú
   * lateral, se guarda solo en este navegador.
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
      // Solo se puede mostrar en una moneda que tenga tasa (1 Bs para el bolivar).
      canBeBase: item.bsPerUnit !== null,
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
        // Sin tasa todavia: primero hay que configurarla para usarla como base.
        canBeBase: false,
      },
    ];
    this.currencyDirty = true;
  }

  /**
   * Elige la moneda con la que se muestran los montos del sistema. Se aplica al
   * guardar (junto con las monedas), no al marcarla.
   */
  setBaseCurrency(code: string): void {
    this.baseDraft.set(code);
  }

  removeCurrency(code: string): void {
    // USD, VES y EUR son monedas por defecto: se desactivan, no se quitan.
    if (code === BASE_CURRENCY_CODE || isDefaultCurrency(code)) return;
    this.currencyRows = this.currencyRows.filter((row) => row.code !== code);
    // Si la moneda quitada era la base elegida, se vuelve al dólar.
    if (this.baseCode() === code) this.baseDraft.set(BASE_CURRENCY_CODE);
    this.currencyDirty = true;
  }

  /** Descarta los cambios y vuelve a la configuracion guardada. */
  resetCurrencies(): void {
    this.currencyDirty = false;
    this.baseDraft.set(null);
    this.currencyRows = this.toRows(this.ratesService.currencies());
  }

  saveCurrencies(): void {
    if ((!this.currencyDirty && !this.baseDirty()) || this.currencySaving()) return;

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

    const base = this.baseCode();
    if (!this.currencyRows.some((row) => row.code === base)) {
      this.toast.warning(
        `Agrega ${base} a la lista de monedas para poder mostrar los montos en ella.`,
      );
      return;
    }

    this.currenciesService.save(payload, base, () => {
      this.currencyDirty = false;
      this.baseDraft.set(null);
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
