import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';

import { PrismaModule } from './core/prisma/prisma.module';
import { AuthModule } from './core/auth/auth.module';
import { JwtAuthGuard } from './core/auth/jwt-auth.guard';

import { InventoryModule } from './modules/inventory/inventory.module';
import { RepackModule } from './modules/repack/repack.module';
import { CustomersModule } from './modules/customers/customers.module';
import { FinanceModule } from './modules/finance/finance.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { LicensesModule } from './modules/licenses/licenses.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { HealthModule } from './modules/health/health.module';
import { DailyProductionModule } from './modules/daily-production/daily-production.module';
import { SimpleOrdersModule } from './modules/simple-orders/simple-orders.module';
import { TelegramModule } from './modules/telegram/telegram.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    InventoryModule,
    RepackModule,
    CustomersModule,
    FinanceModule,
    EmployeesModule,
    LicensesModule,
    DashboardModule,
    HealthModule,
    DailyProductionModule,
    SimpleOrdersModule,
    TelegramModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
