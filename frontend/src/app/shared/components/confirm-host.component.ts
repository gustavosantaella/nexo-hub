import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ConfirmService } from '../services/confirm.service';
import { IconComponent } from './icon.component';

/** Host del dialogo de confirmacion global (se monta en `AppComponent`). */
@Component({
  selector: 'app-confirm-host',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onEscape()',
  },
  templateUrl: './confirm-host.component.html',
})
export class ConfirmHostComponent {
  private readonly confirmService = inject(ConfirmService);
  readonly state = this.confirmService.state;

  accept(): void {
    this.confirmService.resolve(true);
  }

  cancel(): void {
    this.confirmService.resolve(false);
  }

  /** Escape = cancelar (solo si el dialogo esta abierto). */
  onEscape(): void {
    if (this.state().open) this.cancel();
  }
}
