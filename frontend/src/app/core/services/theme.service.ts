import { Injectable, computed, signal } from '@angular/core';

/** Tema visual de la aplicación. */
export type Theme = 'light' | 'dark';

/** Temas soportados (se usan también para validar lo guardado). */
export const THEMES: readonly Theme[] = ['light', 'dark'];

/** Clave de `localStorage` con el tema elegido (la comparte `index.html`). */
export const THEME_KEY = 'nexo-hub.theme';

/** Clase que activa el tema oscuro (Tailwind `darkMode: 'class'`). */
const DARK_CLASS = 'dark';

/** Color de la barra del navegador (`<meta name="theme-color">`) por tema. */
const THEME_COLOR: Record<Theme, string> = {
  light: '#1b31b5',
  dark: '#0a1020',
};

/** Tema guardado en este navegador (claro por defecto). */
function storedTheme(): Theme {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    return THEMES.includes(raw as Theme) ? (raw as Theme) : 'light';
  } catch {
    return 'light';
  }
}

/**
 * Tema visual (modo claro u oscuro) elegido en Configuración → Apariencia.
 *
 * El tema se aplica con la clase `dark` en `<html>`: Tailwind
 * (`darkMode: 'class'`) y la capa de tokens de `styles.scss` reescriben desde
 * ahí las utilidades de color, así que **todas** las pantallas (tablas,
 * formularios, ventanas, avisos…) se adaptan sin cambios en sus plantillas.
 *
 * Como el resto de las preferencias de interfaz vive en el `localStorage` del
 * navegador, no en la base de datos: cada usuario elige cómo quiere ver el
 * sistema y el cambio no afecta a los demás.
 *
 * `AppComponent` inyecta este servicio al arrancar, de modo que el tema
 * guardado se aplica aunque el usuario no entre en Configuración.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly _theme = signal<Theme>(storedTheme());

  /** Tema activo (`light` u `dark`). */
  readonly theme = this._theme.asReadonly();

  /** `true` cuando está activo el modo oscuro. */
  readonly isDark = computed(() => this._theme() === 'dark');

  constructor() {
    this.apply(this._theme());
  }

  /** Cambia (y persiste) el tema, aplicándolo de inmediato al documento. */
  setTheme(theme: Theme): void {
    this._theme.set(theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* almacenamiento no disponible (modo privado) */
    }
    this.apply(theme);
  }

  /** Alterna entre claro y oscuro (atajo para el botón de la cabecera). */
  toggleTheme(): void {
    this.setTheme(this.isDark() ? 'light' : 'dark');
  }

  /**
   * Marca el tema en `<html>` y en la barra del navegador. Se aplica siempre
   * (es idempotente) para no depender de que el `<html>` venga ya marcado por
   * el script de `index.html`.
   */
  private apply(theme: Theme): void {
    document.documentElement.classList.toggle(DARK_CLASS, theme === 'dark');
    this.paintBrowserBar(theme);
  }

  /** Colorea la barra del navegador móvil para que combine con el tema. */
  private paintBrowserBar(theme: Theme): void {
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = THEME_COLOR[theme];
  }
}
