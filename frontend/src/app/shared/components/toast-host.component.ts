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
  templateUrl: './toast-host.component.html',
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
