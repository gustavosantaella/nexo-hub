import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ConfirmHostComponent } from './shared/components/confirm-host.component';
import { ToastHostComponent } from './shared/components/toast-host.component';

/**
 * Raiz de la aplicacion. Ademas del `router-outlet` monta los hosts globales
 * de notificaciones y de confirmacion: ambos servicios los requieren para
 * poder renderizar (sin el host, `ConfirmService.ask()` nunca resuelve).
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ToastHostComponent, ConfirmHostComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <router-outlet />
    <app-toast-host />
    <app-confirm-host />
  `,
})
export class AppComponent {}

