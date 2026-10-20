import { Module } from '@nestjs/common';
import { CashModule } from '../cash/cash.module';
import { PayablesController } from './payables.controller';
import { PayablesRepository } from './payables.repository';
import { PayablesService } from './payables.service';

@Module({
  imports: [CashModule],
  controllers: [PayablesController],
  providers: [PayablesService, PayablesRepository],
  exports: [PayablesService],
})
export class PayablesModule {}
