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
  templateUrl: './pagination.component.html',
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
