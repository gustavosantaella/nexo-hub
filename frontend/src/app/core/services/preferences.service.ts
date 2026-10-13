import { Injectable, computed, signal } from '@angular/core';

/** Forma de presentar los formularios de la operación (caja y pedidos). */
export type DialogView = 'modal' | 'sidebar';

/** Vistas soportadas (se usan también para validar lo guardado). */
export const DIALOG_VIEWS: readonly DialogView[] = ['modal', 'sidebar'];

/** Clave de `localStorage` con la presentación elegida. */
const DIALOG_VIEW_KEY = 'nexo-hub.dialog-view';

/** Vista guardada en este navegador (ventana modal por defecto). */
function storedDialogView(): DialogView {
  try {
    const raw = localStorage.getItem(DIALOG_VIEW_KEY);
    return DIALOG_VIEWS.includes(raw as DialogView) ? (raw as DialogView) : 'modal';
  } catch {
    return 'modal';
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

  /** Cambia (y persiste) la presentación de los formularios. */
  setDialogView(view: DialogView): void {
    this._dialogView.set(view);
    try {
      localStorage.setItem(DIALOG_VIEW_KEY, view);
    } catch {
      /* almacenamiento no disponible (modo privado) */
    }
  }
}
