import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { IconComponent } from './icon.component';

/** Encabezado de pagina con acciones proyectadas. */
@Component({
  selector: 'app-page-header',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div class="flex items-start gap-3">
        <span
          class="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600/10 text-brand-700"
        >
          <app-icon [name]="icon" size="h-6 w-6" />
        </span>
        <div>
          <h1 class="text-xl font-semibold text-slate-900">{{ title }}</h1>
          @if (subtitle) {
            <p class="mt-0.5 text-sm text-slate-500">{{ subtitle }}</p>
          }
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <ng-content />
      </div>
    </header>
  `,
})
export class PageHeaderComponent {
  @Input({ required: true }) title = '';
  @Input() subtitle?: string;
  @Input() icon = 'grid';
}
