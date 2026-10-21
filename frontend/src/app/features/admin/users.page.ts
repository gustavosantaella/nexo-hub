import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { ROLE_LABELS, ROLE_OPTIONS } from '../../core/constants/domain';
import type {
  CompanyMember,
  Paginated,
  PaginationMeta,
  Role,
  UserPayload,
} from '../../core/models/api.model';
import { AuthService } from '../../core/services/auth.service';
import { UsersService } from '../../core/services/catalog.service';
import { ToastService } from '../../core/services/toast.service';
import { dateTime } from '../../core/utils/format';
import { EmptyStateComponent, LoaderComponent } from '../../shared/components/feedback.component';
import { IconComponent } from '../../shared/components/icon.component';
import { ModalComponent } from '../../shared/components/modal.component';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { PaginationComponent } from '../../shared/components/pagination.component';
import { ConfirmService } from '../../shared/services/confirm.service';

const EMPTY_META: PaginationMeta = {
  total: 0,
  page: 1,
  limit: 20,
  totalPages: 0,
  hasNextPage: false,
  hasPreviousPage: false,
};

const MIN_PASSWORD_LENGTH = 6;

interface MemberForm {
  email: string;
  name: string;
  documentId: string;
  phone: string;
  password: string;
  role: Role;
  active: boolean;
}

/**
 * Administración de usuarios de la EMPRESA ACTIVA (solo ADMIN).
 *
 * En el modelo multi-empresa la cuenta es global, pero el rol, el estado y el
 * acceso se guardan por empresa: la API siempre devuelve los miembros de la
 * empresa activa.
 */
@Component({
  selector: 'app-users',
  standalone: true,
  imports: [
    FormsModule,
    IconComponent,
    PageHeaderComponent,
    PaginationComponent,
    ModalComponent,
    EmptyStateComponent,
    LoaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './users.page.html',
})
export class UsersPage implements OnInit {
  readonly auth = inject(AuthService);
  private readonly users = inject(UsersService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  /** Helpers de formato expuestos a la plantilla. */
  readonly dateTime = dateTime;

  readonly items = signal<CompanyMember[]>([]);
  readonly meta = signal<PaginationMeta>(EMPTY_META);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly modalOpen = signal(false);
  readonly editing = signal<CompanyMember | null>(null);

  /** Nombre de la empresa activa (aclara de qué empresa son los usuarios). */
  readonly companyName = computed(() => this.auth.company()?.name ?? 'la empresa');
  readonly subtitle = computed(() => `Usuarios y roles de ${this.companyName()}`);

  readonly roleOptions = ROLE_OPTIONS;
  readonly roleLabels = ROLE_LABELS;
  readonly roleClasses: Record<string, string> = {
    ADMIN: 'bg-brand-50 text-brand-700',
    MANAGER: 'bg-sky-100 text-sky-700',
    CASHIER: 'bg-slate-200 text-slate-600',
  };
  readonly minPasswordLength = MIN_PASSWORD_LENGTH;

  search = '';
  showPassword = false;

  private page = 1;
  private limit = 20;

  form: MemberForm = this.emptyForm();

  ngOnInit(): void {
    this.load();
  }

  private emptyForm(): MemberForm {
    return {
      email: '',
      name: '',
      documentId: '',
      phone: '',
      password: '',
      role: 'CASHIER',
      active: true,
    };
  }
  /**
   * `UsersService` es un `CrudService<User, UserPayload>`, pero el endpoint
   * devuelve `CompanyMember` (con el rol de la empresa activa); se adapta aquí.
   */
  private listMembers(query: Record<string, unknown>): Observable<Paginated<CompanyMember>> {
    return this.users.list(query) as unknown as Observable<Paginated<CompanyMember>>;
  }

  load(): void {
    this.loading.set(true);
    this.listMembers({
      page: this.page,
      limit: this.limit,
      search: this.search.trim() || undefined,
    }).subscribe({
      next: (response) => {
        this.items.set(response.items);
        this.meta.set(response.meta);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  applySearch(): void {
    this.page = 1;
    this.load();
  }

  changePage(page: number): void {
    this.page = page;
    this.load();
  }

  changeLimit(limit: number): void {
    this.limit = limit;
    this.page = 1;
    this.load();
  }

  isSelf(item: CompanyMember): boolean {
    return item.id === this.auth.user()?.id;
  }

  roleLabel(item: CompanyMember): string {
    return this.roleLabels[item.role] ?? item.role;
  }

  openCreate(): void {
    this.editing.set(null);
    this.showPassword = false;
    this.form = this.emptyForm();
    this.modalOpen.set(true);
  }

  openEdit(item: CompanyMember): void {
    this.editing.set(item);
    this.showPassword = false;
    this.form = {
      email: item.email,
      name: item.name,
      documentId: item.documentId ?? '',
      phone: item.phone ?? '',
      password: '',
      role: item.role,
      active: item.active,
    };
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.modalOpen.set(false);
  }

  save(): void {
    if (this.saving()) return;
    this.saving.set(true);

    const current = this.editing();
    const payload: UserPayload = {
      email: this.form.email.trim().toLowerCase(),
      name: this.form.name.trim(),
      documentId: this.form.documentId.trim() || undefined,
      role: this.form.role,
      phone: this.form.phone.trim() || undefined,
      active: this.form.active,
    };
    const password = this.form.password;
    if (password) payload.password = password;

    const request = current
      ? this.users.update(current.id, payload)
      : this.users.create(payload);

    request.subscribe({
      next: () => {
        this.saving.set(false);
        this.closeModal();
        if (current && current.id === this.auth.user()?.id) {
          this.toast.info(
            'Actualizaste tu propio acceso. Vuelve a iniciar sesión si cambiaste tus credenciales.',
          );
        }
        this.toast.success(current ? 'Usuario actualizado' : 'Usuario agregado');
        this.load();
      },
      error: () => this.saving.set(false),
    });
  }

  async remove(item: CompanyMember): Promise<void> {
    if (this.isSelf(item)) {
      this.toast.warning('No puedes quitarte a ti mismo de esta empresa.');
      return;
    }

    const confirmed = await this.confirm.ask({
      title: 'Quitar de la empresa',
      message: `¿Quitar a "${item.name}" de ${this.companyName()}? El usuario perderá el acceso a esta empresa.`,
      confirmLabel: 'Eliminar',
      tone: 'danger',
    });
    if (!confirmed) return;

    this.users.remove(item.id).subscribe({
      next: () => {
        this.toast.success('Usuario quitado de la empresa');
        this.load();
      },
    });
  }

}
