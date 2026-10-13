import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import { IconComponent } from './icon.component';

/** Ventana modal generica (Cabecera + cuerpo + pie proyectado). */
@Component({
  selector: 'app-modal',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open) {
      <div class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-6">
        <div
          class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm"
          (click)="onBackdrop()"
        ></div>

        <div class="relative w-full rounded-2xl bg-white shadow-2xl" [class]="widthClass">
          <div class="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
            <div>
              <h2 class="text-base font-semibold text-slate-900">{{ title }}</h2>
              @if (subtitle) {
                <p class="mt-0.5 text-xs text-slate-500">{{ subtitle }}</p>
              }
            </div>
            <button
              type="button"
              class="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              (click)="close()"
              aria-label="Cerrar"
            >
              <app-icon name="close" size="h-5 w-5" />
            </button>
          </div>

          <div class="max-h-[70vh] overflow-y-auto px-5 py-5">
            <ng-content />
          </div>

          <!-- Mismo gancho (dialog-footer) que el panel lateral: el pie se
               dibuja siempre en la barra inferior, nunca junto al cuerpo. -->
          <div
            class="dialog-footer flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-5 py-4"
          >
            <ng-content select="[modalFooter]" />
          </div>
        </div>
      </div>
    }
  `,
})
export class ModalComponent {
  @Input() open = false;
  @Input() title = '';
  @Input() subtitle?: string;
  @Input() size: 'sm' | 'md' | 'lg' | 'xl' = 'md';
  @Input() closeOnBackdrop = true;
  @Output() closed = new EventEmitter<void>();

  get widthClass(): string {
    const widths: Record<string, string> = {
      sm: 'max-w-md',
      md: 'max-w-xl',
      lg: 'max-w-3xl',
      xl: 'max-w-5xl',
    };
    return widths[this.size] ?? widths['md'];
  }

  onBackdrop(): void {
    if (this.closeOnBackdrop) this.close();
  }

  close(): void {
    this.closed.emit();
  }
}
