import { TestBed } from '@angular/core/testing';
import { THEME_KEY, ThemeService } from './theme.service';

/** Clase que activa el tema oscuro (igual que en el servicio). */
const DARK_CLASS = 'dark';

describe('ThemeService', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    document.documentElement.classList.remove(DARK_CLASS);
    localStorage.clear();
    document.querySelector('meta[name="theme-color"]')?.remove();
  });

  function service(): ThemeService {
    return TestBed.inject(ThemeService);
  }

  function isDarkApplied(): boolean {
    return document.documentElement.classList.contains(DARK_CLASS);
  }

  it('arranca en modo claro y sin la clase oscura', () => {
    expect(service().theme()).toBe('light');
    expect(service().isDark()).toBeFalse();
    expect(isDarkApplied()).toBeFalse();
  });

  it('aplica y persiste el modo oscuro', () => {
    const theme = service();
    theme.setTheme('dark');

    expect(theme.theme()).toBe('dark');
    expect(theme.isDark()).toBeTrue();
    expect(isDarkApplied()).toBeTrue();
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
  });

  it('vuelve al modo claro y quita la clase oscura', () => {
    const theme = service();
    theme.setTheme('dark');
    theme.setTheme('light');

    expect(theme.isDark()).toBeFalse();
    expect(isDarkApplied()).toBeFalse();
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
  });

  it('recupera el tema guardado y descarta valores desconocidos', () => {
    localStorage.setItem(THEME_KEY, 'dark');
    expect(service().isDark()).toBeTrue();
    expect(isDarkApplied()).toBeTrue();

    localStorage.setItem(THEME_KEY, 'sepia');
    TestBed.resetTestingModule();
    expect(service().theme()).toBe('light');
  });

  it('alterna entre claro y oscuro', () => {
    const theme = service();
    theme.toggleTheme();
    expect(theme.theme()).toBe('dark');
    theme.toggleTheme();
    expect(theme.theme()).toBe('light');
  });

  it('colorea la barra del navegador según el tema', () => {
    const theme = service();
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    expect(meta).not.toBeNull();
    expect(meta!.content).toBe('#1b31b5');

    theme.setTheme('dark');
    expect(meta!.content).toBe('#0a1020');
  });

  /**
   * Comprobación de extremo a extremo: la capa oscura de `styles.scss` debe
   * ganarle a las utilidades claras que usan todas las pantallas.
   */
  it('oscurece las utilidades claras de Tailwind', () => {
    const theme = service();
    const probe = document.createElement('div');
    probe.className = 'bg-white text-slate-900 border border-slate-200';
    document.body.appendChild(probe);

    try {
      const light = getComputedStyle(probe);
      const backgroundLight = light.backgroundColor;
      const textLight = light.color;
      const borderLight = light.borderTopColor;

      theme.setTheme('dark');

      const dark = getComputedStyle(probe);
      expect(dark.backgroundColor).not.toBe(backgroundLight);
      expect(dark.color).not.toBe(textLight);
      expect(dark.borderTopColor).not.toBe(borderLight);
      // Superficie y texto del tema oscuro (ver los tokens `--nk-*`).
      expect(dark.backgroundColor).toBe('rgb(17, 26, 44)');
      expect(dark.color).toBe('rgb(248, 250, 252)');
    } finally {
      probe.remove();
    }
  });

  /** Las utilidades con modificador de opacidad también deben adaptarse. */
  it('oscurece las utilidades con opacidad (bg-white/90)', () => {
    const probe = document.createElement('div');
    probe.className = 'bg-white/90';
    document.body.appendChild(probe);

    try {
      expect(getComputedStyle(probe).backgroundColor).toBe('rgba(255, 255, 255, 0.9)');

      service().setTheme('dark');
      expect(getComputedStyle(probe).backgroundColor).toBe('rgba(17, 26, 44, 0.9)');
    } finally {
      probe.remove();
    }
  });
});
