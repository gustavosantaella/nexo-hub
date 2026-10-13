import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import type { PaginationMeta } from '../../core/models/api.model';
import { number } from '../../core/utils/format';
import { IconComponent } from './icon.component';

/** Paginacion reutilizable para todos los listados. */
@Component({
  selector: 'app-pagination',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3 text-sm text-slate-600"
    >
      <p>
        {{ meta.total === 0 ? 'Sin resultados' : start() + '–' + end() + ' de ' + totalLabel }}
      </p>

      <div class="flex items-center gap-2">
        <label class="text-xs text-slate-500">Filas</label>
        <select
          class="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
          [value]="meta.limit"
          (change)="onLimitChange($event)"
        >
          @for (option of limitOptions; track option) {
            <option [value]="option">{{ option }}</option>
          }
        </select>

        <button
          type="button"
          class="btn-secondary btn-sm"
          [disabled]="!meta.hasPreviousPage"
          (click)="go(meta.page - 1)"
        >
          <app-icon name="chevron-left" size="h-4 w-4" />
          Anterior
        </button>
        <span class="px-1 text-xs font-medium">
          Página {{ meta.page }} / {{ meta.totalPages || 1 }}
        </span>
        <button
          type="button"
          class="btn-secondary btn-sm"
          [disabled]="!meta.hasNextPage"
          (click)="go(meta.page + 1)"
        >
          Siguiente
          <app-icon name="chevron-right" size="h-4 w-4" />
        </button>
      </div>
    </div>
  `,
})
export class PaginationComponent {
  @Input({ required: true }) meta!: PaginationMeta;
  @Output() pageChange = new EventEmitter<number>();
  @Output() limitChange = new EventEmitter<number>();

  readonly limitOptions = [10, 20, 50, 100];

  get totalLabel(): string {
    return number(this.meta.total);
  }

  start(): number {
    return this.meta.total === 0 ? 0 : (this.meta.page - 1) * this.meta.limit + 1;
  }

  end(): number {
    return Math.min(this.meta.page * this.meta.limit, this.meta.total);
  }

  go(page: number): void {
    if (page < 1 || page > (this.meta.totalPages || 1)) return;
    this.pageChange.emit(page);
  }

  onLimitChange(event: Event): void {
    const value = Number((event.target as HTMLSelectElement).value);
    this.limitChange.emit(value);
  }
}
