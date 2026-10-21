import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
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
  NotificationSettings,
  NotificationSettingsPayload,
  TelegramLinkCode,
  UpdateProfilePayload,
} from '../../core/models/api.model';
import { AuthService } from '../../core/services/auth.service';
import { CompaniesService } from '../../core/services/companies.service';
import { CurrenciesService } from '../../core/services/currencies.service';
import { DataTransferService } from '../../core/services/data-transfer.service';
import { NotificationsService } from '../../core/services/notifications.service';
import {
  catalogFileName,
  catalogFileOverview,
  catalogSum,
  downloadJson,
  readJsonFile,
  type CatalogFileOverview,
} from '../../core/utils/catalog-file';
import {
  PreferencesService,
  TIP_PERCENT_PRESETS,
  normalizeTipPercent,
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
export type SettingsSection =
  | 'rates'
  | 'appearance'
  | 'pos'
  | 'notifications'
  | 'company'
  | 'profile'
  | 'data';

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
  templateUrl: './settings.page.html',
})
export class SettingsPage implements OnInit, OnDestroy {
  private readonly ratesService = inject(RatesService);
  private readonly currenciesService = inject(CurrenciesService);
  private readonly notificationsService = inject(NotificationsService);
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
  readonly dateTime = dateTime;
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
      hint: 'Vista del catálogo, propina sugerida, moneda, conversiones y precio en dólares BCV.',
    },
    {
      value: 'notifications',
      label: 'Notificaciones',
      icon: 'bell',
      hint: 'Telegram, QR de vinculación y avisos de stock, ventas, caja y cancelaciones.',
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
    this.tabs.filter(
      (tab) =>
        (tab.value !== 'data' && tab.value !== 'notifications') ||
        this.canManage(),
    ),
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
      this.bcvPriceDirty(),
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

  /** Tasa oficial del dólar con la que se cobra (`null` si el BCV no responde). */
  readonly chargeRateValue = computed(
    () => this.ratesService.rates().find((item) => item.key === 'BCV_USD')?.rate ?? null,
  );

  /**
   * Ejemplo de la regla de cobro: el precio de vitrina puede estar inflado con
   * la tasa personalizada, pero el cobro siempre se calcula a la tasa BCV.
   */
  readonly chargeRulePreview = computed(() => {
    const bcv = this.chargeRateValue();
    if (bcv === null) {
      return 'No se pudo leer la tasa oficial del BCV: el cobro quedará bloqueado hasta que esté disponible.';
    }
    const custom = this.ratesService.custom()?.usd ?? null;
    const charge = bs(10 * bcv);
    if (custom === null) {
      return `Un producto de $ 10.00 se muestra y se cobra a la tasa BCV: ${charge}.`;
    }
    return `Un producto de $ 10.00 se muestra ${bs(10 * custom)} en vitrina y se cobra ${charge} a la tasa BCV.`;
  });

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

  // ------------------------------- Notificaciones ----------------------------
  /** Configuración guardada y borrador editable de los avisos. */
  readonly notificationSettings = signal<NotificationSettings | null>(null);
  readonly notificationDraft = signal<NotificationSettings | null>(null);
  readonly notificationsLoading = signal(false);
  readonly notificationsSaving = signal(false);
  readonly notificationsDirty = signal(false);
  readonly linkingTelegram = signal(false);
  readonly testingTelegram = signal(false);
  /** Código recién generado (el backend también lo devuelve en `getSettings`). */
  readonly telegramLink = signal<TelegramLinkCode | null>(null);
  /** `true` mientras se espera que el admin envíe el código al bot. */
  private linkPoll: ReturnType<typeof setInterval> | null = null;

  /** QR público del bot; el `<img>` no puede enviar la cabecera JWT. */
  readonly telegramQrUrl = this.notificationsService.qrUrl;

  /** Código vigente que debe enviarse al bot (recién generado o guardado). */
  readonly activeLinkCode = computed(
    () =>
      this.telegramLink()?.code ??
      this.notificationSettings()?.linkCode ??
      null,
  );

  /** Enlace directo al bot con el código ya cargado (si se conoce el usuario). */
  readonly telegramDeepLink = computed(() => {
    const link = this.telegramLink();
    if (link?.deepLink) return link.deepLink;
    const username = this.notificationSettings()?.botUsername;
    const code = this.activeLinkCode();
    return username && code ? `https://t.me/${username}?start=${code}` : null;
  });

  /** Vencimiento visible del código de vinculación. */
  readonly linkExpiresLabel = computed(() => {
    const expires =
      this.telegramLink()?.expiresAt ??
      this.notificationSettings()?.linkCodeExpiresAt ??
      null;
    return expires ? dateTime(expires) : '';
  });

  /** Opciones de aviso, con su explicación, en el orden de la pantalla. */
  readonly notificationOptions: {
    key: keyof NotificationSettingsPayload;
    label: string;
    hint: string;
  }[] = [
    {
      key: 'notifyLowStock',
      label: 'Stock en el mínimo',
      hint: 'Cuando un producto cruza su stock mínimo (una sola vez por bajada).',
    },
    {
      key: 'notifySales',
      label: 'Ventas y cobros',
      hint: 'Cada cobro con el resumen de productos, monto, método y saldo.',
    },
    {
      key: 'notifyCashClose',
      label: 'Cierre de caja',
      hint: 'Al cerrar la sesión: ventas netas, total recaudado y diferencia del arqueo.',
    },
    {
      key: 'notifyCancellations',
      label: 'Cancelaciones',
      hint: 'Cuando se cancela un pedido, con el detalle y quién lo autorizó.',
    },
  ];

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

  ngOnDestroy(): void {
    this.stopLinkPolling();
  }

  // ------------------------------ Notificaciones -----------------------------

  /** Trae la configuración de Telegram de la empresa y la deja lista para editar. */
  loadNotificationSettings(showLoader = true): void {
    if (showLoader) this.notificationsLoading.set(true);
    this.notificationsService.getSettings().subscribe({
      next: (settings) => {
        this.notificationSettings.set(settings);
        this.notificationDraft.set({ ...settings });
        this.notificationsDirty.set(false);
        this.notificationsLoading.set(false);
        if (settings.telegramLinked) {
          this.stopLinkPolling();
          this.telegramLink.set(null);
        }
      },
      error: (error) => {
        this.notificationsLoading.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  /** Enciende/apaga un aviso del borrador; se guarda con el botón de la tarjeta. */
  setNotificationFlag(
    key: keyof NotificationSettingsPayload,
    value: boolean,
  ): void {
    const draft = this.notificationDraft();
    if (!draft) return;
    this.notificationDraft.set({ ...draft, [key]: value });
    this.notificationsDirty.set(true);
  }

  /** Guarda el interruptor general y los cuatro avisos de una vez. */
  saveNotificationSettings(): void {
    const draft = this.notificationDraft();
    if (!draft || this.notificationsSaving()) return;

    this.notificationsSaving.set(true);
    this.notificationsService
      .update({
        telegramEnabled: draft.telegramEnabled,
        notifyLowStock: draft.notifyLowStock,
        notifySales: draft.notifySales,
        notifyCashClose: draft.notifyCashClose,
        notifyCancellations: draft.notifyCancellations,
      })
      .subscribe({
        next: (settings) => {
          this.notificationSettings.set(settings);
          this.notificationDraft.set({ ...settings });
          this.notificationsDirty.set(false);
          this.notificationsSaving.set(false);
          this.toast.success(
            'Los avisos se guardan para toda la empresa.',
            'Notificaciones guardadas',
          );
        },
        error: (error) => {
          this.notificationsSaving.set(false);
          this.toast.error(apiErrorMessage(error));
        },
      });
  }

  refresh(): void {
    this.dirty = false;
    this.ratesService.load(true);
  }

  /**
   * Genera el código temporal y empieza a comprobar si el administrador ya lo
   * envió al bot. El QR solo abre el bot: el vínculo se confirma con el código.
   */
  generateTelegramLinkCode(): void {
    if (this.linkingTelegram()) return;
    this.linkingTelegram.set(true);
    this.notificationsService.generateLinkCode().subscribe({
      next: (link) => {
        this.linkingTelegram.set(false);
        this.telegramLink.set(link);
        this.startLinkPolling();
        this.toast.success(
          `Escanea el QR y envía /vincular ${link.code} al bot.`,
          'Código de vinculación generado',
        );
      },
      error: (error) => {
        this.linkingTelegram.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  /** Comprueba manualmente si el chat ya quedó vinculado. */
  refreshTelegramStatus(): void {
    this.notificationsService.getSettings().subscribe({
      next: (settings) => {
        this.notificationSettings.set(settings);
        this.notificationDraft.update((current) =>
          current
            ? {
                ...current,
                telegramLinked: settings.telegramLinked,
                telegramChatTitle: settings.telegramChatTitle,
                telegramLinkedAt: settings.telegramLinkedAt,
                telegramConfigured: settings.telegramConfigured,
                botUsername: settings.botUsername,
                linkCode: settings.linkCode,
                linkCodeExpiresAt: settings.linkCodeExpiresAt,
              }
            : { ...settings },
        );
        if (settings.telegramLinked) {
          this.stopLinkPolling();
          this.telegramLink.set(null);
          this.toast.success(
            settings.telegramChatTitle
              ? `El chat ${settings.telegramChatTitle} recibirá los avisos.`
              : 'El Telegram del administrador quedó vinculado.',
            'Telegram conectado',
          );
        } else {
          this.toast.warning(
            'Todavía no recibimos el código. Revisa que lo enviaste al bot correcto.',
            'Sin vincular',
          );
        }
      },
      error: (error) => this.toast.error(apiErrorMessage(error)),
    });
  }

  sendTelegramTest(): void {
    if (this.testingTelegram()) return;
    this.testingTelegram.set(true);
    this.notificationsService.sendTest().subscribe({
      next: () => {
        this.testingTelegram.set(false);
        this.toast.success('Revisa Telegram: el mensaje de prueba ya salió.');
      },
      error: (error) => {
        this.testingTelegram.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  async unlinkTelegram(): Promise<void> {
    const confirmed = await this.confirm.ask({
      title: 'Desvincular Telegram',
      message:
        'El administrador dejará de recibir los avisos y los cajeros no podrán pedir códigos de cancelación hasta vincularlo de nuevo.',
      confirmLabel: 'Desvincular',
      tone: 'danger',
    });
    if (!confirmed) return;

    this.notificationsService.unlink().subscribe({
      next: (settings) => {
        this.notificationSettings.set(settings);
        this.notificationDraft.set({ ...settings });
        this.telegramLink.set(null);
        this.stopLinkPolling();
        this.toast.success('El Telegram de la empresa quedó desvinculado.');
      },
      error: (error) => this.toast.error(apiErrorMessage(error)),
    });
  }

  private startLinkPolling(): void {
    this.stopLinkPolling();
    this.linkPoll = setInterval(() => {
      this.notificationsService.getSettings().subscribe({
        next: (settings) => {
          if (!settings.telegramLinked) return;
          this.notificationSettings.set(settings);
          this.notificationDraft.update((current) =>
            current
              ? {
                  ...current,
                  telegramLinked: true,
                  telegramChatTitle: settings.telegramChatTitle,
                  telegramLinkedAt: settings.telegramLinkedAt,
                }
              : { ...settings },
          );
          this.telegramLink.set(null);
          this.stopLinkPolling();
          this.toast.success(
            settings.telegramChatTitle
              ? `El chat ${settings.telegramChatTitle} recibirá los avisos.`
              : 'El Telegram del administrador quedó vinculado.',
            'Telegram conectado',
          );
        },
      });
    }, 5000);
  }

  private stopLinkPolling(): void {
    if (this.linkPoll !== null) {
      clearInterval(this.linkPoll);
      this.linkPoll = null;
    }
  }

  /**
   * Cambia de pestaña. La sección elegida vive mientras la pantalla está
   * abierta: al volver a entrar se muestra «Tasas».
   */
  setSection(section: SettingsSection): void {
    this.section.set(section);
    if (
      section === 'notifications' &&
      !this.notificationSettings() &&
      !this.notificationsLoading()
    ) {
      this.loadNotificationSettings();
    }
  }

  /**
   * Navegación por teclado del tablist (�?/→, Inicio y Fin), como pide ARIA:
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

  /** Deshace lo elegido en la pestaña Cajero y vuelve a lo que está guardado. */
  discardPos(): void {
    this.tipDraft.set(this.tipPercent());
    this.priceCurrencyDraft.set(this.priceCurrency());
    this.conversionDraft.set(this.preferences.conversionCurrencies() ?? []);
    this.bcvPriceDraft.set(this.preferences.showBcvPrice());
    this.tipInput = String(this.tipPercent());
  }

  /**
   * Guarda las preferencias del cajero. Las cuatro **viajan a la empresa**
   * (`PATCH /preferences`): la propina sugerida, la moneda en la que se ven los
   * precios, las conversiones que puede ver debajo de cada monto y el precio en
   * dólares del BCV. Los montos de esta sesión se repintan con la moneda nueva
   * sin esperar a la próxima carga de tasas.
   */
  savePosPreferences(): void {
    if (!this.posDirty()) return;

    this.preferences.setPosPreferences(
      this.tipDraft(),
      this.priceCurrencyDraft(),
      this.conversionDraft(),
      this.bcvPriceDraft(),
    );
    this.ratesService.applyDisplayPreference();

    // El servicio normaliza lo guardado: la pantalla refleja eso, no el borrador.
    this.tipInput = String(this.tipPercent());
    this.toast.success(
      'La propina, la moneda de los precios, las conversiones y el precio en dólares BCV se guardan para toda la empresa.',
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
