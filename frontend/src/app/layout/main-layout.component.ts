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

/**
 * Rutas de gestión del local. El cajero solo ve el punto de venta: tanto el
 * menú como los guards de ruta usan esta lista para impedirle el resto.
 */
const MANAGEMENT_ROLES: Role[] = ['ADMIN', 'MANAGER'];

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
  templateUrl: './main-layout.component.html',
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
  readonly showConversions = this.rates.showConversions;

  /**
   * Menú lateral de navegación (ver `LayoutService`). El botón de la cabecera lo
   * abre y lo cierra con animación, y la elección se recuerda en el navegador.
   */
  readonly sidebarOpen = this.layout.sidebarOpen;

  /**
   * Clases del menú replegado: fuera de pantalla en móvil (donde se desliza por
   * encima del contenido) y a ancho cero en escritorio (donde va fijo al lado).
   */
  readonly sidebarClasses = computed(() =>
    this.sidebarOpen() ? '' : '-translate-x-full lg:w-0 lg:border-r-0',
  );

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
  /** ADMIN/MANAGER ven los accesos de gestión del shell (tasas, caja). */
  readonly canManage = this.auth.canManage;
  readonly money = money;

  private readonly allGroups: NavGroup[] = [
    {
      title: 'Operación',
      items: [
        // El punto de venta es la única sección que ve el cajero.
        { label: 'Punto de venta', route: '/panel/caja/pos', icon: 'shopping-cart' },
        { label: 'Panel', route: '/panel', icon: 'grid', roles: MANAGEMENT_ROLES },
        { label: 'Pedidos', route: '/panel/pedidos', icon: 'receipt', roles: MANAGEMENT_ROLES },
        { label: 'Caja', route: '/panel/caja', icon: 'wallet', roles: MANAGEMENT_ROLES },
        { label: 'Inventario', route: '/panel/inventario', icon: 'box', roles: MANAGEMENT_ROLES },
      ],
    },
    {
      title: 'Catálogo',
      items: [
        { label: 'Menús', route: '/panel/menus', icon: 'menu', roles: MANAGEMENT_ROLES },
        { label: 'Productos', route: '/panel/productos', icon: 'tag', roles: MANAGEMENT_ROLES },
        { label: 'Categorías', route: '/panel/categorias', icon: 'folder', roles: MANAGEMENT_ROLES },
        { label: 'Proveedores', route: '/panel/proveedores', icon: 'truck', roles: MANAGEMENT_ROLES },
        { label: 'Clientes', route: '/panel/clientes', icon: 'users', roles: MANAGEMENT_ROLES },
      ],
    },
    // {
    //   title: 'Finanzas',
    //   items: [
    //     { label: 'Gastos', route: '/panel/gastos', icon: 'money' },
    //     { label: 'Cuentas por pagar', route: '/panel/cuentas-por-pagar', icon: 'trend-down' },
    //     { label: 'Cuentas por cobrar', route: '/panel/cuentas-por-cobrar', icon: 'trend-up' },
    //     {
    //       label: 'Reportes',
    //       route: '/panel/reportes',
    //       icon: 'chart',
    //       roles: ['ADMIN', 'MANAGER'],
    //     },
    //   ],
    // },
    {
      title: 'Sistema',
      items: [
        { label: 'Usuarios', route: '/panel/usuarios', icon: 'user-cog', roles: ['ADMIN'] },
        { label: 'Configuración', route: '/panel/configuracion', icon: 'settings', roles: MANAGEMENT_ROLES },
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

  /** Abre o cierra el menú lateral: el panel se despliega con animación. */
  toggleSidebar(): void {
    this.layout.toggleSidebar();
  }

  /** Cierra el menú lateral (fondo oscurecido o botón del panel). */
  closeSidebar(): void {
    this.layout.setSidebarOpen(false);
  }

  /**
   * El enlace del menú sólo lo cierra en móvil, donde tapa el contenido: en
   * escritorio se queda abierto para saltar de una sección a otra.
   */
  onNavClick(): void {
    if (!this.layout.desktopViewport()) this.closeSidebar();
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
