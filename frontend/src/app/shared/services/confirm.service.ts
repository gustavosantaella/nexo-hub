import { Injectable, signal } from '@angular/core';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
}

export interface ConfirmState extends ConfirmOptions {
  open: boolean;
}

/** Dialogo de confirmacion basado en promesas (`await confirm.ask(...)`). */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly state = signal<ConfirmState>({
    open: false,
    message: '',
    confirmLabel: 'Confirmar',
    cancelLabel: 'Cancelar',
    tone: 'primary',
  });

  private resolver: ((value: boolean) => void) | null = null;

  ask(options: ConfirmOptions): Promise<boolean> {
    // Si ya habia un dialogo pendiente (p. ej. el usuario pulso dos veces),
    // se resuelve como cancelado para no dejar promesas colgadas.
    this.resolver?.(false);

    this.state.set({
      open: true,
      confirmLabel: 'Confirmar',
      cancelLabel: 'Cancelar',
      tone: 'primary',
      ...options,
    });

    return new Promise<boolean>((resolve) => {
      this.resolver = resolve;
    });
  }

  resolve(value: boolean): void {
    this.state.update((current) => ({ ...current, open: false }));
    this.resolver?.(value);
    this.resolver = null;
  }
}
