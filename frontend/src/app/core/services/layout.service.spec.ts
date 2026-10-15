import { TestBed } from '@angular/core/testing';
import { LayoutService } from './layout.service';

describe('LayoutService', () => {
  function service(): LayoutService {
    return TestBed.inject(LayoutService);
  }

  /** Clave de `localStorage` con el estado del menú lateral. */
  const SIDEBAR_KEY = 'nexo-hub.sidebar-open';

  /**
   * Simula el ancho de la ventana: `true` = escritorio (el `lg` de Tailwind).
   * Devuelve un disparador para avisar de un cambio de ancho, como el navegador.
   */
  function stubViewport(desktop: boolean): { resize: (desktop: boolean) => void } {
    const listeners: Array<(event: MediaQueryListEvent) => void> = [];
    spyOn(window, 'matchMedia').and.callFake(
      (query: string) =>
        ({
          media: query,
          matches: desktop,
          addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
            listeners.push(listener);
          },
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    );

    return {
      resize: (value: boolean) => {
        for (const listener of listeners) listener({ matches: value } as MediaQueryListEvent);
      },
    };
  }

  it('arranca con el shell visible (sin pantalla completa)', () => {
    expect(service().fullscreen()).toBeFalse();
  });

  it('activa y desactiva la pantalla completa', () => {
    const layout = service();

    layout.setFullscreen(true);
    expect(layout.fullscreen()).toBeTrue();

    layout.setFullscreen(false);
    expect(layout.fullscreen()).toBeFalse();
  });

  it('comparte el estado entre consumidores (servicio singleton)', () => {
    service().setFullscreen(true);
    expect(TestBed.inject(LayoutService).fullscreen()).toBeTrue();
  });

  /**
   * Menú lateral: el componente del shell sólo lo pinta, así que el estado y la
   * preferencia (se abre y se cierra, animado) viven aquí.
   */
  describe('menú lateral', () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => localStorage.clear());

    it('arranca abierto cuando la ventana es de escritorio', () => {
      stubViewport(true);

      expect(service().sidebarOpen()).toBeTrue();
      expect(service().desktopViewport()).toBeTrue();
    });

    it('arranca replegado cuando la ventana es de móvil (taparía el contenido)', () => {
      stubViewport(false);

      expect(service().sidebarOpen()).toBeFalse();
      expect(service().desktopViewport()).toBeFalse();
    });

    it('alterna el menú lateral y recuerda la elección entre visitas', () => {
      stubViewport(true);
      const layout = service();

      layout.toggleSidebar();
      expect(layout.sidebarOpen()).toBeFalse();
      expect(localStorage.getItem(SIDEBAR_KEY)).toBe('false');

      // Otra visita (servicio nuevo): manda la preferencia guardada.
      TestBed.resetTestingModule();
      expect(service().sidebarOpen()).toBeFalse();
    });

    it('al reducir la ventana el menú se repliega sin perder la preferencia', () => {
      const viewport = stubViewport(true);
      const layout = service();
      expect(layout.sidebarOpen()).toBeTrue();

      viewport.resize(false);
      expect(layout.desktopViewport()).toBeFalse();
      expect(layout.sidebarOpen()).toBeFalse();
      // El repliegue automático no se guarda: al volver al escritorio se reabre.
      expect(localStorage.getItem(SIDEBAR_KEY)).toBeNull();

      viewport.resize(true);
      expect(layout.desktopViewport()).toBeTrue();
      expect(layout.sidebarOpen()).toBeTrue();
    });
  });
});
