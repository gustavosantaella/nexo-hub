import { Module } from '@nestjs/common';
import { CashModule } from '../cash/cash.module';
import { InventoryModule } from '../inventory/inventory.module';
import { MenusModule } from '../menus/menus.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { QueueModule } from '../queue/queue.module';
import { OrderJobsProcessor } from './order-jobs.processor';
import { OrdersController } from './orders.controller';
import { OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';

@Module({
  imports: [
    InventoryModule,
    CashModule,
    MenusModule,
    NotificationsModule,
    QueueModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersRepository, OrderJobsProcessor],
  exports: [OrdersService],
})
export class OrdersModule {}
