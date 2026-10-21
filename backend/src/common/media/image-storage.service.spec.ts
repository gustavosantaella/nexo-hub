import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { existsSync } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import type { PrismaService } from '../../prisma/prisma.service';
import { ImageStorageService } from './image-storage.service';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function createService(root: string, rif = 'J-40123456-7') {
  const prisma = {
    company: {
      findUnique: jest.fn(async () => ({ rif })),
    },
  } as unknown as PrismaService;
  const config = {
    get: jest.fn((key: string) => (key === 'media.root' ? root : undefined)),
  } as unknown as ConfigService;

  return { service: new ImageStorageService(prisma, config), prisma };
}

describe('ImageStorageService', () => {
  it('guarda un archivo multipart bajo el RIF de la empresa y devuelve /media', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nexo-media-'));
    try {
      const { service, prisma } = createService(root, 'J-40 123/45');

      const stored = await service.saveUpload(
        'company-1',
        'u1',
        'products',
        Buffer.from(PNG.split(',')[1], 'base64'),
      );

      expect(stored.url).toMatch(/^\/media\/J-40123-45\/products\/[^/]+\.png$/);
      expect(stored.bytes).toBeGreaterThan(0);
      const file = service.resolvePath(stored.url);
      expect(file).not.toBeNull();
      expect(existsSync(file!)).toBe(true);
      expect(prisma.company.findUnique).toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('guarda el avatar por usuario, sin depender de la empresa', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nexo-media-'));
    try {
      const { service, prisma } = createService(root);

      const stored = await service.saveUpload(
        'company-1',
        'user-9',
        'avatars',
        Buffer.from(PNG.split(',')[1], 'base64'),
      );

      expect(stored.url).toMatch(/^\/media\/_users\/user-9\/avatars\/[^/]+\.png$/);
      expect(prisma.company.findUnique).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('conserva una URL local ya guardada', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nexo-media-'));
    try {
      const { service, prisma } = createService(root);

      await expect(
        service.persist('company-1', 'menu', '/media/J-1/menu/foto.jpg'),
      ).resolves.toBe('/media/J-1/menu/foto.jpg');
      expect(prisma.company.findUnique).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('convierte una cadena vacia en null (permite quitar la foto)', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nexo-media-'));
    try {
      const { service } = createService(root);
      await expect(service.persist('company-1', 'logo', '   ')).resolves.toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rechaza un data URL: la imagen debe subirse por multipart', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nexo-media-'));
    try {
      const { service } = createService(root);
      await expect(
        service.persist('company-1', 'payments', PNG),
      ).rejects.toBeInstanceOf(BadRequestException);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rechaza contenido que no sea una imagen real', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nexo-media-'));
    try {
      const { service } = createService(root);
      await expect(
        service.saveUpload(
          'company-1',
          'u1',
          'payments',
          Buffer.from('no-es-una-imagen'),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
