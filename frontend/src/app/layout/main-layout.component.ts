import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import type { Role } from '../core/models/api.model';
import type { CashSession } from '../core/models/operations.model';
import { AuthService } from '../core/services/auth.service';
import { CashService } from '../core/services/cash.service';
import { LayoutService } from '../core/services/layout.service';
import { RatesService } from '../core/services/rates.service';
import { ThemeService } from '../core/services/theme.service';
import { ToastService } from '../core/services/toast.service';
import { RATE_META } from '../core/constants/currency';
import { money, rate } from '../core/utils/format';
import { IconComponent } from '../shared/components/icon.component';
import { ConfirmService } from '../shared/services/confirm.service';

interface NavItem {
  label: string;
  route: string;
  icon: string;
  roles?: Role[];
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

/** Shell del back-office: barra lateral + cabecera + contenido. */
@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [
    FormsModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    IconComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `    <div class="flex min-h-screen bg-slate-100">
      @if (!fullscreen()) {
      <aside
        class="fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-slate-200 bg-white transition-transform lg:static lg:translate-x-0"
        [class.-translate-x-full]="!sidebarOpen()"
      >
        <div class="flex h-16 items-center gap-2 border-b border-slate-200 px-5">
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white">
            <app-icon name="building" size="h-5 w-5" />
          </span>
          <div class="leading-tight">
            <p class="text-sm font-semibold text-slate-900">Nexo Hub</p>
            <p class="text-[11px] text-slate-500">Panel de control</p>
          </div>
        </div>

        <nav class="flex-1 overflow-y-auto px-3 py-2">
          @for (group of groups(); track group.title) {
            <p class="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              {{ group.title }}
            </p>
            @for (item of group.items; track item.route) {
              <a
                [routerLink]="item.route"
                routerLinkActive="bg-brand-50 text-brand-700"
                [routerLinkActiveOptions]="{ exact: item.route === '/panel' }"
                class="mb-0.5 flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
                (click)="closeSidebarOnMobile()"
              >
                <app-icon [name]="item.icon" size="h-5 w-5" />
                <span class="flex-1">{{ item.label }}</span>
              </a>
            }
          }
        </nav>

        <div class="border-t border-slate-200 p-3">
          <div class="mb-2 flex items-center gap-3 rounded-lg px-2 py-2">
            <span
              class="flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-600"
            >
              {{ initials() }}
            </span>
            <div class="min-w-0 flex-1 leading-tight">
              <p class="truncate text-sm font-medium text-slate-800">{{ user()?.name }}</p>
              <p class="truncate text-[11px] text-slate-500">{{ roleLabel() }}</p>
            </div>
          </div>
          <button type="button" class="btn-ghost w-full justify-start" (click)="logout()">
            <app-icon name="logout" size="h-5 w-5" />
            Cerrar sesión
          </button>
        </div>
      </aside>
      }

      @if (!fullscreen() && sidebarOpen()) {
        <div
          class="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
          (click)="sidebarOpen.set(false)"
        ></div>
      }

      <div class="flex min-w-0 flex-1 flex-col">
        @if (!fullscreen()) {
        <header
          class="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:px-6"
        >
          <button
            type="button"
            class="btn-ghost px-2 lg:hidden"
            (click)="sidebarOpen.set(!sidebarOpen())"
            aria-label="Abrir menú"
          >
            <app-icon name="menu" size="h-5 w-5" />
          </button>

          @if (companies().length > 1) {
            <div class="flex items-center gap-2">
              <span class="hidden text-slate-400 sm:inline">
                <app-icon name="building" size="h-4 w-4" />
              </span>
              <select
                class="input h-9 w-auto max-w-[14rem] py-0 text-xs font-semibold"
                aria-label="Empresa activa"
                [ngModel]="company()?.id"
                [disabled]="switching()"
                (ngModelChange)="changeCompany($event)"
              >
                @for (item of companies(); track item.id) {
                  <option [value]="item.id">{{ item.name }}</option>
                }
              </select>
            </div>
          } @else {
            @if (company(); as current) {
              <span
                class="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600"
              >
                <app-icon name="building" size="h-3.5 w-3.5" />
                {{ current.name }}
              </span>
            }
          }

          <div class="flex-1"></div>

          <a
            routerLink="/panel/configuracion"
            class="hidden items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition sm:flex"
            [class]="
              showConversions()
                ? 'border-brand-200 bg-brand-50 text-brand-700'
                : 'border-slate-200 bg-slate-50 text-slate-500'
            "
            [title]="rateTitle()"
          >
            <app-icon name="exchange" size="h-3.5 w-3.5" />
            {{ rateChip() }}
          </a>

          <a
            routerLink="/panel/caja"
            class="flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition"
            [class]="
              cashSession()
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-slate-200 bg-slate-50 text-slate-600'
            "
            [title]="cashSession() ? 'Caja ' + cashSession()!.code : 'Caja cerrada'"
          >
            <span
              class="h-2 w-2 rounded-full"
              [class]="cashSession() ? 'bg-emerald-500' : 'bg-slate-400'"
            ></span>
            @if (cashSession(); as session) {
              Caja abierta · {{ money(session.summary?.expectedCash ?? 0) }}
            } @else {
              Caja cerrada
            }
          </a>

          <button
            type="button"
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-600 transition hover:bg-slate-100 hover:text-slate-700"
            [title]="themeTitle()"
            [attr.aria-label]="themeTitle()"
            [attr.aria-pressed]="isDark()"
            (click)="toggleTheme()"
          >
            <app-icon [name]="isDark() ? 'sun' : 'moon'" size="h-4 w-4" />
          </button>
        </header>
        }

        <main class="flex-1 px-4 py-6 lg:px-6">
          <router-outlet />
        </main>
      </div>
    </div>
`,
})
export class MainLayoutComponent {
  private readonly auth = inject(AuthService);
  private readonly cash = inject(CashService);
  private readonly rates = inject(RatesService);
  private readonly confirm = inject(ConfirmService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  /**
   * Presentación del shell: cuando la vista activa (p. ej. el punto de venta)
   * pide pantalla completa, la barra lateral y la cabecera se ocultan.
   */
  private readonly layout = inject(LayoutService);
  readonly fullscreen = this.layout.fullscreen;

  readonly sidebarOpen = signal(false);
  readonly showConversions = this.rates.showConversions;

  // ------------------------------- Apariencia --------------------------------
  private readonly theme = inject(ThemeService);
  /** `true` cuando está activo el modo oscuro. */
  readonly isDark = this.theme.isDark;

  /** Acción del botón de tema (se adapta al tema activo). */
  readonly themeTitle = computed(() =>
    this.isDark() ? 'Activar modo claro' : 'Activar modo oscuro',
  );

  /**
   * Chip de la cabecera: tasa activa con la que se muestran los montos "al
   * cambio". Enlaza al módulo de configuración de tasas.
   */
  readonly rateChip = computed(() => {
    const snapshot = this.rates.snapshot();
    if (!snapshot || snapshot.rates.length === 0) return 'Tasas';

    const active =
      snapshot.rates.find((item) => item.key === snapshot.activeKey) ??
      snapshot.rates[0];
    const label = RATE_META[active.key]?.shortLabel ?? active.key;
    return `${label} ${rate(active.rate)}`;
  });

  readonly rateTitle = computed(() => {
    const snapshot = this.rates.snapshot();
    if (!snapshot) return 'Configurar las tasas de cambio';

    return [
      `Tasas activas: ${snapshot.rates.length}`,
      ...snapshot.rates.map(
        (item) => `${RATE_META[item.key]?.label ?? item.key}: Bs ${rate(item.rate)}`,
      ),
      this.showConversions()
        ? 'Montos al cambio: visibles'
        : 'Montos al cambio: ocultos',
    ].join(' · ');
  });

  readonly cashSession = signal<CashSession | null>(null);
  readonly switching = signal(false);
  readonly user = this.auth.user;
  readonly company = this.auth.company;
  readonly companies = this.auth.companies;
  readonly money = money;

  private readonly allGroups: NavGroup[] = [
    {
      title: 'Operación',
      items: [
        { label: 'Panel', route: '/panel', icon: 'grid' },
        { label: 'Pedidos', route: '/panel/pedidos', icon: 'receipt' },
        { label: 'Caja', route: '/panel/caja', icon: 'wallet' },
        { label: 'Inventario', route: '/panel/inventario', icon: 'box' },
      ],
    },
    {
      title: 'Catálogo',
      items: [
        { label: 'Menús', route: '/panel/menus', icon: 'menu' },
        { label: 'Productos', route: '/panel/productos', icon: 'tag' },
        { label: 'Categorías', route: '/panel/categorias', icon: 'folder' },
        { label: 'Proveedores', route: '/panel/proveedores', icon: 'truck' },
        { label: 'Clientes', route: '/panel/clientes', icon: 'users' },
      ],
    },
    {
      title: 'Finanzas',
      items: [
        { label: 'Gastos', route: '/panel/gastos', icon: 'money' },
        { label: 'Cuentas por pagar', route: '/panel/cuentas-por-pagar', icon: 'trend-down' },
        { label: 'Cuentas por cobrar', route: '/panel/cuentas-por-cobrar', icon: 'trend-up' },
        {
          label: 'Reportes',
          route: '/panel/reportes',
          icon: 'chart',
          roles: ['ADMIN', 'MANAGER'],
        },
      ],
    },
    {
      title: 'Sistema',
      items: [
        { label: 'Usuarios', route: '/panel/usuarios', icon: 'user-cog', roles: ['ADMIN'] },
        { label: 'Configuración', route: '/panel/configuracion', icon: 'settings' },
      ],
    },
  ];

  readonly groups = computed<NavGroup[]>(() => {
    const role = this.auth.role();
    return this.allGroups
      .map((group) => ({
        title: group.title,
        items: group.items.filter(
          (item) => !item.roles || (role && item.roles.includes(role)),
        ),
      }))
      .filter((group) => group.items.length > 0);
  });

  readonly roleLabel = computed(() => {
    const labels: Record<string, string> = {
      ADMIN: 'Administrador',
      MANAGER: 'Encargado',
      CASHIER: 'Cajero',
    };
    const role = this.auth.role();
    return role ? labels[role] : '';
  });

  readonly initials = computed(() => {
    const name = this.auth.user()?.name ?? '';
    return name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('');
  });

  constructor() {
    this.rates.ensureLoaded();
    this.loadCash();
    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => this.loadCash());
  }

  private loadCash(): void {
    this.cash.current().subscribe({
      next: (response) => {
        const session =
          response && 'status' in response
            ? (response as CashSession)
            : ((response as { session?: CashSession | null } | null)?.session ?? null);
        this.cashSession.set(session?.status === 'OPEN' ? session : null);
      },
      error: () => this.cashSession.set(null),
    });
  }

  closeSidebarOnMobile(): void {
    this.sidebarOpen.set(false);
  }

  /** Alterna el modo claro/oscuro desde la cabecera (misma preferencia que Configuración). */
  toggleTheme(): void {
    this.theme.toggleTheme();
  }

  /**
   * Cambia de empresa activa: el backend emite un token nuevo con el rol del
   * usuario en esa empresa y se recargan las tasas/monedas.
   */
  changeCompany(companyId: string): void {
    if (!companyId || companyId === this.company()?.id || this.switching()) return;

    this.switching.set(true);
    this.auth.switchCompany(companyId).subscribe({
      next: (response) => {
        this.switching.set(false);
        this.toast.success(
          `Ahora trabajas en ${response.company.name}`,
          'Empresa activa',
        );
        void this.router.navigate(['/panel']);
      },
      error: () => this.switching.set(false),
    });
  }

  async logout(): Promise<void> {
    const confirmed = await this.confirm.ask({
      title: 'Cerrar sesión',
      message: '¿Deseas salir del sistema?',
      confirmLabel: 'Cerrar sesión',
    });
    if (confirmed) this.auth.logout();
  }
}
