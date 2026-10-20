import { Module } from '@nestjs/common';
import { CashModule } from '../cash/cash.module';
import { PayablesModule } from '../payables/payables.module';
import { ReceivablesModule } from '../receivables/receivables.module';
import { StatsController } from './stats.controller';
import { StatsRepository } from './stats.repository';
import { StatsService } from './stats.service';

@Module({
  imports: [CashModule, PayablesModule, ReceivablesModule],
  controllers: [StatsController],
  providers: [StatsService, StatsRepository],
  exports: [StatsService],
})
export class StatsModule {}
