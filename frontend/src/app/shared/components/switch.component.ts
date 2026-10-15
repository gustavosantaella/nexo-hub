import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  booleanAttribute,
} from '@angular/core';

/**
 * Interruptor de encendido/apagado reutilizable.
 *
 * Sustituye a las casillas (`<input type="checkbox">`) cuando la opción se lee
 * mejor como un interruptor: "esto está activado o no". Pinta el control
 * (`role="switch"`, con el estado en `aria-checked` para los lectores de
 * pantalla), la etiqueta y, si se le pasa, una pista que explica qué hace.
 *
 * Uso:
 *
 * ```html
 * <app-switch
 *   [checked]="showsConversion(code)"
 *   [label]="'Mostrar la conversión en ' + label"
 *   hint="Con la tasa del BCV."
 *   (checkedChange)="toggleConversion(code, $event)"
 * />
 * ```
 *
 * Es un componente controlado: no cambia solo, avisa con `checkedChange` y quien
 * lo usa decide (y vuelve a pintarlo con el valor nuevo). Con `disabled` no emite.
 */
@Component({
  selector: 'app-switch',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex items-start gap-3" [class.opacity-60]="disabled">
      <button
        type="button"
        role="switch"
        class="relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-1 disabled:cursor-not-allowed"
        [class.bg-brand-600]="checked"
        [class.bg-slate-300]="!checked"
        [attr.aria-checked]="checked"
        [attr.aria-label]="ariaLabel || label || null"
        [disabled]="disabled"
        (click)="toggle()"
      >
        <span
          class="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform"
          [class.translate-x-4]="checked"
          [class.translate-x-1]="!checked"
        ></span>
      </button>

      @if (label || hint) {
        <span
          class="min-w-0 select-none"
          [class.cursor-pointer]="!disabled"
          (click)="toggle()"
        >
          @if (label) {
            <span class="block text-sm font-medium text-slate-900">{{ label }}</span>
          }
          @if (hint) {
            <span class="mt-0.5 block text-xs text-slate-500">{{ hint }}</span>
          }
        </span>
      }
    </div>
  `,
})
export class SwitchComponent {
  /** Estado del interruptor (lo controla quien lo usa). */
  @Input({ transform: booleanAttribute }) checked = false;
  /** Texto visible junto al interruptor. */
  @Input() label = '';
  /** Explicación corta debajo de la etiqueta. */
  @Input() hint = '';
  /** Nombre accesible cuando no hay `label` visible. */
  @Input() ariaLabel = '';
  /** Apagado: no se puede pulsar ni emite cambios. */
  @Input({ transform: booleanAttribute }) disabled = false;

  /** Se emite el estado contrario al pulsar (nunca si está deshabilitado). */
  @Output() checkedChange = new EventEmitter<boolean>();

  toggle(): void {
    if (this.disabled) return;
    this.checkedChange.emit(!this.checked);
  }
}
