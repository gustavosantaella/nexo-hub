import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';
import { TelegramService } from './telegram.service';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsRepository, TelegramService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
