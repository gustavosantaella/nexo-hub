import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module';
import { InventoryModule } from '../inventory/inventory.module';
import { MenusModule } from '../menus/menus.module';
import { ProductsModule } from '../products/products.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { DataTransferController } from './data-transfer.controller';
import { DataTransferService } from './data-transfer.service';

/**
 * Exportacion / importacion del catalogo en un archivo JSON.
 *
 * Reusa los servicios de cada dominio (categorias, proveedores, productos,
 * menus e inventario) en vez de escribir en Prisma: importar un producto debe
 * pasar por las MISMAS reglas que crearlo a mano (validacion de moneda y tasa,
 * movimiento de inventario trazable, receta del menu, ...).
 */
@Module({
  imports: [
    CategoriesModule,
    SuppliersModule,
    ProductsModule,
    MenusModule,
    InventoryModule,
  ],
  controllers: [DataTransferController],
  providers: [DataTransferService],
  exports: [DataTransferService],
})
export class DataTransferModule {}
