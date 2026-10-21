import { Global, Module } from '@nestjs/common';
import { ImageStorageService } from './image-storage.service';
import { MediaController } from './media.controller';

/**
 * Modulo global de medios: cualquier servicio de dominio puede inyectar
 * `ImageStorageService` sin importar el modulo explicitamente. Tambien expone
 * `POST /api/media/upload` para subir imagenes por multipart.
 */
@Global()
@Module({
  controllers: [MediaController],
  providers: [ImageStorageService],
  exports: [ImageStorageService],
})
export class MediaModule {}
