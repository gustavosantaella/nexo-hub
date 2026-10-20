import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { RatesModule } from '../rates/rates.module';
import { InventoryController } from './inventory.controller';
import { InventoryRepository } from './inventory.repository';
import { InventoryService } from './inventory.service';

@Module({
  imports: [RatesModule, NotificationsModule],
  controllers: [InventoryController],
  providers: [InventoryService, InventoryRepository],
  exports: [InventoryService],
})
export class InventoryModule {}
