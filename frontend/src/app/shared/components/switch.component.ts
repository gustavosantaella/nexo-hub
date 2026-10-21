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
  templateUrl: './switch.component.html',
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
