import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import type { RegisterPayload } from '../../core/models/api.model';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';
import { apiErrorMessage } from '../../core/utils/format';
import { IconComponent } from '../../shared/components/icon.component';
import {
  AuthBrandComponent,
  type AuthBrandFeature,
} from './auth-brand.component';

/** Nivel de seguridad de la contrasena usado por la barra indicadora. */
interface PasswordStrength {
  label: string;
  percent: number;
  barClass: string;
  textClass: string;
}

/**
 * Registro de una empresa nueva (multi-empresa).
 *
 * Crea la empresa y su usuario administrador en una sola operación; al ir bien
 * queda la sesión iniciada con esa empresa y se entra al panel.
 */
@Component({
  selector: 'app-register',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent, AuthBrandComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './register.page.html',
  styleUrl: './auth-ui.scss',
})

export class RegisterPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  /** Ventajas mostradas en el panel de marca. */
  readonly brandFeatures: readonly AuthBrandFeature[] = [
    {
      icon: 'wallet',
      title: 'Caja, pedidos e inventario',
      description: 'Opera desde el primer día con arqueo y control de stock.',
    },
    {
      icon: 'trend-up',
      title: 'Cuentas por cobrar y pagar',
      description: 'Finanzas ordenadas y utilidad real por período.',
    },
    {
      icon: 'building',
      title: 'Varias empresas por usuario',
      description: 'Administra todos tus locales con una sola cuenta.',
    },
    {
      icon: 'users',
      title: 'Multi-usuario con roles',
      description: 'Cada persona ve y hace solo lo que le corresponde.',
    },
  ];

  readonly submitting = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly capsLock = signal(false);
  readonly year = new Date().getFullYear();
  readonly minPasswordLength = 6;

  showPassword = false;
  showConfirm = false;
  confirmPassword = '';

  readonly form = {
    company: { name: '', rif: '', phone: '', email: '', address: '' },
    user: { name: '', documentId: '', email: '', phone: '', password: '' },
  };

  /** Aviso en vivo: se muestra en cuanto el usuario escribe datos distintos. */
  passwordMismatch(): boolean {
    return !!this.confirmPassword && this.form.user.password !== this.confirmPassword;
  }

  /** Indicador de seguridad de la contrasena (longitud y variedad de caracteres). */
  strength(): PasswordStrength {
    const value = this.form.user.password;
    if (!value) {
      return {
        label: 'Sin contraseña',
        percent: 0,
        barClass: 'bg-slate-300',
        textClass: 'text-slate-400',
      };
    }

    let score = 0;
    if (value.length >= this.minPasswordLength) score += 1;
    if (value.length >= 10) score += 1;
    if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
    if (/\d/.test(value)) score += 1;
    if (/[^A-Za-z0-9]/.test(value)) score += 1;

    if (score <= 2) {
      return { label: 'Débil', percent: 33, barClass: 'bg-rose-500', textClass: 'text-rose-600' };
    }
    if (score === 3) {
      return {
        label: 'Aceptable',
        percent: 66,
        barClass: 'bg-amber-500',
        textClass: 'text-amber-600',
      };
    }
    return {
      label: 'Fuerte',
      percent: 100,
      barClass: 'bg-emerald-500',
      textClass: 'text-emerald-600',
    };
  }

  /** Limpia la alerta de error del servidor cuando el usuario corrige los datos. */
  clearError(): void {
    this.errorMessage.set(null);
  }

  /** Detecta Bloq Mayús en los eventos de teclado del campo de contraseña. */
  onCapsLock(event: KeyboardEvent): void {
    this.capsLock.set(event.getModifierState?.('CapsLock') ?? false);
  }

  submit(): void {
    if (this.submitting()) return;

    if (this.form.user.password.length < this.minPasswordLength) {
      this.toast.warning(
        `La contraseña debe tener al menos ${this.minPasswordLength} caracteres.`,
      );
      return;
    }
    if (this.form.user.password !== this.confirmPassword) {
      this.toast.warning('Las contraseñas no coinciden.');
      return;
    }

    const payload: RegisterPayload = {
      company: {
        name: this.form.company.name.trim(),
        rif: this.form.company.rif.trim(),
        phone: this.form.company.phone.trim() || undefined,
        email: this.form.company.email.trim() || undefined,
        address: this.form.company.address.trim() || undefined,
      },
      user: {
        name: this.form.user.name.trim(),
        documentId: this.form.user.documentId.trim(),
        email: this.form.user.email.trim().toLowerCase(),
        phone: this.form.user.phone.trim() || undefined,
        password: this.form.user.password,
      },
    };

    this.submitting.set(true);
    this.clearError();
    this.auth.register(payload).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.toast.success(
          `Bienvenido, ${response.user.name}`,
          `${response.company.name} registrada`,
        );
        void this.router.navigate(['/panel']);
      },
      error: (error: unknown) => {
        this.submitting.set(false);
        this.errorMessage.set(apiErrorMessage(error));
      },
    });
  }
}

