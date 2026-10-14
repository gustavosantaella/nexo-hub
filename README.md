# Nexo Hub — Sistema de gestión para locales

Monorepo con **backend NestJS + Prisma (SQLite en desarrollo)** y **frontend Angular 18 (standalone + signals + Tailwind CSS)**.

```
nexo-hub/
├── backend/                 API REST (NestJS + Prisma + Swagger)
│   ├── prisma/schema.prisma Modelo de datos (multi-empresa)
│   ├── prisma/seed.ts       Datos demo (maestros + historial de 30 días)
│   └── src/modules/         auth, companies, users, categories, suppliers,
│                            customers, inventory, products, orders, cash,
│                            expenses, payables, receivables, stats, rates,
│                            health
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

Los **roles son por empresa**: cada usuario tiene una *membresía* en cada
empresa a la que pertenece (`ADMIN`, `MANAGER` o `CASHIER`), y una misma cuenta
puede trabajar en varias empresas con roles distintos.

| Email | Contraseña | Rol en la empresa principal | Rol en la segunda empresa |
| --- | --- | --- | --- |
| `admin@nexohub.com` | `Admin123!` | ADMIN | MANAGER |
| `manager@nexohub.com` | `Manager123!` | MANAGER | ADMIN |
| `caja@nexohub.com` | `Caja123!` | CASHIER | - |
| `cashier@nexohub.com` | `Cashier123!` | CASHIER | - |

`admin@nexohub.com` y `manager@nexohub.com` pertenecen a las dos empresas a
propósito (y con roles distintos en cada una): al entrar se elige la primera
empresa activa y desde la cabecera (selector de empresa) se puede cambiar de una
a otra sin volver a iniciar sesión.

Si la base es anterior a la versión multi-empresa, `npm run db:reset` la
recrea y la vuelve a sembrar (los datos de demo se regeneran siempre).

### Datos de demo que genera el seed

El seed deja la base lista para probar **todo** el sistema:

- **Maestros** (se actualizan con `upsert`, nunca se duplican): 4 usuarios, 7
  categorías, 5 proveedores, 8 clientes, 24 productos, **3 categorías de menú y 5
  menús con su receta** (recetas sobre los productos del catálogo, con un
  ingrediente fraccionario: medio litro de jugo), la configuración de
  monedas (`USD`, `VES`, `EUR`, `COP` activas y `PEN` desactivada) y la **tasa
  personalizada** del dólar.
- **Dos empresas** (`Nexo Hub Demo, C.A.` y `Bodegon La Esquina, C.A.`): la
  principal recibe todo el historial; la segunda queda con su configuración y su
  catálogo (sin operaciones) para probar el aislamiento entre empresas y el
  cambio de empresa activa.
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
  El movimiento del cobro guarda el pago completo, así que el arqueo **separa las
  propinas de las ventas** (`tipsTotal`): la propina del pedido se reparte entre sus
  cobros (primero se cubre el consumo y la propina entra con el pago que lo completa),
  `salesTotal` queda sin propina y la tarjeta *Propinas* de la caja muestra lo recaudado
  en el turno (la vista de cajero/POS no la muestra).
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
- **Menús (platos y combos)**: además de los productos sueltos, el local vende
  **menús**: un plato o combo (`nombre`, `precio`, categoría propia de menús,
  disponibilidad, foto y minutos de preparación) armado con una **receta** de
  ingredientes tomados del inventario. Cada línea de la receta indica **cuánto
  consume una unidad del menú** en la misma unidad del stock del producto
  (`0.1` = 100 g si la carne se controla en kilos; `0.5` = medio litro de jugo) y
  una **sección** para la carta/comanda (*Principal*, *Bebida*, *Postre*,
  *Acompañamiento*). El sistema **costea la receta solo** (`Σ costo × cantidad`),
  muestra el **margen** y calcula la **disponibilidad**: `maxServings =`
  mínimo de `stock / cantidad` entre los ingredientes con control de inventario
  (`Ilimitado` si ninguno lo lleva, `Agotado` si el stock no alcanza).
  `POST /menus` valida que todos los productos existan y estén activos en la
  empresa, que no se repitan y que la cantidad sea mayor a 0; el código (`MEN-…`)
  se genera solo si no se envía y es único por empresa; el borrado es **baja
  lógica** (los pedidos referencian los menús vendidos).
  Se administra en `/panel/menus` (pestañas **Menús** y **Categorías**) y se
  ofrece en el **POS** (pestaña *Menús* de la grilla, que es la vista del cajero
  en `/panel/caja`) y en **Pedidos** (buscador y carrito con pestañas
  *Productos* | *Menús*). En la línea del pedido el menú viaja como `menuId`
  (una línea vende un producto **o** un menú, nunca ambos) y al guardar el
  backend **expande la receta** y descuenta el inventario de cada ingrediente
  (una salida por producto, agregando las cantidades repetidas); al corregir la
  cantidad, quitar la línea o cancelar el pedido, el stock se devuelve en la
  misma proporción. Los productos sin control de inventario no generan
  movimiento; los menús sin receta no se pueden vender y se cobran a su precio.
  En los reportes, la venta de un menú se atribuye **al menú** (no reparte el
  importe entre sus ingredientes): el menú aparece en *más vendidos* con su costo
  de receta y en *ventas por categoría* con su categoría de menú.
- **Cuentas por cobrar/pagar**: el estado se deriva de `amount`/`paidAmount`;
  el saldo nunca es negativo; sobregiros rechazados; `CANCELLED` es un estado explícito.
- **Inventario**: motor único de stock con trazabilidad (`stockBefore`/`stockAfter`),
  salidas mayores al disponible rechazadas y ajustes a stock final. Las existencias
  y las cantidades de los movimientos son **decimales de hasta 3 cifras** (0.1 =
  100 g de un producto medido en kilos): las recetas de los menús consumen
  fracciones, así que el motor de inventario es el único que normaliza el
  redondeo (`common/utils/quantity.util.ts`).
- **Tasas de cambio**: las tasas oficiales se leen del BCV (publicadas por
  [dolarvzla](https://rates.dolarvzla.com/bcv/current.json)) y se cachean en el
  backend; el local puede además fijar una **tasa personalizada** (Bs por USD)
  desde `/configuracion`. Con 2 tasas (BCV dólar y euro) o 3 (más la
  personalizada) todos los montos del sistema se muestran "al cambio" en
  bolívares. Los montos se guardan y se muestran en la moneda base del sistema
  (**USD**).
- **Tasa USDT de referencia (solo informativa)**: junto a las anteriores,
  `GET /api/rates` devuelve `reference` con la tasa **USDT/VES** publicada por
  [Binance P2P](https://fx.vexwallet.co/api/v1/fx/latest?pair=USDT/VES&source=binance&method=p2p_floor)
  (par, fuente, método, precio, `asOf` y `stale`). Se muestra en
  `/panel/configuracion` para comparar con la tasa del local, pero **no
  participa en ninguna conversión**: no aparece en los montos "al cambio", ni en
  las monedas de pago, ni en el `activeKey`. Si la fuente falla se sirve la
  última tasa conocida marcada como `stale` y, si nunca hubo dato, `reference`
  es `null` (el resto de la pantalla de tasas sigue funcionando).
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

## Multi-empresa (multi-tenant)

Nexo Hub es **multi-empresa**: una instalación atiende varias empresas a la vez
y los datos de cada una quedan aislados entre sí.

- **Registro** (`/registro` o `POST /api/auth/register`): crea la empresa
  (nombre, RIF, teléfono, correo, dirección) y su primer usuario **ADMIN**
  (nombre, cédula, correo, teléfono y contraseña) en una sola operación, y
  devuelve la sesión ya iniciada.
- **Empresa y membresía**: `Company` guarda los datos de la empresa (el `rif` es
  único en todo el sistema) y `Membership` une un usuario con una empresa
  aportando su **rol** (`ADMIN`/`MANAGER`/`CASHIER`) y su estado **en esa
  empresa**. La cuenta (`User`) es global: el mismo correo puede pertenecer a
  varias empresas y darse de baja en una no borra la cuenta.
- **Empresa en revisión** (`Company.active = false`): la empresa todavía no fue
  activada, así que **no se puede iniciar sesión** con ella. El login responde
  `403` con el código `COMPANY_UNDER_REVIEW` y el mensaje *"Su empresa aun sigue
  estando en revision. por favor espere a que lo contactemos"* (el mismo aviso se
  aplica a `POST /api/auth/switch-company`). Si el usuario pertenece a otra
  empresa activa, entra normalmente con esa; la empresa en revisión tampoco
  aparece en el selector de empresas. Para activarla:
  `UPDATE companies SET active = 1 WHERE rif = '<RIF>';`.
- **Aislamiento de datos**: todos los modelos de dominio (`categories`,
  `suppliers`, `customers`, `products`, `stock_movements`, `orders`,
  `order_items`, `order_payments`, `expenses`, `accounts_payable`,
  `payable_payments`, `accounts_receivable`, `receivable_payments`,
  `cash_sessions`, `cash_movements`) llevan `companyId`: cada consulta filtra
  por la empresa del token y las unicidades pasan a ser **por empresa** (nombre
  de categoría, `sku`, código de pedido y código de sesión de caja). La regla
  "una sola sesión de caja abierta" también es por empresa.
- **Sesión**: el JWT incluye la **empresa activa** (`companyId`) y el rol en
  ella. `POST /api/auth/switch-company` reemite el token para cambiar de empresa
  sin volver a iniciar sesión; `GET /api/auth/me` devuelve la sesión completa
  (usuario, empresa activa, rol y empresas del usuario).
- **Configuración por empresa**: `Setting` tiene clave compuesta
  `[companyId, key]`, así que las **monedas aceptadas** y la **tasa
  personalizada** son de cada empresa. Lo que es *por defecto* del sistema
  (monedas por defecto, tasas oficiales del BCV) es común a todas.
- **API relevante**: `POST /api/auth/register`, `GET /api/auth/me`,
  `POST /api/auth/switch-company`, `PATCH /api/auth/profile` (mis datos),
  `GET /api/companies/mine`, `POST /api/companies` (crear otra empresa para la
  misma cuenta), `GET|PATCH /api/companies/current` (datos de la empresa activa)
  y `/api/users` (usuarios de la **empresa activa**, solo ADMIN). Desde esta
  versión, `GET /api/rates` y `GET /api/currencies` requieren token.
- **Base de datos existente**: el proyecto usa `prisma db push` (no hay carpeta
  `migrations`), así que una base creada antes de esta versión no puede rellenar
  sola el `companyId` de las filas antiguas. Para una base con datos reales:
  registra la empresa, crea su membresía ADMIN y asigna ese `companyId` a las
  filas previas con `UPDATE` en cada tabla (`categories`, `suppliers`,
  `customers`, `products`, `stock_movements`, `orders`, `order_items`,
  `order_payments`, `expenses`, `accounts_payable`, `payable_payments`,
  `accounts_receivable`, `receivable_payments`, `cash_sessions`,
  `cash_movements` y `settings`). En desarrollo basta `npm run db:reset`.

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
| `/login` | Inicio de sesión (accesos de prueba con un clic) |
| `/registro` | Registro de una empresa nueva con su usuario administrador |
| `/panel` | Panel con KPIs, caja, cobros del día y stock crítico |
| `/panel/pedidos` | Tablero operativo + historial, creación de pedidos (productos y menús), cobros, y agregar/corregir/quitar productos a un pedido en curso |
| `/panel/caja` | Apertura/cierre con arqueo, movimientos e historial de sesiones; incluye el **POS** del cajero, con la grilla de productos y la carta de **menús** |
| `/panel/inventario` | Niveles de stock, movimientos y ajustes |
| `/panel/menus` | Menús (platos/combos) con su receta de ingredientes, costo, margen y disponibilidad, y sus categorías |
| `/panel/productos`, `/panel/categorias`, `/panel/proveedores`, `/panel/clientes` | Catálogo |
| `/panel/gastos`, `/panel/cuentas-por-pagar`, `/panel/cuentas-por-cobrar` | Finanzas |
| `/panel/reportes` | Series de ventas/gastos/utilidad, top productos, métodos de pago y cobros por moneda |
| `/panel/configuracion` | Por pestañas: **Tasas** (tasas del BCV dólar/euro solo lectura, tasa USDT de referencia solo informativa, tasa personalizada, monedas aceptadas y vista previa), **Apariencia** (modo claro/oscuro y cómo se abren los formularios de caja y pedidos), **Empresa** (datos de la empresa activa y crear otras) y **Mis datos** (perfil y contraseña) |
| `/panel/usuarios` | Usuarios de la empresa activa (solo ADMIN) |

Todo el back-office vive bajo el prefijo `/panel` (protegido por `authGuard`);
`/` redirige a `/panel` y cualquier ruta desconocida también.

La cabecera muestra la **empresa activa** y, cuando el usuario pertenece a más
de una, un selector para cambiar de empresa sin volver a iniciar sesión.

## Notas

- El andamiaje React/Vite inicial fue descartado y eliminado: todo el front es Angular.
- Los archivos `api.*.log` y `ngserve.*.log` de la raíz son salidas de arranque
  de los servidores de desarrollo y no forman parte del código.
