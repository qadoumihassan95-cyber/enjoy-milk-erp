import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { InventoryService } from '../inventory/inventory.service';
import { RepackService } from '../repack/repack.service';
import { FinanceService } from '../finance/finance.service';
import { EmployeesService } from '../employees/employees.service';
import { LicensesService } from '../licenses/licenses.service';
import { DailyProductionService } from '../daily-production/daily-production.service';

@Module({
  controllers: [DashboardController],
  providers: [
    DashboardService,
    InventoryService,
    // RepackService is kept in the container for legacy /repack endpoints
    // that still use it, but the Dashboard no longer reads production
    // from it — DailyProductionService is now the sole source of truth.
    RepackService,
    FinanceService,
    EmployeesService,
    LicensesService,
    DailyProductionService,
  ],
})
export class DashboardModule {}
