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
  template: `
    @if (state().open) {
      <div class="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm" (click)="cancel()"></div>
        <div class="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
          <div class="flex items-start gap-4">
            <span
              class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
              [class]="state().tone === 'danger' ? 'bg-rose-100 text-rose-600' : 'bg-brand-50 text-brand-700'"
            >
              <app-icon
                [name]="state().tone === 'danger' ? 'alert' : 'info'"
                size="h-5 w-5"
              />
            </span>
            <div class="flex-1">
              <h2 class="text-base font-semibold text-slate-900">
                {{ state().title ?? 'Confirmar acción' }}
              </h2>
              <p class="mt-1 text-sm text-slate-600">{{ state().message }}</p>
            </div>
          </div>

          <div class="mt-6 flex justify-end gap-2">
            <button type="button" class="btn-secondary" (click)="cancel()">
              {{ state().cancelLabel }}
            </button>
            <button
              type="button"
              [class]="state().tone === 'danger' ? 'btn-danger' : 'btn-primary'"
              (click)="accept()"
            >
              {{ state().confirmLabel }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
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
