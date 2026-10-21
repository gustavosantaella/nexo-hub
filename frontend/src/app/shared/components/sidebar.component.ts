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
  templateUrl: './sidebar.component.html',
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
