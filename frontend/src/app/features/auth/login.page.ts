import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';
import { apiErrorMessage, isCompanyUnderReview } from '../../core/utils/format';
import { IconComponent } from '../../shared/components/icon.component';

/** Cuenta de demostracion sugerida en la pantalla de acceso. */
interface DemoAccount {
  label: string;
  email: string;
  password: string;
}

/** Pantalla de inicio de sesion. */
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './login.page.html',
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly demoAccounts: readonly DemoAccount[] = [
    { label: 'Administrador', email: 'admin@nexohub.com', password: 'Admin123!' },
    { label: 'Encargado', email: 'manager@nexohub.com', password: 'Manager123!' },
    { label: 'Cajero', email: 'cashier@nexohub.com', password: 'Cashier123!' },
  ];

  email = 'admin@nexohub.com';
  password = '';
  showPassword = false;
  readonly submitting = signal(false);
  readonly errorMessage = signal<string | null>(null);
  /** True cuando el bloqueo es por empresa en revisión (aviso, no error). */
  readonly underReview = signal(false);
  readonly year = new Date().getFullYear();

  /** Limpia la alerta cuando el usuario corrige los datos. */
  clearError(): void {
    this.errorMessage.set(null);
    this.underReview.set(false);
  }

  /** Rellena el formulario con una cuenta de prueba. */
  useDemo(account: DemoAccount): void {
    if (this.submitting()) return;
    this.email = account.email;
    this.password = account.password;
    this.clearError();
  }

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
