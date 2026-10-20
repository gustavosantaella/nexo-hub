import { Module } from '@nestjs/common';
import { RatesModule } from '../rates/rates.module';
import { CashController } from './cash.controller';
import { CashRepository } from './cash.repository';
import { CashService } from './cash.service';

@Module({
  imports: [RatesModule],
  controllers: [CashController],
  providers: [CashService, CashRepository],
  // Se re-exporta RatesModule para que los modulos que ya dependen de la caja
  // (pedidos, gastos, cuentas) puedan convertir montos a la moneda base.
  exports: [CashService, RatesModule],
})
export class CashModule {}
