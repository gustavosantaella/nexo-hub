import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { IconComponent } from './icon.component';

/** Estado vacio estandar para tablas y listados. */
@Component({
  selector: 'app-empty-state',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <span class="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        <app-icon [name]="icon" size="h-6 w-6" />
      </span>
      <div>
        <p class="font-medium text-slate-700">{{ title }}</p>
        @if (message) {
          <p class="mt-1 text-sm text-slate-500">{{ message }}</p>
        }
      </div>
      <ng-content />
    </div>
  `,
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
  template: `
    <div class="flex items-center justify-center gap-3 px-6 py-14 text-sm text-slate-500">
      <span
        class="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-brand-600"
      ></span>
      {{ label }}
    </div>
  `,
})
export class LoaderComponent {
  @Input() label = 'Cargando información…';
}
