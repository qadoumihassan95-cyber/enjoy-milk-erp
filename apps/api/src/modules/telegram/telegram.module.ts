import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { EmployeesModule } from '../employees/employees.module';
import { FinanceModule } from '../finance/finance.module';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';
import { TelegramAccountsService } from './telegram-accounts.service';
import { TelegramAccountsController } from './telegram-accounts.controller';

@Module({
  imports: [ConfigModule, PrismaModule, EmployeesModule, FinanceModule],
  controllers: [TelegramController, TelegramAccountsController],
  providers: [TelegramService, TelegramAccountsService],
  exports: [TelegramService, TelegramAccountsService],
})
export class TelegramModule {}
