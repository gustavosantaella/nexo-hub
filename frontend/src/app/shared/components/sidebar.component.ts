import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostListener,
  Input,
  Output,
} from '@angular/core';
import { IconComponent } from './icon.component';

/**
 * Panel lateral genérico (cabecera + cuerpo + pie proyectado).
 *
 * Es el equivalente lateral de `<app-modal>`: mismo contrato
 * (`open` / `title` / `subtitle` / `size` / `closed`) y el pie se proyecta con
 * el atributo `sidebarFooter`.
 *
 * Se desliza desde el lado derecho y ocupa toda la altura de la pantalla; el
 * cuerpo hace scroll por su cuenta, así que la cabecera y el pie quedan fijos
 * (el contenido no necesita su propio `overflow`).
 */
@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open) {
      <div class="fixed inset-0 z-50 flex justify-end">
        <div class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm" (click)="onBackdrop()"></div>

        <aside
          class="relative flex h-full w-full flex-col border-l border-slate-200 bg-white shadow-2xl"
          [class]="widthClass"
          role="dialog"
          aria-modal="true"
          [attr.aria-label]="title"
        >
          <div class="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
            <div class="min-w-0">
              <h2 class="truncate text-base font-semibold text-slate-900">{{ title }}</h2>
              @if (subtitle) {
                <p class="mt-0.5 text-xs text-slate-500">{{ subtitle }}</p>
              }
            </div>
            <button
              type="button"
              class="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              aria-label="Cerrar"
              (click)="close()"
            >
              <app-icon name="close" size="h-5 w-5" />
            </button>
          </div>

          <div class="flex-1 overflow-y-auto px-5 py-5">
            <ng-content />
          </div>

          <!-- Mismo gancho (dialog-footer) que la ventana modal: el pie se
               dibuja siempre en la barra inferior, nunca junto al cuerpo. -->
          <div
            class="dialog-footer flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-5 py-4"
          >
            <ng-content select="[sidebarFooter]" />
          </div>
        </aside>
      </div>
    }
  `,
})
export class SidebarComponent {
  @Input() open = false;
  @Input() title = '';
  @Input() subtitle?: string;
  /** Ancho máximo del panel. */
  @Input() size: 'sm' | 'md' | 'lg' | 'xl' = 'md';
  @Input() closeOnBackdrop = true;
  @Output() closed = new EventEmitter<void>();

  get widthClass(): string {
    const widths: Record<string, string> = {
      sm: 'max-w-sm',
      md: 'max-w-md',
      lg: 'max-w-2xl',
      xl: 'max-w-4xl',
    };
    return widths[this.size] ?? widths['md'];
  }

  onBackdrop(): void {
    if (this.closeOnBackdrop) this.close();
  }

  /** El panel flota sobre la página: `Esc` lo cierra cuando está abierto. */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open) this.close();
  }

  close(): void {
    this.closed.emit();
  }
}
