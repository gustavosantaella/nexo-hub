import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService, type ToastKind } from '../../core/services/toast.service';
import { IconComponent } from './icon.component';

const STYLES: Record<ToastKind, string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  error: 'border-rose-200 bg-rose-50 text-rose-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  info: 'border-sky-200 bg-sky-50 text-sky-800',
};

const ICON_NAMES: Record<ToastKind, string> = {
  success: 'check',
  error: 'alert',
  warning: 'alert',
  info: 'info',
};

/** Contenedor global de notificaciones. */
@Component({
  selector: 'app-toast-host',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-2"
    >
      @for (toast of toasts(); track toast.id) {
        <div
          class="pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 shadow-lg"
          [class]="styleFor(toast.kind)"
          role="status"
        >
          <app-icon [name]="iconFor(toast.kind)" size="h-5 w-5" class="mt-0.5 shrink-0" />
          <div class="flex-1 text-sm leading-snug">
            @if (toast.title) {
              <p class="font-semibold">{{ toast.title }}</p>
            }
            <p>{{ toast.message }}</p>
          </div>
          <button
            type="button"
            class="shrink-0 rounded p-1 opacity-60 transition hover:opacity-100"
            (click)="dismiss(toast.id)"
            aria-label="Cerrar notificación"
          >
            <app-icon name="close" size="h-4 w-4" />
          </button>
        </div>
      }
    </div>
  `,
})
export class ToastHostComponent {
  private readonly toastService = inject(ToastService);
  readonly toasts = this.toastService.toasts;

  styleFor(kind: ToastKind): string {
    return STYLES[kind];
  }

  iconFor(kind: ToastKind): string {
    return ICON_NAMES[kind];
  }

  dismiss(id: number): void {
    this.toastService.dismiss(id);
  }
}
