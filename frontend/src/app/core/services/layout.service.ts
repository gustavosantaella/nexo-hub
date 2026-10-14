import { Injectable, signal } from '@angular/core';

/**
 * Estado de presentación del shell del back-office. Permite que una vista
 * concreta (por ejemplo el punto de venta del cajero) ocupe toda la pantalla
 * ocultando la barra lateral y la cabecera.
 */
@Injectable({ providedIn: 'root' })
export class LayoutService {
  private readonly fullscreenState = signal(false);

  /** `true` cuando la vista activa pide pantalla completa (sin shell). */
  readonly fullscreen = this.fullscreenState.asReadonly();

  /** Activa o desactiva el modo pantalla completa del shell. */
  setFullscreen(value: boolean): void {
    this.fullscreenState.set(value);
  }
}
