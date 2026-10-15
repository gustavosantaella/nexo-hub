import { Injectable, signal } from '@angular/core';

/** Clave de `localStorage` con el estado del menú lateral. */
const SIDEBAR_KEY = 'nexo-hub.sidebar-open';

/** Ancho a partir del cual el shell se muestra de escritorio (el `lg` de Tailwind). */
const DESKTOP_QUERY = '(min-width: 1024px)';

/** Consulta del ancho de la ventana, o `null` si el entorno no la soporta. */
function viewportQuery(): MediaQueryList | null {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(DESKTOP_QUERY)
      : null;
  } catch {
    return null;
  }
}

/** `true` cuando la ventana tiene ancho de escritorio (por defecto sí). */
function isDesktopViewport(): boolean {
  return viewportQuery()?.matches ?? true;
}

/**
 * Menú lateral recordado en este navegador. Sin preferencia guardada arranca
 * abierto en escritorio (va fijo al lado) y replegado en móvil, donde taparía
 * el contenido.
 */
function storedSidebarOpen(): boolean {
  try {
    const raw = localStorage.getItem(SIDEBAR_KEY);
    if (raw === 'true' || raw === 'false') return raw === 'true';
  } catch {
    /* almacenamiento no disponible (modo privado) */
  }
  return isDesktopViewport();
}

/**
 * Estado de presentación del shell del back-office. Permite que una vista
 * concreta (por ejemplo el punto de venta del cajero) ocupe toda la pantalla
 * ocultando la barra lateral y la cabecera, y guarda el estado del menú lateral
 * de navegación (abrible y replegable, con animación).
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

  /**
   * Menú lateral de navegación. En móvil entra deslizándose por encima del
   * contenido; en escritorio va fijo al lado y se repliega dejando su sitio.
   */
  readonly sidebarOpen = signal(storedSidebarOpen());

  /** `true` cuando la ventana tiene ancho de escritorio (el menú va fijo al lado). */
  readonly desktopViewport = signal(isDesktopViewport());

  constructor() {
    // Al cambiar el ancho de la ventana el menú se reajusta solo: si no, al
    // reducirla quedaría tapando el contenido.
    viewportQuery()?.addEventListener('change', (event) => this.onViewportChange(event.matches));
  }

  /** Alterna el menú lateral y recuerda la elección en este navegador. */
  toggleSidebar(): void {
    this.setSidebarOpen(!this.sidebarOpen());
  }

  /** Abre o cierra el menú lateral y persiste la elección. */
  setSidebarOpen(open: boolean): void {
    this.sidebarOpen.set(open);

    try {
      localStorage.setItem(SIDEBAR_KEY, String(open));
    } catch {
      /* almacenamiento no disponible (modo privado) */
    }
  }

  /**
   * Reajusta el menú al nuevo ancho: en móvil se repliega (taparía el contenido)
   * y al volver al escritorio se recupera la preferencia guardada.
   */
  private onViewportChange(desktop: boolean): void {
    this.desktopViewport.set(desktop);
    this.sidebarOpen.set(desktop && storedSidebarOpen());
  }
}
