import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { InventoryService } from '../inventory/inventory.service';
import { RepackService } from '../repack/repack.service';
import { FinanceService } from '../finance/finance.service';
import { EmployeesService } from '../employees/employees.service';
import { LicensesService } from '../licenses/licenses.service';

@Module({
  controllers: [DashboardController],
  providers: [
    DashboardService,
    InventoryService,
    RepackService,
    FinanceService,
    EmployeesService,
    LicensesService,
  ],
})
export class DashboardModule {}
