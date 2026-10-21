import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import {
  IMAGE_URL_MESSAGE,
  isDataImageUrl,
  isImageUrl,
} from './image-url.util';
import {
  defaultMediaRoot,
  InvalidImageError,
  mediaFilePath,
  saveImageBuffer,
  sanitizePathSegment,
  type ImageFolder,
  type StoredImage,
} from './image-storage.util';

/**
 * Guarda las imagenes del sistema en disco (`private/img`), nunca en la base.
 *
 * La carpeta padre es el RIF de la empresa sin espacios y adentro se separa por
 * tipo: `menu`, `products`, `logo` y `payments` (comprobantes de pago). Las
 * imagenes globales de usuario (avatar) van en `_users/<id>/avatars` porque no
 * pertenecen a una empresa concreta.
 *
 * El valor que se guarda en Prisma es una URL relativa `/media/...`; el
 * navegador la resuelve contra el mismo origen (proxy `/media` en desarrollo y
 * el gateway en produccion).
 */
@Injectable()
export class ImageStorageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Carpeta raiz configurable con `MEDIA_ROOT` (por defecto `private/img`). */
  get root(): string {
    return this.config.get<string>('media.root') || defaultMediaRoot();
  }

  /**
   * Normaliza la referencia de una imagen ya subida.
   *
   * - Cadena vacia/`null` => `null` (permite quitar la foto en un PATCH).
   * - URL local `/media/...` o URL publica heredada => se guarda tal cual.
   * - Data URL base64 => se rechaza: la imagen debe subirse por multipart.
   */
  async persist(
    _companyId: string,
    _folder: ImageFolder,
    value: string | null | undefined,
  ): Promise<string | null> {
    return this.normalizeStoredUrl(value);
  }

  /**
   * Normaliza el avatar de un usuario (misma regla que `persist`). La subida
   * real se hace con `saveUpload`, que agrupa el archivo en
   * `private/img/_users/<id>/avatars`.
   */
  async persistForOwner(
    _ownerId: string,
    _folder: ImageFolder,
    value: string | null | undefined,
  ): Promise<string | null> {
    return this.normalizeStoredUrl(value);
  }

  /**
   * Guarda en disco el archivo recibido por multipart.
   *
   * Las imagenes de una empresa van bajo su RIF (sin espacios); el avatar es
   * global y se agrupa por id de usuario (`_users/<id>/avatars`).
   */
  async saveUpload(
    companyId: string,
    userId: string,
    folder: ImageFolder,
    bytes: Buffer,
  ): Promise<StoredImage> {
    try {
      const scope =
        folder === 'avatars'
          ? ['_users', userId]
          : await this.companyScope(companyId);
      return await saveImageBuffer(path.resolve(this.root), scope, folder, bytes);
    } catch (error) {
      if (error instanceof InvalidImageError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  /** Ruta fisica de una URL `/media/...` (util para Telegram, etc.). */
  resolvePath(url: string): string | null {
    return mediaFilePath(this.root, url);
  }

  // ---------------------------------------------------------------- interno

  private async companyScope(companyId: string): Promise<string[]> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { rif: true },
    });
    if (!company) throw new NotFoundException('Empresa no encontrada');
    // El RIF es la carpeta padre, sin espacios (ej. `J-40123456-7`).
    return [sanitizePathSegment(company.rif, 'empresa')];
  }

  private normalizeStoredUrl(
    value: string | null | undefined,
  ): string | null {
    const trimmed = value?.trim();
    if (!trimmed) return null;

    if (isDataImageUrl(trimmed)) {
      throw new BadRequestException(
        'La imagen debe subirse como archivo (multipart), no como base64',
      );
    }
    if (!isImageUrl(trimmed)) {
      throw new BadRequestException(IMAGE_URL_MESSAGE);
    }
    return trimmed;
  }
}
