import { existsSync } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import {
  InvalidImageError,
  mediaFilePath,
  parseImageDataUrl,
  sanitizePathSegment,
  saveImageFile,
} from './image-storage.util';

/** PNG 1x1 valido (firma PNG + datos minimos). */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('image-storage.util', () => {
  it('acepta un data URL PNG valido y detecta su extension', () => {
    const parsed = parseImageDataUrl(PNG);
    expect(parsed?.mime).toBe('image/png');
    expect(parsed?.extension).toBe('png');
    expect(parsed?.bytes.length).toBeGreaterThan(0);
  });

  it('rechaza un archivo cuya firma no coincide con el MIME declarado', () => {
    const fakeJpeg = PNG.replace('image/png', 'image/jpeg');
    expect(parseImageDataUrl(fakeJpeg)).toBeNull();
  });

  it('usa el RIF sin espacios como carpeta segura', () => {
    expect(sanitizePathSegment(' J-40 123/45 ')).toBe('J-40123-45');
    expect(sanitizePathSegment('..')).toBe('empresa');
  });

  it('escribe la imagen en disco y devuelve una URL /media', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nexo-media-'));
    try {
      const stored = await saveImageFile(root, ['J-40123456-7'], 'menu', PNG);

      expect(stored.url).toMatch(
        /^\/media\/J-40123456-7\/menu\/[0-9]+-[a-f0-9]+\.png$/,
      );
      expect(existsSync(stored.absolutePath)).toBe(true);
      expect(mediaFilePath(root, stored.url)).toBe(stored.absolutePath);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('no permite salir de la carpeta de imagenes con una URL manipulada', () => {
    const root = path.join(tmpdir(), 'nexo-media-root');
    expect(mediaFilePath(root, '/media/../../secreto.jpg')).toBeNull();
    expect(mediaFilePath(root, '/media/%2e%2e/secreto.jpg')).toBeNull();
  });

  it('lanza un error de imagen invalida para contenido que no es imagen', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nexo-media-'));
    try {
      await expect(
        saveImageFile(
          root,
          ['J-1'],
          'products',
          'data:image/png;base64,bm8tZXMtdW5hLWltYWdlbg==',
        ),
      ).rejects.toBeInstanceOf(InvalidImageError);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
