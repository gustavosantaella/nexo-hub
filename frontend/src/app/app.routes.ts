import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { roleGuard } from './core/guards/role.guard';

/**
 * Rutas de la aplicacion. Todo el back-office vive dentro del layout principal
 * (protegido por `authGuard`); cada modulo se carga de forma diferida.
 */
export const routes: Routes = [
  {
    path: 'login',
    title: 'Iniciar sesión · Nexo Hub',
    loadComponent: () =>
      import('./features/auth/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'registro',
    title: 'Registrar empresa · Nexo Hub',
    loadComponent: () =>
      import('./features/auth/register.page').then((m) => m.RegisterPage),
  },
  // Todo el back-office vive bajo el prefijo `/panel`.
  { path: '', pathMatch: 'full', redirectTo: 'panel' },
  {
    path: 'panel',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./layout/main-layout.component').then(
        (m) => m.MainLayoutComponent,
      ),
    children: [
      {
        path: '',
        pathMatch: 'full',
        title: 'Panel · Nexo Hub',
        loadComponent: () =>
          import('./features/dashboard/dashboard.page').then(
            (m) => m.DashboardPage,
          ),
      },
      {
        path: 'pedidos',
        title: 'Pedidos · Nexo Hub',
        loadComponent: () =>
          import('./features/operations/orders.page').then((m) => m.OrdersPage),
      },
      {
        path: 'caja',
        title: 'Caja · Nexo Hub',
        loadComponent: () =>
          import('./features/operations/cash.page').then((m) => m.CashPage),
      },
      {
        path: 'inventario',
        title: 'Inventario · Nexo Hub',
        loadComponent: () =>
          import('./features/operations/inventory.page').then(
            (m) => m.InventoryPage,
          ),
      },
      {
        path: 'productos',
        title: 'Productos · Nexo Hub',
        loadComponent: () =>
          import('./features/catalog/products.page').then(
            (m) => m.ProductsPage,
          ),
      },
      {
        path: 'menus',
        title: 'Menús · Nexo Hub',
        loadComponent: () =>
          import('./features/catalog/menus.page').then((m) => m.MenusPage),
      },
      {
        path: 'categorias',
        title: 'Categorías · Nexo Hub',
        loadComponent: () =>
          import('./features/catalog/categories.page').then(
            (m) => m.CategoriesPage,
          ),
      },
      {
        path: 'proveedores',
        title: 'Proveedores · Nexo Hub',
        loadComponent: () =>
          import('./features/catalog/suppliers.page').then(
            (m) => m.SuppliersPage,
          ),
      },
      {
        path: 'clientes',
        title: 'Clientes · Nexo Hub',
        loadComponent: () =>
          import('./features/catalog/customers.page').then(
            (m) => m.CustomersPage,
          ),
      },
      {
        path: 'gastos',
        title: 'Gastos · Nexo Hub',
        loadComponent: () =>
          import('./features/finance/expenses.page').then(
            (m) => m.ExpensesPage,
          ),
      },
      {
        path: 'cuentas-por-pagar',
        title: 'Cuentas por pagar · Nexo Hub',
        loadComponent: () =>
          import('./features/finance/payables.page').then((m) => m.PayablesPage),
      },
      {
        path: 'cuentas-por-cobrar',
        title: 'Cuentas por cobrar · Nexo Hub',
        loadComponent: () =>
          import('./features/finance/receivables.page').then(
            (m) => m.ReceivablesPage,
          ),
      },
      {
        path: 'reportes',
        title: 'Reportes · Nexo Hub',
        loadComponent: () =>
          import('./features/reports/stats.page').then((m) => m.StatsPage),
      },
      {
        path: 'configuracion',
        title: 'Configuración · Nexo Hub',
        loadComponent: () =>
          import('./features/settings/settings.page').then(
            (m) => m.SettingsPage,
          ),
      },
      {
        path: 'usuarios',
        title: 'Usuarios · Nexo Hub',
        canActivate: [roleGuard(['ADMIN'])],
        loadComponent: () =>
          import('./features/admin/users.page').then((m) => m.UsersPage),
      },
    ],
  },
  { path: '**', redirectTo: 'panel' },
];
