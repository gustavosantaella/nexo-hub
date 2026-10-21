/**
 * LIMPIEZA DE DATOS OPERATIVOS.
 *
 * Borra el historial de operacion (pedidos, cobros, caja, gastos, cuentas por
 * cobrar/pagar, movimientos de inventario y OTP de cancelacion) de TODAS las
 * empresas, conservando:
 *
 *   - Empresas, configuracion, preferencias y notificaciones/Telegram.
 *   - Usuarios y sus membresias (roles).
 *   - Catalogo: categorias, proveedores, clientes, productos, menus y recetas.
 *   - El STOCK ACTUAL de cada producto (`Product.stock` no se modifica).
 *
 * Uso:
 *
 *   npm run db:clear            # muestra lo que borraria, sin tocar la base
 *   npm run db:clear -- --yes   # borra y hace un respaldo .db antes
 */
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import { copyFileSync, existsSync } from 'fs';
import { basename, dirname, isAbsolute, resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '..', '.env') });

const prisma = new PrismaClient();
const confirmed = process.argv.includes('--yes');

interface CountRow {
  label: string;
  count: number;
}

function printRows(title: string, rows: CountRow[]): void {
  const width = Math.max(...rows.map((row) => row.label.length)) + 2;
  console.log(`\n${title}`);
  for (const row of rows) {
    console.log(`  ${row.label.padEnd(width)} ${row.count}`);
  }
}

/**
 * Copia la base SQLite antes de borrar. `DATABASE_URL=file:./dev.db` se
 * resuelve, igual que Prisma, relativo a la carpeta `prisma/`.
 */
function backupSqlite(): string | null {
  const url = process.env.DATABASE_URL ?? '';
  if (!url.startsWith('file:')) {
    console.log('\nSin respaldo automático: la base no es SQLite.');
    return null;
  }

  const file = url.slice('file:'.length).split('?')[0];
  const database = isAbsolute(file)
    ? file
    : resolve(__dirname, '..', 'prisma', file);

  if (!existsSync(database)) {
    throw new Error(`No se encontró la base de datos SQLite: ${database}`);
  }

  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+$/, '');
  const backup = resolve(
    dirname(database),
    `${basename(database, '.db')}.backup-${stamp}.db`,
  );
  copyFileSync(database, backup);
  return backup;
}

async function main(): Promise<void> {
  const before = await Promise.all([
    prisma.company.count(),
    prisma.user.count(),
    prisma.membership.count(),
    prisma.category.count(),
    prisma.supplier.count(),
    prisma.customer.count(),
    prisma.product.count(),
    prisma.menuCategory.count(),
    prisma.menu.count(),
    prisma.menuIngredient.count(),
    prisma.setting.count(),
    prisma.companyPreference.count(),
    prisma.notificationSetting.count(),
    prisma.cancellationOtp.count(),
    prisma.order.count(),
    prisma.orderItem.count(),
    prisma.orderPayment.count(),
    prisma.cashSession.count(),
    prisma.cashMovement.count(),
    prisma.stockMovement.count(),
    prisma.expense.count(),
    prisma.accountPayable.count(),
    prisma.payablePayment.count(),
    prisma.accountReceivable.count(),
    prisma.receivablePayment.count(),
    prisma.backgroundJob.count(),
  ]);

  const preserved: CountRow[] = [
    { label: 'Empresas', count: before[0] },
    { label: 'Usuarios', count: before[1] },
    { label: 'Membresías / roles', count: before[2] },
    { label: 'Categorías', count: before[3] },
    { label: 'Proveedores', count: before[4] },
    { label: 'Clientes', count: before[5] },
    { label: 'Productos', count: before[6] },
    { label: 'Categorías de menú', count: before[7] },
    { label: 'Menús', count: before[8] },
    { label: 'Ingredientes de recetas', count: before[9] },
    { label: 'Configuración', count: before[10] },
    { label: 'Preferencias', count: before[11] },
    { label: 'Configuración de notificaciones', count: before[12] },
  ];
  const doomed: CountRow[] = [
    { label: 'OTP de cancelación', count: before[13] },
    { label: 'Pedidos', count: before[14] },
    { label: 'Líneas de pedido', count: before[15] },
    { label: 'Pagos de pedidos', count: before[16] },
    { label: 'Sesiones de caja', count: before[17] },
    { label: 'Movimientos de caja', count: before[18] },
    { label: 'Movimientos de stock', count: before[19] },
    { label: 'Gastos', count: before[20] },
    { label: 'Cuentas por pagar', count: before[21] },
    { label: 'Pagos de cuentas por pagar', count: before[22] },
    { label: 'Cuentas por cobrar', count: before[23] },
    { label: 'Cobros de cuentas por cobrar', count: before[24] },
    { label: 'Trabajos en cola', count: before[25] },
  ];

  printRows('SE CONSERVARÁN', preserved);
  printRows('SE BORRARÁN (todas las empresas)', doomed);
  console.log('\nEl stock actual de los productos NO se modifica.');

  if (!confirmed) {
    console.log('\nModo seguro: no se borró nada.');
    console.log('Para ejecutar la limpieza: npm run db:clear -- --yes');
    return;
  }

  const backup = backupSqlite();
  if (backup) console.log(`\nRespaldo creado: ${backup}`);

  const deleted = await prisma.$transaction(
    async (tx) => {
      const counts: CountRow[] = [];
      const remove = async (
        label: string,
        action: Promise<{ count: number }>,
      ): Promise<void> => {
        counts.push({ label, count: (await action).count });
      };

      await remove('OTP de cancelación', tx.cancellationOtp.deleteMany());
      await remove('Trabajos en cola', tx.backgroundJob.deleteMany());
      await remove(
        'Cobros de cuentas por cobrar',
        tx.receivablePayment.deleteMany(),
      );
      await remove('Cuentas por cobrar', tx.accountReceivable.deleteMany());
      await remove(
        'Pagos de cuentas por pagar',
        tx.payablePayment.deleteMany(),
      );
      await remove('Cuentas por pagar', tx.accountPayable.deleteMany());
      await remove('Gastos', tx.expense.deleteMany());
      await remove('Pagos de pedidos', tx.orderPayment.deleteMany());
      await remove('Líneas de pedido', tx.orderItem.deleteMany());
      await remove('Movimientos de caja', tx.cashMovement.deleteMany());
      await remove('Pedidos', tx.order.deleteMany());
      await remove('Movimientos de stock', tx.stockMovement.deleteMany());
      await remove('Sesiones de caja', tx.cashSession.deleteMany());
      return counts;
    },
    { timeout: 120_000 },
  );

  printRows('BORRADO', deleted);
  console.log(
    '\nLimpieza completada. El catálogo, los usuarios y el stock siguen intactos.',
  );
}

main()
  .catch((error) => {
    console.error(
      `\nERROR: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

