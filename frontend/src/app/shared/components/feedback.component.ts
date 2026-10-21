import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { IconComponent } from './icon.component';

/** Estado vacio estandar para tablas y listados. */
@Component({
  selector: 'app-empty-state',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './empty-state.component.html',
})
export class EmptyStateComponent {
  @Input() title = 'Sin datos';
  @Input() message?: string;
  @Input() icon = 'search';
}

/** Indicador de carga (spinner). */
@Component({
  selector: 'app-loader',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './loader.component.html',
})
export class LoaderComponent {
  @Input() label = 'Cargando información…';
}
