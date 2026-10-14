import { Injectable, computed, signal } from '@angular/core';

/** Forma de presentar los formularios de la operación (caja y pedidos). */
export type DialogView = 'modal' | 'sidebar';

/** Vistas soportadas (se usan también para validar lo guardado). */
export const DIALOG_VIEWS: readonly DialogView[] = ['modal', 'sidebar'];

/** Clave de `localStorage` con la presentación elegida. */
const DIALOG_VIEW_KEY = 'nexo-hub.dialog-view';

/** Clave de `localStorage` con la propina sugerida del punto de venta. */
const TIP_PERCENT_KEY = 'nexo-hub.tip-percent';

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

/** Vista guardada en este navegador (ventana modal por defecto). */
function storedDialogView(): DialogView {
  try {
    const raw = localStorage.getItem(DIALOG_VIEW_KEY);
    return DIALOG_VIEWS.includes(raw as DialogView) ? (raw as DialogView) : 'modal';
  } catch {
    return 'modal';
  }
}

/** Propina sugerida guardada en este navegador (10 % por defecto). */
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
 * Preferencias de interfaz del usuario.
 *
 * Igual que el interruptor de los montos "al cambio" de `RatesService`, viven en
 * el `localStorage` del navegador (no en la base de datos): cada usuario elige
 * cómo quiere ver el sistema y el cambio no afecta a los demás.
 */
@Injectable({ providedIn: 'root' })
export class PreferencesService {
  private readonly _dialogView = signal<DialogView>(storedDialogView());

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

  /** Cambia (y persiste) la presentación de los formularios. */
  setDialogView(view: DialogView): void {
    this._dialogView.set(view);
    try {
      localStorage.setItem(DIALOG_VIEW_KEY, view);
    } catch {
      /* almacenamiento no disponible (modo privado) */
    }
  }

  /** Cambia (y persiste) la propina sugerida, normalizada entre 0 y 100. */
  setTipPercent(percent: number): void {
    const value = normalizeTipPercent(percent);
    this._tipPercent.set(value);
    try {
      localStorage.setItem(TIP_PERCENT_KEY, String(value));
    } catch {
      /* almacenamiento no disponible (modo privado) */
    }
  }
}
