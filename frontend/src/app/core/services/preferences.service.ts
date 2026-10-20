import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import type {
  ChargeRateKey,
  CompanyPreferences,
  DialogView,
  PosView,
  UpdatePreferencesPayload,
} from '../models/api.model';

export type { ChargeRateKey, DialogView, PosView };

/** Tasa de cobro: siempre la oficial del BCV. */
export const CHARGE_RATE_KEYS: readonly ChargeRateKey[] = ['BCV_USD'];

/** Vistas soportadas (se usan también para validar lo guardado). */
export const DIALOG_VIEWS: readonly DialogView[] = ['modal', 'sidebar'];

/** Presentaciones del catálogo del cajero y su valor de fábrica. */
export const POS_VIEWS: readonly PosView[] = ['cards', 'table', 'columns'];
export const DEFAULT_POS_VIEW: PosView = 'cards';

/** Clave de `localStorage` con la presentación elegida. */
const DIALOG_VIEW_KEY = 'nexo-hub.dialog-view';

/** Clave de `localStorage` con la presentación del catálogo del cajero. */
const POS_VIEW_KEY = 'nexo-hub.pos-view';

/** Clave de `localStorage` con la propina sugerida del punto de venta. */
const TIP_PERCENT_KEY = 'nexo-hub.tip-percent';

/** Clave de `localStorage` con la moneda en la que el cajero ve los precios. */
const PRICE_CURRENCY_KEY = 'nexo-hub.price-currency';

/**
 * Clave de `localStorage` con las conversiones que ve el cajero (JSON con los
 * códigos de moneda).
 */
const CONVERSION_CURRENCIES_KEY = 'nexo-hub.conversion-currencies';

/**
 * Clave de `localStorage` con el interruptor que muestra el precio en dólares a
 * la tasa oficial del BCV debajo de cada monto.
 */
const SHOW_BCV_PRICE_KEY = 'nexo-hub.show-bcv-price';

/**
 * Clave de `localStorage` con la tasa de cobro del cajero (`BCV_USD` o vacío;
 * la personalizada se descarta porque nunca se usa para cobrar).
 */
const CHARGE_RATE_KEY = 'nexo-hub.charge-rate';

/** Tope de monedas en la lista (igual que el API). */
const MAX_CONVERSION_CURRENCIES = 24;

/**
 * Deja un codigo de moneda utilizable (`null` = moneda base del sistema).
 * Cualquier otra cosa (vacio, `Bs`, un codigo incompleto) se descarta.
 */
export function normalizePriceCurrency(value: unknown): string | null {
  const code = String(value ?? '')
    .trim()
    .toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

/**
 * Deja la lista de conversiones del cajero en códigos ISO sin repetir, o en `null`
 * cuando no queda ninguna (es el valor de fábrica: el cajero solo ve los precios
 * en su moneda). Acepta también el JSON con el que se guarda en el navegador.
 */
export function normalizeConversionCurrencies(value: unknown): string[] | null {
  let list: unknown = value;
  if (typeof value === 'string') {
    try {
      list = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(list)) return null;
  const codes = list
    .map((item) => String(item ?? '').trim().toUpperCase())
    .filter((code) => /^[A-Z]{3}$/.test(code));
  const unique = [...new Set(codes)].slice(0, MAX_CONVERSION_CURRENCIES);
  return unique.length ? unique : null;
}

/**
 * Deja el interruptor del precio en dólares del BCV en `true` o `false`. Solo un
 * booleano lo enciende (o el texto con el que queda guardado en el navegador);
 * cualquier otra cosa —incluido `null`— lo apaga.
 */
export function normalizeShowBcvPrice(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

/**
 * Deja la presentación del catálogo del cajero en una de las vistas
 * soportadas (`cards`, `table`, `columns`) o en `null` cuando no se eligió
 * ninguna: sin elección se usan las tarjetas.
 */
export function normalizePosView(value: unknown): PosView | null {
  const view = String(value ?? '')
    .trim()
    .toLowerCase();
  return (POS_VIEWS as readonly string[]).includes(view) ? (view as PosView) : null;
}

/**
 * Deja la tasa de cobro en la única tasa válida (`BCV_USD`) o en `null`, que
 * significa lo mismo. La personalizada se descarta: es solo de vitrina.
 */
export function normalizeChargeRateKey(value: unknown): ChargeRateKey | null {
  const key = String(value ?? '')
    .trim()
    .toUpperCase();
  return (CHARGE_RATE_KEYS as readonly string[]).includes(key)
    ? (key as ChargeRateKey)
    : null;
}

/** Propina sugerida de fábrica (porcentaje): el 10 % de la venta. */
export const DEFAULT_TIP_PERCENT = 10;

/** Propinas que ofrecen los formularios de venta como atajo (porcentaje). */
export const TIP_PERCENT_PRESETS: readonly number[] = [0, 5, 10, 15, 20];

/**
 * Deja un porcentaje de propina utilizable: entre 0 y 100 y con dos decimales
 * como máximo. Cualquier valor no numérico se convierte en 0 (sin propina).
 */
export function normalizeTipPercent(value: unknown): number {
  const percent = Number(value);
  if (!Number.isFinite(percent)) return 0;
  return Math.min(100, Math.max(0, Math.round(percent * 100) / 100));
}

/** Copia local de la vista que tiene configurada la empresa (modal por defecto). */
function storedDialogView(): DialogView {
  try {
    const raw = localStorage.getItem(DIALOG_VIEW_KEY);
    return DIALOG_VIEWS.includes(raw as DialogView) ? (raw as DialogView) : 'modal';
  } catch {
    return 'modal';
  }
}

/**
 * Copia local de la propina que tiene configurada la empresa (10 % por defecto).
 * El arranque pinta con ella antes de que conteste el servidor; al iniciar
 * sesión, lo que responde el servidor manda.
 */
function storedTipPercent(): number {
  try {
    const raw = localStorage.getItem(TIP_PERCENT_KEY);
    return raw === null || raw.trim() === ''
      ? DEFAULT_TIP_PERCENT
      : normalizeTipPercent(raw);
  } catch {
    return DEFAULT_TIP_PERCENT;
  }
}

/**
 * Copia local de la moneda de los precios que tiene configurada la empresa
 * (`null` = moneda base del sistema). El arranque pinta con ella antes de que
 * conteste el servidor; al iniciar sesión, lo que responde el servidor manda.
 */
function storedPriceCurrency(): string | null {
  try {
    return normalizePriceCurrency(localStorage.getItem(PRICE_CURRENCY_KEY));
  } catch {
    return null;
  }
}

/**
 * Copia local de las conversiones que ve el cajero (`null` = ninguna). El arranque
 * pinta con ella antes de que conteste el servidor; al iniciar sesión, lo que
 * responde el servidor manda.
 */
function storedConversionCurrencies(): string[] | null {
  try {
    return normalizeConversionCurrencies(
      localStorage.getItem(CONVERSION_CURRENCIES_KEY),
    );
  } catch {
    return null;
  }
}

/**
 * Copia local del interruptor que muestra el precio en dólares del BCV
 * (`false` por defecto). El arranque pinta con ella antes de que conteste el
 * servidor; al iniciar sesión, lo que responde el servidor manda.
 */
function storedShowBcvPrice(): boolean {
  try {
    return normalizeShowBcvPrice(localStorage.getItem(SHOW_BCV_PRICE_KEY));
  } catch {
    return false;
  }
}

/**
 * Copia local de la tasa de cobro (`null` = la oficial del BCV, que es siempre
 * con la que se cobra). El arranque pinta con ella antes de que conteste el
 * servidor; al iniciar sesión, lo que responde el servidor manda.
 */
function storedChargeRateKey(): ChargeRateKey | null {
  try {
    return normalizeChargeRateKey(localStorage.getItem(CHARGE_RATE_KEY));
  } catch {
    return null;
  }
}

/**
 * Copia local de la vista del catálogo del cajero (`null` = tarjetas). El
 * arranque pinta con ella antes de que conteste el servidor; al iniciar sesión,
 * lo que responde el servidor manda.
 */
function storedPosView(): PosView | null {
  try {
    return normalizePosView(localStorage.getItem(POS_VIEW_KEY));
  } catch {
    return null;
  }
}

/** Vista que llega del servidor: `null` cuando la empresa no la ha configurado. */
function serverDialogView(value: unknown): DialogView | null {
  return DIALOG_VIEWS.includes(value as DialogView) ? (value as DialogView) : null;
}

/** Propina que llega del servidor: `null` cuando la empresa no la ha configurado. */
function serverTipPercent(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const percent = Number(value);
  return Number.isFinite(percent) ? normalizeTipPercent(percent) : null;
}

/**
 * Preferencias de interfaz de la **empresa activa**.
 *
 * La **propina** del punto de venta, la **moneda en la que el cajero ve los
 * precios** —con las **conversiones** que puede ver debajo de cada monto y el
 * **precio en dólares del BCV**— y la **presentación de los formularios** de caja
 * y pedidos viven en el servidor
 * (`GET/PATCH /preferences`, una fila por empresa): son configuración del local,
 * no de cada persona, así que las comparte todo el personal y el cajero que entra
 * desde otro navegador recibe al iniciar sesión lo mismo que ve el resto del
 * equipo. El navegador guarda una copia para pintar de inmediato al abrir la
 * aplicación y para seguir funcionando si el servidor no responde; al hacer login
 * manda lo que responde el servidor.
 *
 * (El tema y el menú lateral sí son preferencias de cada navegador.)
 */
@Injectable({ providedIn: 'root' })
export class PreferencesService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/preferences`;

  private readonly _dialogView = signal<DialogView>(storedDialogView());

  /**
   * Cambios locales hechos mientras viaja una respuesta del servidor: si el
   * usuario toca una preferencia antes de que llegue `GET /preferences`, manda
   * su elección y la respuesta vieja se descarta.
   */
  private revision = 0;

  /**
   * Cómo se muestran los formularios de la operación (caja y pedidos):
   * `modal` (ventana centrada) o `sidebar` (panel lateral).
   */
  readonly dialogView = this._dialogView.asReadonly();

  /** `true` cuando los formularios se muestran en un panel lateral. */
  readonly formsInSidebar = computed(() => this._dialogView() === 'sidebar');

  private readonly _tipPercent = signal<number>(storedTipPercent());

  /**
   * Propina sugerida (en porcentaje) que los formularios de venta proponen al
   * cobrar. La propina sigue siendo opcional: el cajero puede cambiarla o
   * dejarla en cero en cada venta.
   */
  readonly tipPercent = this._tipPercent.asReadonly();

  private readonly _priceCurrency = signal<string | null>(storedPriceCurrency());

  /**
   * Moneda en la que el cajero ve los precios (`null` = moneda base del sistema).
   *
   * Es una preferencia de la **empresa** (como la propina): el personal de caja
   * la comparte y el cajero que entra desde otro equipo la recibe al iniciar
   * sesión. `RatesService` la aplica a los montos que ve quien **no** administra
   * el local; ADMIN y MANAGER siempre ven el precio con el que se registró cada
   * artículo.
   */
  readonly priceCurrency = this._priceCurrency.asReadonly();

  private readonly _conversionCurrencies = signal<string[] | null>(
    storedConversionCurrencies(),
  );

  /**
   * Monedas cuyas conversiones ve el cajero debajo de cada monto
   * (`null` = ninguna: solo ve los precios en la moneda de arriba).
   *
   * Es una preferencia de la **empresa**: el admin la configura en
   * Configuración → Cajero y el personal de caja la comparte, así que el cajero
   * que entra desde otro equipo la recibe al iniciar sesión. `RatesService` la
   * aplica a los montos que ve quien **no** administra el local; ADMIN y MANAGER
   * siguen viendo todas las conversiones.
   */
  readonly conversionCurrencies = this._conversionCurrencies.asReadonly();

  private readonly _showBcvPrice = signal<boolean>(storedShowBcvPrice());

  /**
   * `true` cuando el cajero ve, debajo de cada monto, **el precio en dólares a la
   * tasa oficial del BCV** (además de las conversiones de arriba).
   *
   * Es una preferencia de la **empresa**, como las conversiones: el admin la
   * configura en Configuración → Cajero y el personal de caja la comparte, así
   * que el cajero que entra desde otro equipo la recibe al iniciar sesión.
   * `RatesService` la aplica a los montos que ve quien **no** administra el
   * local; la vista de ADMIN y MANAGER no cambia.
   */
  readonly showBcvPrice = this._showBcvPrice.asReadonly();

  private readonly _chargeRateKey = signal<ChargeRateKey | null>(storedChargeRateKey());

  /**
   * Tasa del dólar con la que se cobra. Siempre es la oficial del BCV (o `null`,
   * que significa lo mismo): la personalizada solo define el precio de vitrina.
   *
   * Se conserva como preferencia de la empresa por compatibilidad con versiones
   * anteriores; el punto de venta ya no la usa para calcular cobros.
   */
  readonly chargeRateKey = this._chargeRateKey.asReadonly();

  private readonly _posView = signal<PosView | null>(storedPosView());

  /**
   * Cómo lista el catálogo el punto de venta (`cards`, `table` o `columns`).
   *
   * Es una preferencia de la **empresa**: el admin la elige en Configuración →
   * Cajero y el POS la aplica al personal que cobra, también en otros equipos.
   * Sin configurar se usan las tarjetas (`cards`).
   */
  readonly posView = computed(() => this._posView() ?? DEFAULT_POS_VIEW);

  /** Presentación guardada explícitamente (`null` = tarjetas por defecto). */
  readonly storedPosView = this._posView.asReadonly();

  /**
   * Trae las preferencias de la empresa activa (login, registro, cambio de
   * empresa o sesión recuperada al abrir la aplicación), las aplica y las deja
   * como copia en este navegador. Sin conexión se sigue con la copia local.
   */
  load(): void {
    const revision = this.revision;
    this.http.get<CompanyPreferences>(this.baseUrl).subscribe({
      next: (preferences) => {
        // El usuario ya eligió algo mientras se pedía: su elección manda.
        if (revision !== this.revision) return;
        this.applyServer(preferences);
      },
      error: () => undefined,
    });
  }

  /**
   * Vuelve a traer las preferencias de la empresa activa, las aplica y las deja
   * como copia en este navegador.
   *
   * Lo usa el botón **Actualizar preferencias** del cajero: el admin puede
   * guardar en Configuración → Cajero mientras la caja está abierta, así que con
   * esto lo recién guardado se ve al instante, sin cerrar sesión ni recargar la
   * aplicación (el `load()` del arranque solo corre al entrar).
   *
   * A diferencia del `load()`, aquí lo que responde el servidor manda aunque se
   * haya tocado una preferencia mientras se pedía: es una acción explícita del
   * cajero y lo que busca es lo último que se guardó.
   */
  refresh(): Observable<CompanyPreferences> {
    return this.http.get<CompanyPreferences>(this.baseUrl).pipe(
      tap((preferences) => {
        // Descarta cualquier `load()` que venga en camino con datos anteriores.
        this.revision += 1;
        this.applyServer(preferences);
      }),
    );
  }

  /**
   * Olvida las preferencias de la empresa que acaba de salir, para que en un
   * equipo compartido quien entre después no herede nada antes de que el
   * servidor conteste (el `load()` del siguiente login las vuelve a traer).
   */
  clear(): void {
    this.revision += 1;
    this._dialogView.set('modal');
    this._tipPercent.set(DEFAULT_TIP_PERCENT);
    this._priceCurrency.set(null);
    this._conversionCurrencies.set(null);
    this._showBcvPrice.set(false);
    this._chargeRateKey.set(null);
    this._posView.set(null);
    try {
      localStorage.removeItem(DIALOG_VIEW_KEY);
      localStorage.removeItem(TIP_PERCENT_KEY);
      localStorage.removeItem(PRICE_CURRENCY_KEY);
      localStorage.removeItem(CONVERSION_CURRENCIES_KEY);
      localStorage.removeItem(SHOW_BCV_PRICE_KEY);
      localStorage.removeItem(CHARGE_RATE_KEY);
      localStorage.removeItem(POS_VIEW_KEY);
    } catch {
      /* almacenamiento no disponible (modo privado) */
    }
  }

  /** Cambia (y persiste) la presentación de los formularios. */
  setDialogView(view: DialogView): void {
    this._dialogView.set(view);
    this.save();
  }

  /** Cambia (y persiste) la propina sugerida, normalizada entre 0 y 100. */
  setTipPercent(percent: number): void {
    this._tipPercent.set(normalizeTipPercent(percent));
    this.save();
  }

  /**
   * Cambia (y persiste) la moneda en la que el cajero ve los precios: viaja a la
   * empresa, así que el cajero que entra desde otro equipo la recibe al iniciar
   * sesión. Con `null` o con un código inválido vuelve a la moneda base del
   * sistema.
   */
  setPriceCurrency(code: string | null): void {
    this._priceCurrency.set(normalizePriceCurrency(code));
    this.save();
  }

  /**
   * Cambia (y persiste) las monedas cuyas conversiones ve el cajero. Viaja a la
   * empresa, así que el cajero que entra desde otro equipo la recibe al iniciar
   * sesión. Una lista vacía (o `null`) deja al cajero con los precios solo en su
   * moneda.
   */
  setConversionCurrencies(codes: readonly string[] | null): void {
    this._conversionCurrencies.set(normalizeConversionCurrencies(codes));
    this.save();
  }

  /**
   * Cambia (y persiste) el interruptor que muestra el precio en dólares del BCV
   * debajo de cada monto. Viaja a la empresa, así que el cajero que entra desde
   * otro equipo lo recibe al iniciar sesión.
   */
  setShowBcvPrice(show: boolean): void {
    this._showBcvPrice.set(normalizeShowBcvPrice(show));
    this.save();
  }

  /**
   * Cambia (y persiste) la tasa de cobro. Solo se acepta `BCV_USD` (o `null`,
   * que significa lo mismo); la personalizada se descarta porque nunca se usa
   * para cobrar. Se conserva por compatibilidad con versiones anteriores.
   */
  setChargeRateKey(key: string | null): void {
    this._chargeRateKey.set(normalizeChargeRateKey(key));
    this.save();
  }

  /**
   * Cambia (y persiste) cómo lista el catálogo el punto de venta. Viaja a la
   * empresa, así que el cajero que entra desde otro equipo recibe la misma vista.
   */
  setPosView(view: PosView): void {
    this._posView.set(normalizePosView(view));
    this.save();
  }

  /**
   * Cambia (y persiste) las preferencias del punto de venta de una sola vez: la
   * propina sugerida, la moneda en la que el cajero ve los precios, las
   * conversiones que puede ver debajo de cada monto, si además ve el precio en
   * dólares del BCV y la tasa con la que cobra. Se guardan juntas para no mandar
   * dos peticiones por una sola pulsación.
   */
  setPosPreferences(
    tipPercent: number,
    priceCurrency: string | null,
    conversionCurrencies: readonly string[] | null = null,
    showBcvPrice = false,
  ): void {
    this._tipPercent.set(normalizeTipPercent(tipPercent));
    this._priceCurrency.set(normalizePriceCurrency(priceCurrency));
    this._conversionCurrencies.set(normalizeConversionCurrencies(conversionCurrencies));
    this._showBcvPrice.set(normalizeShowBcvPrice(showBcvPrice));
    this.save();
  }

  // ---------------------------------------------------------------- interno

  /**
   * Aplica lo que devolvió el servidor y lo deja como copia en este navegador.
   *
   * La empresa es la fuente de verdad: un campo que viaja como `null` significa
   * "sin configurar", así que se aplica el valor de fábrica (no lo que hubiera
   * quedado en el navegador de quien usó antes este equipo).
   */
  private applyServer(preferences: CompanyPreferences | null): void {
    this._dialogView.set(serverDialogView(preferences?.dialogView) ?? 'modal');
    this._tipPercent.set(
      serverTipPercent(preferences?.tipPercent) ?? DEFAULT_TIP_PERCENT,
    );
    this._priceCurrency.set(normalizePriceCurrency(preferences?.priceCurrency));
    this._conversionCurrencies.set(
      normalizeConversionCurrencies(preferences?.conversionCurrencies),
    );
    this._showBcvPrice.set(normalizeShowBcvPrice(preferences?.showBcvPrice));
    this._chargeRateKey.set(normalizeChargeRateKey(preferences?.chargeRateKey));
    this._posView.set(normalizePosView(preferences?.posView));
    this.cache();
  }

  /**
   * Guarda la preferencia en la empresa y en la copia del navegador. Si el
   * servidor no responde, la elección queda aplicada en este equipo y el
   * interceptor de errores ya avisa: se reenvía al cambiar cualquier preferencia.
   */
  private save(): void {
    this.revision += 1;
    this.cache();

    const payload: UpdatePreferencesPayload = {
      tipPercent: this._tipPercent(),
      dialogView: this._dialogView(),
      priceCurrency: this._priceCurrency(),
      conversionCurrencies: this._conversionCurrencies(),
      showBcvPrice: this._showBcvPrice(),
      chargeRateKey: this._chargeRateKey(),
      // Sin elección no se manda: el servidor la deja en `null` (tarjetas).
      ...(this._posView() ? { posView: this._posView() } : {}),
    };
    this.http
      .patch<CompanyPreferences>(this.baseUrl, payload)
      .subscribe({ error: () => undefined });
  }

  /** Copia local de lo de la empresa: el arranque pinta antes de que conteste. */
  private cache(): void {
    try {
      localStorage.setItem(DIALOG_VIEW_KEY, this._dialogView());
      localStorage.setItem(TIP_PERCENT_KEY, String(this._tipPercent()));
      const code = this._priceCurrency();
      if (code) localStorage.setItem(PRICE_CURRENCY_KEY, code);
      else localStorage.removeItem(PRICE_CURRENCY_KEY);
      const conversions = this._conversionCurrencies();
      if (conversions) {
        localStorage.setItem(CONVERSION_CURRENCIES_KEY, JSON.stringify(conversions));
      } else {
        localStorage.removeItem(CONVERSION_CURRENCIES_KEY);
      }
      if (this._showBcvPrice()) {
        localStorage.setItem(SHOW_BCV_PRICE_KEY, 'true');
      } else {
        localStorage.removeItem(SHOW_BCV_PRICE_KEY);
      }
      const chargeRate = this._chargeRateKey();
      if (chargeRate) localStorage.setItem(CHARGE_RATE_KEY, chargeRate);
      else localStorage.removeItem(CHARGE_RATE_KEY);
      const posView = this._posView();
      if (posView) localStorage.setItem(POS_VIEW_KEY, posView);
      else localStorage.removeItem(POS_VIEW_KEY);
    } catch {
      /* almacenamiento no disponible (modo privado) */
    }
  }
}
