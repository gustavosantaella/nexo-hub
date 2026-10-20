import { Module } from '@nestjs/common';
import { RatesModule } from '../rates/rates.module';
import { MenuCategoriesController } from './menu-categories.controller';
import { MenuCategoriesRepository } from './menu-categories.repository';
import { MenuCategoriesService } from './menu-categories.service';
import { MenusController } from './menus.controller';
import { MenusRepository } from './menus.repository';
import { MenusService } from './menus.service';

/**
 * Menus (platos/combos) con su receta de ingredientes y sus categorias.
 * `MenusService` se exporta porque el modulo de pedidos lo usa para expandir la
 * receta y descontar el inventario al vender. `RatesModule` aporta la conversion
 * del precio cuando se carga en bolivares u otra moneda.
 */
@Module({
  imports: [RatesModule],
  controllers: [MenusController, MenuCategoriesController],
  providers: [
    MenusService,
    MenuCategoriesService,
    MenusRepository,
    MenuCategoriesRepository,
  ],
  exports: [MenusService, MenuCategoriesService],
})
export class MenusModule {}
