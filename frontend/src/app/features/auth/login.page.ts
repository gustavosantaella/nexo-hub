import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';
import { apiErrorMessage, isCompanyUnderReview } from '../../core/utils/format';
import { IconComponent } from '../../shared/components/icon.component';
import {
  AuthBrandComponent,
  type AuthBrandFeature,
} from './auth-brand.component';

/** Pantalla de inicio de sesion. */
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent, AuthBrandComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './login.page.html',
  styleUrl: './auth-ui.scss',
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  /** Ventajas mostradas en el panel de marca. */
  readonly brandFeatures: readonly AuthBrandFeature[] = [
    {
      icon: 'wallet',
      title: 'Caja con arqueo y cierre',
      description: 'Turnos, movimientos y diferencias controladas al centavo.',
    },
    {
      icon: 'receipt',
      title: 'Pedidos e inventario',
      description: 'Stock, consumos y alertas de mínimos en tiempo real.',
    },
    {
      icon: 'trend-up',
      title: 'Finanzas claras',
      description: 'Cuentas por cobrar y pagar, con utilidad por período.',
    },
    {
      icon: 'chart',
      title: 'Reportes que deciden',
      description: 'Ventas, margen y desempeño por local en un vistazo.',
    },
  ];

  email = '';
  password = '';
  showPassword = false;
  readonly submitting = signal(false);
  readonly errorMessage = signal<string | null>(null);
  /** True cuando el bloqueo es por empresa en revisión (aviso, no error). */
  readonly underReview = signal(false);
  /** Aviso de Bloq Mayús mientras se escribe la contraseña. */
  readonly capsLock = signal(false);
  readonly year = new Date().getFullYear();

  /** Limpia la alerta cuando el usuario corrige los datos. */
  clearError(): void {
    this.errorMessage.set(null);
    this.underReview.set(false);
  }

  /** Detecta Bloq Mayús en los eventos de teclado del campo de contraseña. */
  onCapsLock(event: KeyboardEvent): void {
    this.capsLock.set(event.getModifierState?.('CapsLock') ?? false);
  }

  /** Envía las credenciales al backend. */
  submit(): void {
    if (this.submitting() || !this.email || !this.password) return;
    this.submitting.set(true);
    this.clearError();

    this.auth.login(this.email.trim(), this.password).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.toast.success(`Bienvenido, ${response.user.name}`, 'Sesión iniciada');
        void this.router.navigate(['/panel']);
      },
      error: (error: unknown) => {
        this.submitting.set(false);
        this.underReview.set(isCompanyUnderReview(error));
        this.errorMessage.set(apiErrorMessage(error));
      },
    });
  }
}

