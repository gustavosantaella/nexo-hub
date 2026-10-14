import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { RatesModule } from '../rates/rates.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [InventoryModule, RatesModule],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
