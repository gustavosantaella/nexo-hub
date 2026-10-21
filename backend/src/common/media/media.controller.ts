import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../decorators/current-user.decorator';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import {
  IMAGE_FOLDERS,
  MAX_IMAGE_BYTES,
  type ImageFolder,
} from './image-storage.util';
import { ImageStorageService } from './image-storage.service';

/** Forma minima del archivo que entrega Multer en memoria. */
interface UploadedImageFile {
  buffer: Buffer;
  size: number;
  mimetype: string;
  originalname: string;
}

/** `true` si el texto es una carpeta permitida. */
function isImageFolder(value: unknown): value is ImageFolder {
  return (
    typeof value === 'string' &&
    (IMAGE_FOLDERS as readonly string[]).includes(value)
  );
}

/**
 * Subida de imagenes por multipart.
 *
 * El navegador envia el archivo en el campo `file` y el destino en `folder`.
 * La respuesta trae la URL local (`/media/...`) que debe guardarse en la fila.
 * Los formularios de productos, menus, empresa y comprobantes de pago usan este
 * mismo endpoint.
 */
@ApiTags('Medios')
@ApiBearerAuth()
@Controller('media')
export class MediaController {
  constructor(private readonly images: ImageStorageService) {}

  @Post('upload')
  @ApiOperation({ summary: 'Subir una imagen (multipart/form-data)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'folder'],
      properties: {
        file: { type: 'string', format: 'binary' },
        folder: { type: 'string', enum: [...IMAGE_FOLDERS] },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
    }),
  )
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: UploadedImageFile | undefined,
    @Body('folder') folder: string,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Debes adjuntar una imagen');
    }
    if (!isImageFolder(folder)) {
      throw new BadRequestException('La carpeta de la imagen no es valida');
    }

    const stored = await this.images.saveUpload(
      user.companyId,
      user.id,
      folder,
      file.buffer,
    );
    return { url: stored.url, bytes: stored.bytes };
  }
}
