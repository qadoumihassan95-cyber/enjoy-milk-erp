import { Injectable } from '@nestjs/common';
import { InventoryService } from '../inventory/inventory.service';
import { RepackService } from '../repack/repack.service';
import { FinanceService } from '../finance/finance.service';
import { EmployeesService } from '../employees/employees.service';
import { LicensesService } from '../licenses/licenses.service';

@Injectable()
export class DashboardService {
  constructor(
    private readonly inventory: InventoryService,
    private readonly repack: RepackService,
    private readonly finance: FinanceService,
    private readonly employees: EmployeesService,
    private readonly licenses: LicensesService,
  ) {}

  async getExecutiveSummary(tenantId: string) {
    const [inv, prod, fin, hr, lic] = await Promise.all([
      this.inventory.getSnapshot(tenantId),
      this.repack.getDailySummary(tenantId),
      this.finance.getDailySummary(tenantId),
      this.employees.getDailyStats(tenantId),
      this.licenses.getStats(tenantId),
    ]);

    return {
      timestamp: new Date().toISOString(),
      inventory: inv,
      production: prod,
      finance: fin,
      hr,
      licenses: lic,
    };
  }
}
