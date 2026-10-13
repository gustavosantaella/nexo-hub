import { Module } from '@nestjs/common';
import { CurrenciesModule } from '../currencies/currencies.module';
import { RatesController } from './rates.controller';
import { RatesService } from './rates.service';

@Module({
  imports: [CurrenciesModule],
  controllers: [RatesController],
  providers: [RatesService],
  exports: [RatesService],
})
export class RatesModule {}
