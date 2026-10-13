import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { AppComponent } from './app.component';
import { saveSession, storedToken } from './core/auth/session';
import { AuthService } from './core/services/auth.service';
import { CashService } from './core/services/cash.service';
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
