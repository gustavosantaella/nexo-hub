import { Module } from '@nestjs/common';
import { QueueRepository } from './queue.repository';
import { QueueService } from './queue.service';

/**
 * Cola persistente compartida por los modulos. `PrismaModule` es global, por lo
 * que aqui solo se registran el repositorio y el worker.
 */
@Module({
  providers: [QueueRepository, QueueService],
  exports: [QueueService],
})
export class QueueModule {}
