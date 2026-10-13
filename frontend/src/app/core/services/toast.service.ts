import { Injectable, signal } from '@angular/core';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  title?: string;
}

/** Notificaciones efimeras (esquina inferior derecha). */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private counter = 0;
  readonly toasts = signal<Toast[]>([]);

  success(message: string, title?: string) {
    this.push('success', message, title);
  }

  error(message: string, title?: string) {
    this.push('error', message, title);
  }

  info(message: string, title?: string) {
    this.push('info', message, title);
  }

  warning(message: string, title?: string) {
    this.push('warning', message, title);
  }

  dismiss(id: number) {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }

  private push(kind: ToastKind, message: string, title?: string) {
    const id = ++this.counter;
    this.toasts.update((list) => [...list, { id, kind, message, title }]);
    setTimeout(() => this.dismiss(id), kind === 'error' ? 7000 : 4000);
  }
}
