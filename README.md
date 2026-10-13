# Nexo Hub — Sistema de gestión para locales

Monorepo con **backend NestJS + Prisma (SQLite en desarrollo)** y **frontend Angular 18 (standalone + signals + Tailwind CSS)**.

```
nexo-hub/
├── backend/                 API REST (NestJS + Prisma + Swagger)
│   ├── prisma/schema.prisma Modelo de datos
│   ├── prisma/seed.ts       Datos demo (maestros + historial de 30 días)
│   └── src/modules/         auth, users, categories, suppliers, customers,
│                            inventory, products, orders, cash, expenses,
│                            payables, receivables, stats, rates, health
└── frontend/                SPA Angular 18
    └── src/app/
        ├── core/            modelos, servicios HTTP, interceptores, guards
        ├── shared/          componentes UI reutilizables
        ├── layout/          shell con barra lateral + cabecera
        └── features/        páginas por dominio (carga diferida)
```

## Requisitos

- Node.js 20+
- npm 10+

## Backend

```bash
cd backend
npm install
npx prisma generate
npx prisma migrate dev      # o `npx prisma db push` en una base nueva
npm run prisma:seed         # datos demo (maestros + historial de 30 días)
npm run start:dev           # http://localhost:3000/api
```

- Documentación Swagger: <http://localhost:3000/api/docs>
- Health check: <http://localhost:3000/api/health>

### Usuarios demo (`npm run prisma:seed`)

| Rol | Email | Contraseña |
| --- | --- | --- |
| ADMIN | `admin@nexohub.com` | `Admin123!` |
| MANAGER | `manager@nexohub.com` | `Manager123!` |
| CASHIER | `caja@nexohub.com` | `Caja123!` |
| CASHIER | `cashier@nexohub.com` | `Cashier123!` |

### Datos de demo que genera el seed

El seed deja la base lista para probar **todo** el sistema:

- **Maestros** (se actualizan con `upsert`, nunca se duplican): 4 usuarios, 7
  categorías, 5 proveedores, 8 clientes, 24 productos, la configuración de
  monedas (`USD`, `VES`, `EUR`, `COP` activas y `PEN` desactivada) y la **tasa
  personalizada** del dólar.
- **Historial de operación de los últimos 30 días** (se borra y se regenera en
  cada ejecución, de forma determinista):
  - ~44 sesiones de caja: fondo inicial en una moneda (USD/VES) o **mixto**
    (USD + Bs + EUR), movimientos de venta, gastos, retiros, depósitos,
    devoluciones y ajustes, y cierre con arqueo (cierres cuadrados, con
    sobrante y con faltante). La última sesión del día de hoy queda **`OPEN`**.
  - ~230 pedidos con items, descuentos e IVA, en todos los estados
    (`PENDING`, `CONFIRMED`, `PREPARING`, `READY`, `COMPLETED`, `CANCELLED`) y
    cobros en **USD, VES, EUR y COP** (efectivo, tarjeta, transferencia, Yape,
    Plin), incluyendo pagos partidos y abonos parciales.
  - ~100 gastos de todas las categorías y métodos, cuentas **por pagar** y
    **por cobrar** (pagadas, parciales, pendientes y anuladas) con sus abonos.
  - Inventario completo: carga inicial, reposiciones, consumo por venta y
    ajustes (deja algunos productos en **stock crítico** para probar alertas).
- El historial usa una serie ficticia de tasas (el bolívar se devalúa día a
  día); la última tasa de la serie es la que queda guardada como tasa
  personalizada, de modo que los datos de hoy cuadran con lo que muestra la UI.

Para partir de cero: `npm run db:reset` (borra la base, la recrea y siembra).

### Reglas de negocio destacadas

- **Caja**: una sola sesión `OPEN` a la vez; movimientos *append-only*;
  `esperado = fondo + efectivo IN − efectivo OUT`; cierre con arqueo
  (`countedAmount` vs `expectedAmount` → `difference`) y guardado contra dobles cierres.
- **Pedidos**: máquina de estados `PENDING → CONFIRMED → PREPARING → READY → COMPLETED`;
  cancelar exige que el pedido no tenga pagos; el pago total marca el pedido como `COMPLETED`.
  A un pedido en curso se le pueden **agregar productos** (`POST /orders/:id/items`, botón
  *Agregar productos* en el detalle): descuenta stock, recalcula subtotal/IGV/total con el
  descuento y la tasa del pedido, actualiza `paymentStatus` y fusiona los productos repetidos
  en una sola línea. Se rechaza en pedidos `COMPLETED`/`CANCELLED`.
  Si se cargó mal un producto, el detalle del pedido permite **corregir la cantidad**
  (`PATCH /orders/:id/items/:itemId`, ±1 en la tabla) o **quitarlo**
  (`DELETE /orders/:id/items/:itemId`): en ambos casos el stock se ajusta por la diferencia
  (o se devuelve completo) y los totales se recalculan; el pedido debe conservar al menos
  una línea y el nuevo total no puede quedar por debajo de lo ya pagado.
  Todo cobro (incluso con tarjeta) requiere una caja abierta.
- **Cuentas por cobrar/pagar**: el estado se deriva de `amount`/`paidAmount`;
  el saldo nunca es negativo; sobregiros rechazados; `CANCELLED` es un estado explícito.
- **Inventario**: motor único de stock con trazabilidad (`stockBefore`/`stockAfter`),
  salidas mayores al disponible rechazadas y ajustes a stock final.
- **Tasas de cambio**: las tasas oficiales se leen del BCV (publicadas por
  [dolarvzla](https://rates.dolarvzla.com/bcv/current.json)) y se cachean en el
  backend; el local puede además fijar una **tasa personalizada** (Bs por USD)
  desde `/configuracion`. Con 2 tasas (BCV dólar y euro) o 3 (más la
  personalizada) todos los montos del sistema se muestran "al cambio" en
  bolívares. Los montos se guardan y se muestran en la moneda base del sistema
  (**USD**).
- **Monedas de pago**: en Caja, al cobrar un pedido, al cobrar/pagar una cuenta
  y al registrar un gasto se elige la **moneda del pago**. El sistema trae por
  defecto **USD** (moneda base, tasa del BCV o la personalizada), **VES**
  (1 Bs = 1 Bs) y **EUR** (tasa del BCV): las tres se mantienen conectadas a la
  API del BCV y no necesitan tasa manual. Las monedas por defecto **no se pueden
  quitar** (solo desactivar, y el dólar tampoco eso) desde `/configuracion` →
  *Monedas aceptadas*; ahí mismo se agregan y quitan otras monedas (COP, PEN, …),
  que sí exigen su **tasa en bolívares por unidad**; cuando existe una **tasa
  personalizada** del dólar es la que se usa para convertir cualquier cobro a
  USD. Cada pago guarda la moneda, la tasa aplicada (`exchangeRate`) y su
  **equivalente en USD** (`baseAmount`), que es lo que suman el arqueo, los
  listados y las estadísticas; los desgloses *por moneda* muestran además los
  montos originales.
- **API de monedas**: `GET /api/currencies` (lista), `PUT /api/currencies`
  (reemplaza la configuración), `PUT|DELETE /api/currencies/:code` y
  `GET /api/stats/currencies` (cobros agrupados por moneda).

## Frontend

```bash
cd frontend
npm install
npm start                   # http://localhost:4200 (proxy /api → localhost:3000)
npm run build               # bundle de producción en dist/frontend
```

El desarrollo usa `proxy.conf.json`, por lo que las peticiones van a `/api` sin CORS.
La URL base de la API se configura en `src/environments/environment.ts`.

### Módulos de la interfaz

| Ruta | Pantalla |
| --- | --- |
| `/login` | Inicio de sesión |
| `/panel` | Panel con KPIs, caja, cobros del día y stock crítico |
| `/pedidos` | Tablero operativo + historial, creación de pedidos, cobros, y agregar/corregir/quitar productos a un pedido en curso |
| `/caja` | Apertura/cierre con arqueo, movimientos e historial de sesiones |
| `/inventario` | Niveles de stock, movimientos y ajustes |
| `/productos`, `/categorias`, `/proveedores`, `/clientes` | Catálogo |
| `/gastos`, `/cuentas-por-pagar`, `/cuentas-por-cobrar` | Finanzas |
| `/reportes` | Series de ventas/gastos/utilidad, top productos, métodos de pago y cobros por moneda |
| `/configuracion` | Tasas del BCV (dólar/euro, solo lectura), tasa personalizada, monedas aceptadas y vista previa |
| `/usuarios` | Administración de usuarios (solo ADMIN) |

## Notas

- El andamiaje React/Vite inicial fue descartado y eliminado: todo el front es Angular.
- Los archivos `api.*.log` y `ngserve.*.log` de la raíz son salidas de arranque
  de los servidores de desarrollo y no forman parte del código.
