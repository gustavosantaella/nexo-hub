# Plan de mejoras — Nexo Hub

> **Estado:** pendiente de ejecución (solo análisis).
> **Fecha del análisis:** 2026-10-22.
> **Raíz del proyecto:** `C:\Users\llxsa\projects\nexo-hub`.
> **Alcance:** backend NestJS + Prisma, frontend Angular 18, base de datos, seguridad, pruebas y operación.
>
> Este documento es la referencia para retomar el trabajo más adelante. Cada punto tiene
> un checkbox para marcarlo al completarse y los criterios para considerarlo terminado.

---

## Línea base verificada

- Arquitectura correcta: separación servicio/repositorio, multi-empresa con `companyId`
  en todos los registros de dominio, dinero en centavos con codec en la frontera de Prisma,
  cola persistente de trabajos (`BackgroundJob`) y OTP de cancelación.
- Pruebas al momento del análisis:
  - Backend: **410 tests / 25 suites** en verde.
  - Frontend: **494 tests** en verde.
  - Build de producción: **378,68 kB** inicial (presupuesto 500 kB de aviso / 1 MB de error).
- El plan **no** propone reescribir el sistema: se concentra en lo que impide operar con
  datos reales y en reducir deuda técnica concreta.

Leyenda de esfuerzo: **S** ≤ 1 día · **M** 2-5 días · **L** 1-2 semanas.

---

## Resumen ejecutivo

| Prioridad | Foco | Cantidad de puntos |
|-----------|------|--------------------|
| P0 | Bloqueantes antes de producción | 6 |
| P1 | Seguridad, consistencia y operación | 6 |
| P2 | Deuda técnica y experiencia | 7 |
| P3 | DevEx y mantenimiento | 4 |

---

## P0 — Bloqueantes antes de producción

### P0-1 · Migraciones de base de datos
- [ ] **Estado:** pendiente · **Esfuerzo:** M
- **Problema:** el proyecto se crea con `prisma db push`; no existe carpeta de migraciones.
- **Evidencia:** falta `backend/prisma/migrations`; el propio `README.md` (líneas 438-446)
  reconoce que una base anterior no puede rellenar sola el `companyId` de filas antiguas.
- **Acción propuesta:**
  1. Crear una línea base con `prisma migrate dev --name init` sobre una BD vacía.
  2. Versionar `backend/prisma/migrations`.
  3. Usar `prisma migrate deploy` en el despliegue (nunca `db push`).
  4. Definir la estrategia SQLite (desarrollo) → PostgreSQL (producción) y validarla en staging.
  5. Documentar el script de migración de datos existentes si ya hay base en uso.
- **Terminado cuando:** una base nueva y una base existente llegan al mismo esquema solo con
  `migrate deploy`, y el despliegue falla si hay migraciones pendientes.

### P0-2 · Validación de configuración al arrancar
- [ ] **Estado:** pendiente · **Esfuerzo:** S
- **Problema:** hay valores inseguros por defecto y no se valida el entorno.
- **Evidencia:**
  - `backend/src/config/configuration.ts:78-81`: si falta `JWT_SECRET` usa
    `nexo-hub-dev-secret` incluso en producción.
  - `backend/src/main.ts:48-50`: si `CORS_ORIGINS` está vacío, `origin: true` refleja
    cualquier origen.
- **Acción propuesta:** validación fail-fast (Joi/Zod o función propia en `configuration.ts`):
  en producción exigir `JWT_SECRET` (mínimo 32 caracteres), `CORS_ORIGINS` explícito y
  `DATABASE_URL`; prohibir el secreto y los orígenes de desarrollo. Documentar en `.env.example`.
- **Terminado cuando:** el proceso no arranca con `NODE_ENV=production` y configuración insegura.

### P0-3 · Credenciales demo fuera del bundle de producción
- [ ] **Estado:** pendiente · **Esfuerzo:** S
- **Problema:** el login incluye cuentas de demostración con contraseña en el código.
- **Evidencia:** `frontend/src/app/features/auth/login.page.ts:29-35`
  (`admin@nexohub.com / Admin123!`, `manager@...`, `cashier@...`, email precargado).
- **Acción propuesta:**
  1. Mostrar los accesos demo solo cuando `!environment.production` (o un flag de build).
  2. No precargar email en producción.
  3. En `backend/prisma/seed.ts`, abortar si `NODE_ENV === 'production'`.
- **Terminado cuando:** el build de producción no contiene contraseñas ni emails demo.

### P0-4 · Límite de intentos y protección contra fuerza bruta
- [ ] **Estado:** pendiente · **Esfuerzo:** M
- **Problema:** no hay throttling en login, registro, subidas ni OTP.
- **Evidencia:** no existe `@nestjs/throttler` ni equivalente en `backend/package.json`;
  `backend/src/modules/notifications/notifications.service.ts:475-490` valida el OTP por TTL
  pero no limita intentos fallidos.
- **Acción propuesta:**
  1. Añadir `@nestjs/throttler` global con límites conservadores.
  2. Límites estrictos por IP + usuario en `/auth/login`, `/auth/register` y media.
  3. Contador de intentos fallidos y bloqueo temporal progresivo en login.
  4. Contador de intentos por OTP (por ejemplo, 5) además de la expiración de 10 minutos.
- **Terminado cuando:** existen pruebas que demuestran el bloqueo tras N intentos.

### P0-5 · No filtrar detalles internos en errores 500
- [ ] **Estado:** pendiente · **Esfuerzo:** S
- **Evidencia:** `backend/src/common/filters/all-exceptions.filter.ts:63-65` devuelve
  `exception.message` de cualquier `Error`, también con status 500.
- **Acción propuesta:** en producción devolver un mensaje genérico para 500 e incluir un
  `requestId`; registrar el stack completo solo en el servidor. Mantener los mensajes
  de negocio de las `HttpException`.
- **Terminado cuando:** una excepción no controlada no expone rutas, SQL ni nombres internos.

### P0-6 · Respaldo y restauración de datos operativos
- [ ] **Estado:** pendiente · **Esfuerzo:** M
- **Problema:** solo se puede exportar el catálogo; no hay respaldo de pedidos, caja,
  cuentas ni imágenes.
- **Evidencia:** `backend/src/modules/data-transfer/` exporta únicamente catálogo.
- **Acción propuesta:**
  1. Script de backup de BD + `backend/private/img` con retención.
  2. Script de restauración probado en un entorno limpio.
  3. Documentar frecuencia, ubicación y responsable.
  4. Alerta si el backup falla.
- **Terminado cuando:** existe una restauración completa verificada (datos + imágenes).

---

## P1 — Seguridad, consistencia y calidad operativa

### P1-1 · Códigos secuenciales basados en `count()` (riesgo de colisión)
- [ ] **Estado:** pendiente · **Esfuerzo:** M
- **Problema:** el código del día se calcula contando registros de hoy. Si se elimina un
  pedido del día, el siguiente reutiliza un código ya existente y falla con `P2002`.
- **Evidencia:**
  - `backend/src/modules/orders/orders.repository.ts:199-205` (`countToday` cuenta todos
    los pedidos del día) y `backend/src/modules/orders/orders.service.ts:2363-2370`.
  - `backend/src/modules/cash/cash.repository.ts:149-155` y
    `backend/src/modules/cash/cash.service.ts:908`.
- **Acción propuesta:** calcular desde el máximo código del día o crear una tabla de
  secuencia por empresa/día; añadir reintento único ante violación de unicidad.
- **Terminado cuando:** borrar un pedido hoy no impide crear el siguiente.

### P1-2 · Pruebas end-to-end del backend
- [ ] **Estado:** pendiente · **Esfuerzo:** L
- **Problema:** el script `test:e2e` apunta a un archivo inexistente.
- **Evidencia:** `backend/package.json:19` referencia `backend/test/jest-e2e.json`; la
  carpeta `backend/test` no existe.
- **Acción propuesta:** suite con Supertest y BD temporal que cubra al menos:
  login → abrir caja → crear pedido → cobrar → cierre de caja; cancelación con OTP;
  aislamiento entre dos empresas; permisos por rol.
- **Terminado cuando:** `npm run test:e2e` pasa en local y en CI.

### P1-3 · Lint, formato y fronteras de arquitectura
- [ ] **Estado:** pendiente · **Esfuerzo:** S
- **Problema:** `lint` y `format` existen como scripts, pero las herramientas no están
  instaladas ni configuradas.
- **Evidencia:** `backend/package.json:15-16`; no hay `.eslintrc*`/`eslint.config.*` ni
  `.prettierrc*`; `npm ls eslint prettier` devuelve vacío.
- **Acción propuesta:** configurar ESLint + Prettier, script `typecheck`, y una regla
  (ESLint o dependency-cruiser) que prohíba usar Prisma fuera de `*.repository.ts`.
- **Terminado cuando:** `npm run lint` y `npm run typecheck` pasan y CI los ejecuta.

### P1-4 · Auditoría de acciones sensibles
- [ ] **Estado:** pendiente · **Esfuerzo:** L
- **Problema:** no hay traza consultable de cambios críticos; solo existen avisos por
  Telegram y el OTP de cancelación.
- **Acción propuesta:** tabla `AuditLog` (empresa, usuario, acción, entidad, `before/after`,
  IP, fecha) para: precios y costos, ajustes de inventario, roles y usuarios, tasas,
  apertura/cierre de caja, cancelaciones y eliminaciones. Endpoint de consulta solo ADMIN.
- **Terminado cuando:** las operaciones sensibles quedan registradas y son filtrables.

### P1-5 · Endurecimiento de la sesión
- [ ] **Estado:** pendiente · **Esfuerzo:** L
- **Problema:** JWT de 12 h en `localStorage`, sin refresh ni revocación; el logout solo
  borra el cliente.
- **Evidencia:** `frontend/src/app/core/auth/session.ts:76-84`;
  `backend/src/modules/auth/auth.service.ts:188-197`; `JWT_EXPIRES_IN=12h` en `.env.example`.
- **Acción propuesta (elegir una):**
  1. Access token corto (15-30 min) + refresh con rotación, o
  2. `tokenVersion` por usuario para invalidar tokens y logout con revocación real.
  Valorar cookie `httpOnly` + `SameSite`; sincronizar el cierre entre pestañas.
- **Nota positiva:** `backend/src/modules/auth/strategies/jwt.strategy.ts` ya revalida
  usuario y membresía en cada petición, así que desactivar un acceso surte efecto.
- **Terminado cuando:** cerrar sesión invalida el token en el servidor.

### P1-6 · Observabilidad y superficie expuesta
- [ ] **Estado:** pendiente · **Esfuerzo:** M
- **Problema:** logs básicos, sin ID de petición; Swagger siempre público; apagado sin hooks.
- **Evidencia:** `backend/src/common/interceptors/logging.interceptor.ts`;
  `backend/src/main.ts:62-77` monta Swagger sin condición; `PrismaService.enableShutdownHooks`
  existe pero no se invoca en `main.ts`.
- **Acción propuesta:**
  1. Logs estructurados (pino) con `requestId` y redacción de datos sensibles.
  2. Métricas: latencia, errores, backlog de `BackgroundJob`, estado de BCV/Telegram.
  3. `/health` de liveness y readiness separados.
  4. Swagger deshabilitado en producción (o protegido).
  5. `app.enableShutdownHooks()` y cierre ordenado de cola/Prisma.
- **Terminado cuando:** se puede diagnosticar una incidencia sin acceder al servidor.

---

## P2 — Deuda técnica y experiencia

### P2-1 · Componentes y servicios demasiado grandes
- [ ] **Estado:** pendiente · **Esfuerzo:** L
- **Evidencia (tamaño actual):**
  - `frontend/src/app/features/operations/pos.component.ts` — 2.336 líneas.
  - `backend/src/modules/orders/orders.service.ts` — 2.202 líneas.
  - `frontend/src/app/features/settings/settings.page.ts` — 1.444 líneas.
  - `frontend/src/app/features/operations/cash.page.ts` — 1.490 líneas.
  - `frontend/src/app/features/operations/orders.page.ts` — 1.295 líneas.
  - `backend/src/modules/cash/cash.service.ts` — 1.146 líneas.
- **Acción propuesta:** extraer subcomponentes y *facades* (grilla de productos, carrito,
  panel de cobro, formulario de caja, pestañas de configuración) y dividir los servicios
  por caso de uso sin romper el patrón repositorio.
- **Terminado cuando:** ningún archivo supera ~500-700 líneas y los tests siguen verdes.

### P2-2 · Funcionalidades terminadas pero inaccesibles
- [ ] **Estado:** pendiente · **Esfuerzo:** M
- **Problema:** gastos, cuentas por pagar/cobrar y reportes están comentados en rutas y menú,
  aunque las páginas, servicios y módulos backend existen y tienen pruebas; el README los
  documenta como disponibles.
- **Evidencia:** `frontend/src/app/app.routes.ts:107-134` y
  `frontend/src/app/layout/main-layout.component.ts:141-154`; páginas en
  `frontend/src/app/features/finance/` y `frontend/src/app/features/reports/`.
- **Decisión necesaria:** reactivar (con `roleGuard` para reportes y pruebas) o eliminar el
  código muerto y corregir el README.
- **Terminado cuando:** código y documentación coinciden.

### P2-3 · Huecos de pruebas en el frontend
- [ ] **Estado:** pendiente · **Esfuerzo:** M
- **Evidencia:** sin `*.spec.ts` en `frontend/src/app/features/auth/`,
  `features/dashboard/`, `features/finance/` ni `features/admin/`.
- **Acción propuesta:** specs de login/registro, dashboard y finanzas; pruebas e2e de
  navegador (Playwright) para los flujos críticos de POS y caja.
- **Terminado cuando:** los flujos de dinero tienen cobertura de integración.

### P2-4 · Accesibilidad y UX del POS
- [ ] **Estado:** pendiente · **Esfuerzo:** M
- **Acción propuesta:** foco atrapado y cierre con `Escape` en diálogos, `aria-live` en
  toasts, navegación completa por teclado, contraste revisado, virtual scroll para catálogos
  grandes, búsqueda con debounce y estados de carga con *skeletons*.
- **Terminado cuando:** el flujo de venta se puede completar solo con teclado.

### P2-5 · Locale del dominio
- [ ] **Estado:** pendiente · **Esfuerzo:** S
- **Evidencia:** `frontend/src/app/app.config.ts` registra `es-PE`, mientras el negocio es
  Venezuela (BCV, RIF, bolívares).
- **Acción propuesta:** usar `es-VE` y centralizar el formato de moneda/fecha.
- **Terminado cuando:** montos y fechas se muestran con el formato local correcto.

### P2-6 · Ciclo de vida de las imágenes
- [ ] **Estado:** pendiente · **Esfuerzo:** M
- **Problema:** la subida está bien validada (firma real, tamaño, ruta segura), pero no se
  borra la imagen anterior al reemplazarla ni se limpian huérfanos.
- **Evidencia:** `backend/src/common/media/image-storage.util.ts`.
- **Acción propuesta:** borrar el archivo anterior al cambiar foto/logo/comprobante y job
  periódico de limpieza; controlar cuota de disco.
- **Terminado cuando:** `backend/private/img` no crece indefinidamente.

### P2-7 · Rendimiento de consultas y reportes
- [ ] **Estado:** pendiente · **Esfuerzo:** M
- **Problema:** índices simples por `companyId`/`createdAt`; SQLite admite un solo escritor.
- **Acción propuesta:** revisar los planes de consulta con datos reales, añadir índices
  compuestos `(companyId, createdAt)` según uso y planificar PostgreSQL antes de crecer.
- **Terminado cuando:** reportes y listados mantienen tiempos aceptables con volumen real.

---

## P3 — DevEx y mantenimiento

### P3-1 · Integración continua
- [ ] **Estado:** pendiente · **Esfuerzo:** M
- **Acción propuesta:** GitHub Actions con `npm ci`, `prisma generate`, typecheck, lint,
  tests backend/frontend, build y `npm run audit:money`; caché de dependencias y artefactos.

### P3-2 · Contenedores y despliegue
- [ ] **Estado:** pendiente · **Esfuerzo:** M
- **Acción propuesta:** `docker-compose` con PostgreSQL + backend + frontend (nginx),
  healthchecks, variables por entorno y política de reinicio. Documentar el despliegue.

### P3-3 · Convenciones de repositorio
- [ ] **Estado:** pendiente · **Esfuerzo:** S
- **Problema:** el historial usa mensajes como `fix` / `fixes`.
- **Acción propuesta:** *Conventional Commits*, hooks `pre-commit` (husky + lint-staged),
  `CHANGELOG.md` y plantilla de PR con checklist de pruebas.

### P3-4 · Documentación y limpieza
- [ ] **Estado:** pendiente · **Esfuerzo:** S
- **Acción propuesta:**
  1. Corregir README: rutas de finanzas/reportes deshabilitadas, `test:e2e` roto, pasos
     reales a PostgreSQL y credenciales demo.
  2. ADRs para "dinero en centavos" y "cola persistente en BD".
  3. Rotar/purgar logs y backups locales (`backend/*.log`, `backend/_*.txt`,
     `backend/prisma/dev.backup-*.db`); ya están ignorados por git, pero ocupan espacio.
  4. Revisar que `.gitignore` raíz (`*.txt`) no termine ocultando documentación útil.

---

## Orden de ejecución sugerido

| Fase | Contenido | Duración estimada |
|------|-----------|-------------------|
| 1 | P0 completo (migraciones, configuración, demo, throttling, errores, backups) | 1-2 semanas |
| 2 | P1 completo (códigos, e2e, lint/CI, auditoría, sesión, observabilidad) | 1-2 semanas |
| 3 | P2 (refactor, decisión finanzas/reportes, tests de front, accesibilidad) | 2-3 semanas |
| 4 | P3 continuo (CI/CD avanzado, contenedores, convenciones, documentación) | continuo |

---

## Criterios globales de aceptación

- [ ] Cero hallazgos P0 abiertos.
- [ ] Esquema reproducible en staging solo con migraciones versionadas.
- [ ] CI en verde con lint + typecheck + unitarios + e2e.
- [ ] Backups automáticos con restauración probada.
- [ ] Login y OTP protegidos contra fuerza bruta.
- [ ] Build de producción sin credenciales demo.
- [ ] Documentación alineada con lo que realmente está disponible en la interfaz.

---

## Qué NO se va a cambiar

- La representación del dinero en centavos ni el codec de `PrismaService`: funciona y está
  cubierto por pruebas.
- El patrón repositorio ni la separación por módulos.
- No se parte el monolito en microservicios.
- No se reescribe el frontend: bastan extracciones, pruebas y ajustes puntuales.

---

## Registro de avances

| Fecha | Punto(s) | Nota |
|-------|----------|------|
| 2026-10-22 | — | Documento creado a partir del análisis inicial. Sin cambios de código. |
