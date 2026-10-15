import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { AppComponent } from './app.component';
import { saveSession, storedToken } from './core/auth/session';
import { AuthService } from './core/services/auth.service';
import { CashService } from './core/services/cash.service';
import { LayoutService } from './core/services/layout.service';
import { MainLayoutComponent } from './layout/main-layout.component';

@Component({ standalone: true, template: 'login-stub' })
class LoginStubComponent {}

/**
 * Flujo de "Cerrar sesión" reportado como no funcional: el dialogo de
 * confirmacion solo aparece si el host global esta montado en la raiz.
 */
describe('AppComponent (shell global)', () => {
  let fixture: ComponentFixture<AppComponent>;
  let router: Router;

  beforeEach(async () => {
    localStorage.clear();
    saveSession({
      accessToken: 'token-de-prueba',
      user: {
        id: 'u1',
        email: 'cajero@nexohub.com',
        name: 'Cajero Test',
        active: true,
        createdAt: '2026-10-13T12:00:00.000Z',
        updatedAt: '2026-10-13T12:00:00.000Z',
      },
      company: {
        id: 'c1',
        name: 'Empresa de prueba',
        rif: 'J-12345678-9',
        active: true,
        createdAt: '2026-10-13T12:00:00.000Z',
        updatedAt: '2026-10-13T12:00:00.000Z',
      },
      role: 'CASHIER',
      companies: [
        {
          id: 'c1',
          name: 'Empresa de prueba',
          rif: 'J-12345678-9',
          role: 'CASHIER',
          active: true,
        },
      ],
    });

    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter([
          { path: '', component: MainLayoutComponent },
          { path: 'login', component: LoginStubComponent },
        ]),
        { provide: CashService, useValue: { current: () => of(null) } },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AppComponent);
    router = TestBed.inject(Router);
    await router.navigateByUrl('');
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  /** Botón de tema de la cabecera (icono sol/luna). */
  function themeButton(label: string): HTMLButtonElement | null {
    return fixture.nativeElement.querySelector(`button[aria-label="${label}"]`);
  }

  function findButton(text: string, root: HTMLElement = fixture.nativeElement): HTMLButtonElement | undefined {
    const found: NodeListOf<HTMLButtonElement> = root.querySelectorAll('button');
    return Array.from(found).find((button) => (button.textContent ?? '').includes(text));
  }

  /** Botón de la cabecera que despliega y repliega el menú lateral. */
  function sidebarToggle(): HTMLButtonElement | null {
    return fixture.nativeElement.querySelector(
      'button[aria-label="Abrir menú"], button[aria-label="Cerrar menú"]',
    );
  }

  /** Panel de navegación del shell (no confundir con el lateral de formularios). */
  function sidebar(): HTMLElement | null {
    return fixture.nativeElement.querySelector('app-main-layout aside');
  }

  /** Componente del shell, para disparar sus manejadores sin navegar. */
  function shell(): MainLayoutComponent {
    return fixture.debugElement.query(By.directive(MainLayoutComponent))
      .componentInstance as MainLayoutComponent;
  }

  it('monta los hosts globales de notificaciones y confirmacion', () => {
    expect(fixture.nativeElement.querySelector('app-toast-host')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-confirm-host')).not.toBeNull();
  });

  it('alterna el modo oscuro desde la cabecera', () => {
    const enable = themeButton('Activar modo oscuro');
    expect(enable).withContext('botón de tema en la cabecera').not.toBeNull();
    expect(document.documentElement.classList.contains('dark')).toBeFalse();

    enable!.click();
    fixture.detectChanges();

    expect(document.documentElement.classList.contains('dark')).toBeTrue();
    // El botón pasa a ofrecer el modo contrario.
    expect(themeButton('Activar modo claro')).not.toBeNull();

    themeButton('Activar modo claro')!.click();
    fixture.detectChanges();

    expect(document.documentElement.classList.contains('dark')).toBeFalse();
    expect(themeButton('Activar modo oscuro')).not.toBeNull();
  });

  it('abre y cierra el menú lateral desde la cabecera', () => {
    const aside = sidebar();
    expect(aside).withContext('menú lateral del shell').not.toBeNull();
    const replegado = aside!.classList.contains('-translate-x-full');

    sidebarToggle()!.click();
    fixture.detectChanges();

    expect(aside!.classList.contains('-translate-x-full'))
      .withContext('el panel se despliega')
      .toBe(!replegado);
    expect(sidebarToggle()!.getAttribute('aria-expanded')).toBe('true');
    expect(sidebarToggle()!.getAttribute('aria-label')).toBe('Cerrar menú');

    sidebarToggle()!.click();
    fixture.detectChanges();

    expect(aside!.classList.contains('-translate-x-full'))
      .withContext('el panel se repliega')
      .toBe(replegado);
    expect(sidebarToggle()!.getAttribute('aria-expanded')).toBe('false');
    expect(sidebarToggle()!.getAttribute('aria-label')).toBe('Abrir menú');
  });

  it('el menú lateral se despliega con animación y sin deformar el contenido', () => {
    const aside = sidebar()!;

    // Anima ancho (escritorio) y posición (móvil) durante 300 ms.
    const estilo = getComputedStyle(aside);
    expect(estilo.transitionProperty).toContain('width');
    expect(estilo.transitionProperty).toContain('transform');
    expect(estilo.transitionDuration).toContain('0.3s');

    // Al replegarse recorta el contenido en vez de comprimirlo.
    expect(estilo.overflowX).toBe('hidden');

    // La navegación conserva el ancho de la barra abierta (16rem): no se deforma.
    const nav = aside.querySelector('nav');
    expect(nav).withContext('navegación del panel').not.toBeNull();
    expect(getComputedStyle(nav!).width).toBe('256px');
  });

  it('recuerda el menú lateral entre visitas', () => {
    sidebarToggle()!.click();
    fixture.detectChanges();

    expect(localStorage.getItem('nexo-hub.sidebar-open')).toBe(
      String(TestBed.inject(LayoutService).sidebarOpen()),
    );
  });

  it('el enlace del menú sólo repliega el panel en pantalla pequeña', () => {
    const layout = TestBed.inject(LayoutService);
    const aside = sidebar()!;

    // Escritorio: el panel se queda abierto para saltar de una sección a otra.
    layout.desktopViewport.set(true);
    layout.setSidebarOpen(true);
    fixture.detectChanges();
    shell().onNavClick();
    fixture.detectChanges();

    expect(layout.sidebarOpen()).toBeTrue();
    expect(aside.classList.contains('-translate-x-full')).toBeFalse();

    // Móvil: al elegir la sección el panel se repliega (taparía el contenido).
    layout.desktopViewport.set(false);
    shell().onNavClick();
    fixture.detectChanges();

    expect(layout.sidebarOpen()).toBeFalse();
    expect(aside.classList.contains('-translate-x-full')).toBeTrue();
  });

  it('el dialogo de confirmacion aparece al pulsar Cerrar sesión', () => {
    const logoutButton = findButton('Cerrar sesión');
    expect(logoutButton).withContext('botón Cerrar sesión').toBeDefined();

    logoutButton!.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('¿Deseas salir del sistema?');
    expect(TestBed.inject(AuthService).isAuthenticated()).toBeTrue();
  });

  it('confirma el cierre: limpia el token y navega al login', async () => {
    findButton('Cerrar sesión')!.click();
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('app-confirm-host') as HTMLElement;
    const accept = findButton('Cerrar sesión', dialog);
    expect(accept).withContext('botón confirmar del diálogo').toBeDefined();

    accept!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    expect(storedToken()).toBeNull();
    expect(localStorage.getItem('nexo-hub.user')).toBeNull();
    expect(TestBed.inject(AuthService).isAuthenticated()).toBeFalse();
    expect(router.url).toBe('/login');
  });

  it('cancelar el dialogo mantiene la sesión activa', async () => {
    findButton('Cerrar sesión')!.click();
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('app-confirm-host') as HTMLElement;
    const cancel = findButton('Cancelar', dialog);
    cancel!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    expect(storedToken()).toBe('token-de-prueba');
    expect(TestBed.inject(AuthService).isAuthenticated()).toBeTrue();
    expect(router.url).toBe('/');
  });
});
