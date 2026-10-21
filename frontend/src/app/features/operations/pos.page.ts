import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { PosComponent } from './pos.component';

/**
 * Vista del cajero (punto de venta), montada en `/panel/caja/pos`.
 *
 * El POS pide pantalla completa mientras esta abierto (oculta el shell del
 * back-office) y al salir vuelve al arqueo de Caja. La pagina de Caja se
 * reconstruye al volver, asi que recarga la sesion y sus movimientos sola.
 */
@Component({
  selector: 'app-pos-page',
  standalone: true,
  imports: [PosComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pos.page.html',
})
export class PosPage {
  private readonly router = inject(Router);

  /** Sale del punto de venta y regresa al arqueo de la caja. */
  close(): void {
    void this.router.navigate(['/panel/caja']);
  }
}
