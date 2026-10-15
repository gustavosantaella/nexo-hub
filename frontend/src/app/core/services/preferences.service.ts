import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import type {
  CompanyPreferences,
  DialogView,
  UpdatePreferencesPayload,
} from '../models/api.model';

export type { DialogView };

/** Vistas soportadas (se usan también para validar lo guardado). */
export const DIALOG_VIEWS: readonly DialogView[] = ['modal', 'sidebar'];

/** Clave de `localStorage` con la presentación elegida. */
const DIALOG_VIEW_KEY = 'nexo-hub.dialog-view';

/** Clave de `localStorage` con la propina sugerida del punto de venta. */
const TIP_PERCENT_KEY = 'nexo-hub.tip-percent';

/** Clave de `localStorage` con la moneda en la que el cajero ve los precios. */
const PRICE_CURRENCY_KEY = 'nexo-hub.price-currency';

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
 * precios** y la **presentación de los formularios** de caja y pedidos viven en
 * el servidor (`GET/PATCH /preferences`, una fila por empresa): son configuración
 * del local, no de cada persona, así que las comparte todo el personal y el
 * cajero que entra desde otro navegador recibe al iniciar sesión lo mismo que ve
 * el resto del equipo. El navegador guarda una copia para pintar de inmediato al
 * abrir la aplicación y para seguir funcionando si el servidor no responde; al
 * hacer login manda lo que responde el servidor.
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
   * Olvida las preferencias de la empresa que acaba de salir, para que en un
   * equipo compartido quien entre después no herede nada antes de que el
   * servidor conteste (el `load()` del siguiente login las vuelve a traer).
   */
  clear(): void {
    this.revision += 1;
    this._dialogView.set('modal');
    this._tipPercent.set(DEFAULT_TIP_PERCENT);
    this._priceCurrency.set(null);
    try {
      localStorage.removeItem(DIALOG_VIEW_KEY);
      localStorage.removeItem(TIP_PERCENT_KEY);
      localStorage.removeItem(PRICE_CURRENCY_KEY);
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
   * Cambia (y persiste) las dos preferencias del punto de venta de una sola vez:
   * la propina sugerida y la moneda en la que el cajero ve los precios. Se
   * guardan juntas para no mandar dos peticiones por una sola pulsación.
   */
  setPosPreferences(tipPercent: number, priceCurrency: string | null): void {
    this._tipPercent.set(normalizeTipPercent(tipPercent));
    this._priceCurrency.set(normalizePriceCurrency(priceCurrency));
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
    } catch {
      /* almacenamiento no disponible (modo privado) */
    }
  }
}
