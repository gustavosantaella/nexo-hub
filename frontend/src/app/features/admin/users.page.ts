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
  template: `    <app-page-header title="Usuarios" [subtitle]="subtitle()" icon="user-cog">
      @if (auth.isAdmin()) {
        <button type="button" class="btn-primary" (click)="openCreate()">
          <app-icon name="plus" size="h-4 w-4" />
          Nuevo usuario
        </button>
      }
    </app-page-header>

    <section class="card">
      <div class="card-header">
        <div class="flex w-full max-w-sm items-center gap-2">
          <div class="relative flex-1">
            <span class="pointer-events-none absolute left-3 top-2.5 text-slate-400">
              <app-icon name="search" size="h-4 w-4" />
            </span>
            <input
              class="input pl-9"
              placeholder="Buscar por nombre, cédula o correo…"
              [(ngModel)]="search"
              (keyup.enter)="applySearch()"
            />
          </div>
          <button type="button" class="btn-secondary" (click)="applySearch()">Buscar</button>
        </div>
      </div>

      @if (loading()) {
        <app-loader />
      } @else if (items().length === 0) {
        <app-empty-state
          title="Sin usuarios"
          message="Agrega al personal de esta empresa y asígnale su rol."
          icon="user-cog"
        />
      } @else {
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Cédula</th>
                <th>Correo</th>
                <th>Teléfono</th>
                <th class="text-center">Rol</th>
                <th class="text-center">Estado</th>
                <th>Último acceso</th>
                <th class="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              @for (item of items(); track item.id) {
                <tr>
                  <td class="font-medium text-slate-900">
                    {{ item.name }}
                    @if (isSelf(item)) {
                      <span class="badge ml-1 bg-brand-50 text-brand-700">Tú</span>
                    }
                  </td>
                  <td class="text-slate-500">{{ item.documentId || '—' }}</td>
                  <td class="text-slate-500">{{ item.email }}</td>
                  <td class="text-slate-500">{{ item.phone || '—' }}</td>
                  <td class="text-center">
                    <span class="badge" [class]="roleClasses[item.role]">
                      {{ roleLabel(item) }}
                    </span>
                  </td>
                  <td class="text-center">
                    <span
                      class="badge"
                      [class]="
                        item.active
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-slate-200 text-slate-600'
                      "
                    >
                      {{ item.active ? 'Activo' : 'Inactivo' }}
                    </span>
                  </td>
                  <td class="text-slate-500">{{ dateTime(item.lastLoginAt) }}</td>
                  <td>
                    <div class="flex justify-end gap-1">
                      <button
                        type="button"
                        class="btn-ghost btn-sm"
                        (click)="openEdit(item)"
                        title="Editar"
                      >
                        <app-icon name="edit" size="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        class="btn-ghost btn-sm text-rose-600"
                        [disabled]="isSelf(item)"
                        [title]="
                          isSelf(item)
                            ? 'No puedes quitarte a ti mismo'
                            : 'Quitar de la empresa'
                        "
                        (click)="remove(item)"
                      >
                        <app-icon name="trash" size="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <app-pagination
          [meta]="meta()"
          (pageChange)="changePage($event)"
          (limitChange)="changeLimit($event)"
        />
      }
    </section>
    <app-modal
      [open]="modalOpen()"
      [title]="editing() ? 'Editar usuario' : 'Nuevo usuario'"
      [subtitle]="'Miembro de ' + companyName()"
      size="lg"
      (closed)="closeModal()"
    >
      <form class="space-y-4" (ngSubmit)="save()" #userForm="ngForm">
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label class="label" for="user-email">Correo *</label>
            <input
              id="user-email"
              name="email"
              type="email"
              class="input"
              required
              [(ngModel)]="form.email"
              placeholder="usuario@empresa.com"
              autocomplete="off"
            />
          </div>
          <div>
            <label class="label" for="user-name">Nombre *</label>
            <input
              id="user-name"
              name="name"
              class="input"
              required
              minlength="2"
              [(ngModel)]="form.name"
              placeholder="Nombre y apellido"
            />
          </div>
          <div>
            <label class="label" for="user-document">Cédula</label>
            <input
              id="user-document"
              name="documentId"
              class="input"
              [(ngModel)]="form.documentId"
              placeholder="Ej. V-12345678"
            />
          </div>
          <div>
            <label class="label" for="user-phone">Teléfono</label>
            <input
              id="user-phone"
              name="phone"
              type="tel"
              class="input"
              [(ngModel)]="form.phone"
              placeholder="Ej. 987 654 321"
            />
          </div>
          <div>
            <label class="label" for="user-role">Rol en esta empresa</label>
            <select id="user-role" name="role" class="input" [(ngModel)]="form.role">
              @for (option of roleOptions; track option.value) {
                <option [value]="option.value">{{ option.label }}</option>
              }
            </select>
          </div>
          <div>
            <label class="label" for="user-password">
              Contraseña{{ editing() ? '' : ' *' }}
            </label>
            <div class="relative">
              <input
                id="user-password"
                name="password"
                class="input pr-24"
                [type]="showPassword ? 'text' : 'password'"
                [required]="!editing()"
                [minlength]="minPasswordLength"
                [(ngModel)]="form.password"
                placeholder="Mínimo 6 caracteres"
                autocomplete="new-password"
              />
              <button
                type="button"
                class="absolute right-2 top-1.5 rounded-md px-2 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-50"
                (click)="showPassword = !showPassword"
              >
                {{ showPassword ? 'Ocultar' : 'Mostrar' }}
              </button>
            </div>
            @if (editing()) {
              <p class="mt-1 text-xs text-slate-400">
                Déjala vacía para conservar la contraseña actual.
              </p>
            } @else {
              <p class="mt-1 text-xs text-slate-400">
                Si el correo ya existe, se agrega a esta empresa. Solo asigna una
                contraseña cuando sea un correo nuevo.
              </p>
            }
          </div>
        </div>

        <label class="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" name="active" class="h-4 w-4" [(ngModel)]="form.active" />
          Activo en esta empresa
        </label>

        <div modalFooter class="flex w-full justify-end gap-2">
          <button type="button" class="btn-secondary" (click)="closeModal()">Cancelar</button>
          <button type="submit" class="btn-primary" [disabled]="saving() || userForm.invalid">
            {{ saving() ? 'Guardando…' : 'Guardar' }}
          </button>
        </div>
      </form>
    </app-modal>
  `,
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
