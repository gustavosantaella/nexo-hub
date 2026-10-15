import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import configuration from './config/configuration';
import { AuthModule } from './modules/auth/auth.module';
import { CashModule } from './modules/cash/cash.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { CurrenciesModule } from './modules/currencies/currencies.module';
import { CustomersModule } from './modules/customers/customers.module';
import { DataTransferModule } from './modules/data-transfer/data-transfer.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { HealthModule } from './modules/health/health.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { MenusModule } from './modules/menus/menus.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PayablesModule } from './modules/payables/payables.module';
import { ProductsModule } from './modules/products/products.module';
import { RatesModule } from './modules/rates/rates.module';
import { ReceivablesModule } from './modules/receivables/receivables.module';
import { StatsModule } from './modules/stats/stats.module';
import { SuppliersModule } from './modules/suppliers/suppliers.module';
import { UsersModule } from './modules/users/users.module';
import { PrismaModule } from './prisma/prisma.module';

/**
 * Modulo raiz: agrupa configuracion, acceso a datos y modulos de dominio.
 * Los guards/proveedores globales se registran aqui (via APP_*) para que
 * funcionen tambien en los guards de modulo y en el contexto de DI.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      envFilePath: ['.env'],
    }),
    PrismaModule,
    HealthModule,
    AuthModule,
    UsersModule,
    CompaniesModule,
    CategoriesModule,
    SuppliersModule,
    CustomersModule,
    DataTransferModule,
    ProductsModule,
    CurrenciesModule,
    RatesModule,
    InventoryModule,
    MenusModule,
    OrdersModule,
    CashModule,
    ExpensesModule,
    PayablesModule,
    ReceivablesModule,
    StatsModule,
  ],
  providers: [
    // Orden importante: primero autentica, luego autoriza por rol.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule {}
