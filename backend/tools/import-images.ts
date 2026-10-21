/**
 * MIGRACION DE IMAGENES A DISCO.
 *
 * Recorre las tablas que historicamente guardaban fotos como data URL (y las
 * que aun apuntan a una URL publica externa) y las escribe en
 * `private/img/<RIF sin espacios>/<carpeta>/`, reemplazando el valor de la fila
 * por la URL local `/media/...`.
 *
 *   - Empresas: logo       -> <rif>/logo
 *   - Productos: foto      -> <rif>/products
 *   - Menus: foto          -> <rif>/menu
 *   - Cobros: comprobante  -> <rif>/payments
 *   - Movimientos de caja  -> <rif>/payments
 *   - Usuarios: avatar     -> _users/<id>/avatars (cuenta global)
 *
 * Es idempotente: las filas que ya tienen una ruta `/media/...` se dejan
 * intactas. Se puede ejecutar varias veces sin duplicar imagenes.
 *
 * Uso:  npm run images:import
 */
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { isImageUrl } from '../src/common/media/image-url.util';
import {
  isDataImageUrl,
  MAX_IMAGE_BYTES,
  saveImageBuffer,
  saveImageFile,
  sanitizePathSegment,
  type ImageFolder,
} from '../src/common/media/image-storage.util';

dotenv.config({ path: resolve(__dirname, '..', '.env') });

const prisma = new PrismaClient();
const root =
  process.env.MEDIA_ROOT?.trim() || resolve(__dirname, '..', 'private', 'img');

let saved = 0;
let downloaded = 0;
let skipped = 0;
let errors = 0;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Descarga una imagen externa con un tope de tiempo y de tamano. */
async function downloadImage(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
    headers: { 'User-Agent': 'NexoHub/1.0 (+image-migration)' },
  });
  if (!response.ok) {
    throw new Error(`la URL respondio HTTP ${response.status}`);
  }

  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_IMAGE_BYTES) {
    throw new Error('la imagen externa supera los 8 MB');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new Error('la imagen externa supera los 8 MB');
  }
  return bytes;
}

/**
 * Lleva una imagen a disco y actualiza la fila con la URL local.
 *
 * - Data URL historico => se decodifica y se guarda.
 * - URL publica => se descarga y se guarda.
 * - Ruta `/media/...` o `null` => no hay nada que hacer.
 */
async function migrateImage(
  label: string,
  value: string | null | undefined,
  scopeSegments: string[],
  folder: ImageFolder,
  apply: (url: string) => Promise<unknown>,
): Promise<void> {
  if (!value) {
    skipped += 1;
    return;
  }
  if (isDataImageUrl(value)) {
    try {
      const stored = await saveImageFile(root, scopeSegments, folder, value);
      await apply(stored.url);
      saved += 1;
      console.log(`  OK  ${label} -> ${stored.url}`);
    } catch (error) {
      errors += 1;
      console.error(`  ERR ${label}: ${errorText(error)}`);
    }
    return;
  }
  if (!isImageUrl(value) || value.trim().startsWith('/media/')) {
    skipped += 1;
    return;
  }

  try {
    const bytes = await downloadImage(value.trim());
    const stored = await saveImageBuffer(root, scopeSegments, folder, bytes);
    await apply(stored.url);
    saved += 1;
    downloaded += 1;
    console.log(`  OK  ${label} (remota) -> ${stored.url}`);
  } catch (error) {
    errors += 1;
    console.error(`  ERR ${label}: ${errorText(error)}`);
  }
}

async function main(): Promise<void> {
  console.log(`Importando imagenes a ${root}\n`);

  const companies = await prisma.company.findMany({
    select: { id: true, name: true, rif: true, logoUrl: true },
    orderBy: { createdAt: 'asc' },
  });
  const scopeByCompany = new Map(
    companies.map((company) => [
      company.id,
      [sanitizePathSegment(company.rif, 'empresa')],
    ]),
  );
  const scopeOf = (companyId: string): string[] =>
    scopeByCompany.get(companyId) ?? ['empresa'];

  console.log('Empresas (logo):');
  for (const company of companies) {
    await migrateImage(
      `${company.name} (${company.rif})`,
      company.logoUrl,
      scopeOf(company.id),
      'logo',
      (logoUrl) => prisma.company.update({ where: { id: company.id }, data: { logoUrl } }),
    );
  }

  const products = await prisma.product.findMany({
    select: { id: true, companyId: true, name: true, imageUrl: true },
  });
  console.log(`\nProductos (${products.length}):`);
  for (const product of products) {
    await migrateImage(
      `${product.name} [${product.id}]`,
      product.imageUrl,
      scopeOf(product.companyId),
      'products',
      (imageUrl) => prisma.product.update({ where: { id: product.id }, data: { imageUrl } }),
    );
  }

  const menus = await prisma.menu.findMany({
    select: { id: true, companyId: true, name: true, imageUrl: true },
  });
  console.log(`\nMenus (${menus.length}):`);
  for (const menu of menus) {
    await migrateImage(
      `${menu.name} [${menu.id}]`,
      menu.imageUrl,
      scopeOf(menu.companyId),
      'menu',
      (imageUrl) => prisma.menu.update({ where: { id: menu.id }, data: { imageUrl } }),
    );
  }

  const orderPayments = await prisma.orderPayment.findMany({
    select: { id: true, companyId: true, paymentPhotoUrl: true },
  });
  console.log(`\nComprobantes de pedidos (${orderPayments.length}):`);
  for (const payment of orderPayments) {
    await migrateImage(
      `Cobro ${payment.id}`,
      payment.paymentPhotoUrl,
      scopeOf(payment.companyId),
      'payments',
      (paymentPhotoUrl) =>
        prisma.orderPayment.update({
          where: { id: payment.id },
          data: { paymentPhotoUrl },
        }),
    );
  }

  const cashMovements = await prisma.cashMovement.findMany({
    select: { id: true, companyId: true, paymentPhotoUrl: true },
  });
  console.log(`\nComprobantes de caja (${cashMovements.length}):`);
  for (const movement of cashMovements) {
    await migrateImage(
      `Movimiento ${movement.id}`,
      movement.paymentPhotoUrl,
      scopeOf(movement.companyId),
      'payments',
      (paymentPhotoUrl) =>
        prisma.cashMovement.update({
          where: { id: movement.id },
          data: { paymentPhotoUrl },
        }),
    );
  }

  const users = await prisma.user.findMany({
    select: { id: true, email: true, avatarUrl: true },
  });
  console.log(`\nAvatares de usuarios (${users.length}):`);
  for (const user of users) {
    await migrateImage(
      user.email,
      user.avatarUrl,
      ['_users', user.id],
      'avatars',
      (avatarUrl) => prisma.user.update({ where: { id: user.id }, data: { avatarUrl } }),
    );
  }

  console.log(
    `\nListo: ${saved} imagen(es) importada(s) (${downloaded} descargada(s) de Internet), ${skipped} sin cambios, ${errors} error(es).`,
  );
  if (errors > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error('La migracion fallo:', errorText(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
