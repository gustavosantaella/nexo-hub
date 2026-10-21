import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './core/services/theme.service';
import { ConfirmHostComponent } from './shared/components/confirm-host.component';
import { ToastHostComponent } from './shared/components/toast-host.component';

/**
 * Raiz de la aplicacion. Ademas del `router-outlet` monta los hosts globales
 * de notificaciones y de confirmacion: ambos servicios los requieren para
 * poder renderizar (sin el host, `ConfirmService.ask()` nunca resuelve).
 *
 * Tambien aplica el tema (claro/oscuro) guardado en el navegador: el servicio
 * se inyecta aqui para que la clase `dark` quede puesta desde el arranque,
 * sin esperar a que el usuario entre en Configuracion.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ToastHostComponent, ConfirmHostComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.component.html',
})
export class AppComponent {
  constructor() {
    inject(ThemeService);
  }
}

