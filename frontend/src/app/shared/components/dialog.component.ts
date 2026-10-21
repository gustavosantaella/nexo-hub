import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  TemplateRef,
} from '@angular/core';
import { ModalComponent } from './modal.component';
import { SidebarComponent } from './sidebar.component';

/**
 * Contenedor de diálogos con dos presentaciones.
 *
 * Recibe el cuerpo y el pie como plantillas (`TemplateRef`) y los dibuja en una
 * **ventana modal** o en un **panel lateral** según `variant`. Así una pantalla
 * respeta la preferencia de la empresa (Configuración → Preferencias de la
 * interfaz) sin duplicar el formulario ni sus validaciones.
 *
 * ```html
 * <app-dialog [open]="open()" [variant]="dialogView()" title="Registrar movimiento"
 *   [body]="movementBody" [footer]="movementFooter" (closed)="close()" />
 * <ng-template #movementBody>…</ng-template>
 * <ng-template #movementFooter>…</ng-template>
 * ```
 *
 * `dialogView` es la preferencia de la empresa en Configuración, compartida por
 * la caja y los pedidos.
 */
@Component({
  selector: 'app-dialog',
  standalone: true,
  imports: [NgTemplateOutlet, ModalComponent, SidebarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dialog.component.html',
})
export class DialogComponent {
  @Input() open = false;
  @Input() title = '';
  @Input() subtitle?: string;
  @Input() size: 'sm' | 'md' | 'lg' | 'xl' = 'md';
  /** Presentación de la ventana: `modal` (centrada) o `sidebar` (lateral). */
  @Input() variant: 'modal' | 'sidebar' = 'modal';
  /** Cuerpo del diálogo. */
  @Input() body: TemplateRef<void> | null = null;
  /** Pie del diálogo (botones de acción). */
  @Input() footer: TemplateRef<void> | null = null;
  @Output() closed = new EventEmitter<void>();
}
