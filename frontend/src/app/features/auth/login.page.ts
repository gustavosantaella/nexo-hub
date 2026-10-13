import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';
import { IconComponent } from '../../shared/components/icon.component';

/** Pantalla de inicio de sesion. */
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div class="grid w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-xl lg:grid-cols-2">
        <!-- Panel de marca -->
        <div class="hidden flex-col justify-between bg-brand-700 p-10 text-white lg:flex">
          <div class="flex items-center gap-3">
            <span class="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15">
              <app-icon name="building" size="h-6 w-6" />
            </span>
            <div>
              <p class="text-lg font-semibold">Nexo Hub</p>
              <p class="text-xs text-white/70">Sistema de gestión</p>
            </div>
          </div>

          <div class="space-y-4">
            <h2 class="text-2xl font-semibold leading-snug">
              Controla ventas, inventario y finanzas en un solo lugar.
            </h2>
            <ul class="space-y-2 text-sm text-white/80">
              <li class="flex items-center gap-2">
                <app-icon name="check" size="h-4 w-4" /> Caja con arqueo y cierre
              </li>
              <li class="flex items-center gap-2">
                <app-icon name="check" size="h-4 w-4" /> Pedidos y control de stock
              </li>
              <li class="flex items-center gap-2">
                <app-icon name="check" size="h-4 w-4" /> Cuentas por cobrar y pagar
              </li>
              <li class="flex items-center gap-2">
                <app-icon name="check" size="h-4 w-4" /> Reportes de utilidad
              </li>
            </ul>
          </div>

          <p class="text-xs text-white/60">© {{ year }} Nexo Hub · Panel de control</p>
        </div>

        <!-- Formulario -->
        <div class="p-8 sm:p-10">
          <div class="mb-8 lg:hidden">
            <span class="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white">
              <app-icon name="building" size="h-6 w-6" />
            </span>
          </div>

          <h1 class="text-xl font-semibold text-slate-900">Iniciar sesión</h1>
          <p class="mt-1 text-sm text-slate-500">
            Ingresa tus credenciales para acceder al panel.
          </p>

          <form class="mt-6 space-y-4" (ngSubmit)="submit()" #form="ngForm">
            <div>
              <label class="label" for="email">Correo electrónico</label>
              <input
                id="email"
                name="email"
                type="email"
                class="input"
                placeholder="usuario@nexohub.com"
                autocomplete="email"
                required
                [(ngModel)]="email"
                [disabled]="submitting()"
              />
            </div>

            <div>
              <label class="label" for="password">Contraseña</label>
              <input
                id="password"
                name="password"
                type="password"
                class="input"
                placeholder="••••••••"
                autocomplete="current-password"
                required
                minlength="6"
                [(ngModel)]="password"
                [disabled]="submitting()"
              />
            </div>

            <button
              type="submit"
              class="btn-primary w-full"
              [disabled]="submitting() || form.invalid"
            >
              @if (submitting()) {
                <span class="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"></span>
                Ingresando…
              } @else {
                <app-icon name="keypad" size="h-4 w-4" />
                Ingresar
              }
            </button>
          </form>

          <div class="mt-6 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-xs text-slate-600">
            <p class="font-semibold text-slate-700">Accesos de prueba</p>
            <p class="mt-1">Administrador: <span class="font-mono">admin{{ '@' }}nexohub.com</span> / <span class="font-mono">Admin123!</span></p>
            <p>Encargado: <span class="font-mono">manager{{ '@' }}nexohub.com</span> / <span class="font-mono">Manager123!</span></p>
            <p>Cajero: <span class="font-mono">cashier{{ '@' }}nexohub.com</span> / <span class="font-mono">Cashier123!</span></p>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  email = 'admin@nexohub.com';
  password = '';
  readonly submitting = signal(false);
  readonly year = new Date().getFullYear();

  submit(): void {
    if (this.submitting() || !this.email || !this.password) return;
    this.submitting.set(true);

    this.auth.login(this.email.trim(), this.password).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.toast.success(`Bienvenido, ${response.user.name}`, 'Sesión iniciada');
        void this.router.navigate(['/panel']);
      },
      error: () => this.submitting.set(false),
    });
  }
}
