import { Module } from '@nestjs/common';
import { CashModule } from '../cash/cash.module';
import { ReceivablesController } from './receivables.controller';
import { ReceivablesRepository } from './receivables.repository';
import { ReceivablesService } from './receivables.service';

@Module({
  imports: [CashModule],
  controllers: [ReceivablesController],
  providers: [ReceivablesService, ReceivablesRepository],
  exports: [ReceivablesService],
})
export class ReceivablesModule {}
