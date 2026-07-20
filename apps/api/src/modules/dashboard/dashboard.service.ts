import { Injectable } from '@nestjs/common';
import { InventoryService } from '../inventory/inventory.service';
import { FinanceService } from '../finance/finance.service';
import { EmployeesService } from '../employees/employees.service';
import { LicensesService } from '../licenses/licenses.service';
import { DailyProductionService } from '../daily-production/daily-production.service';

/**
 * Dashboard aggregation service.
 *
 * ⚠ Production numbers MUST come from DailyProductionService, not from
 * the legacy RepackService. A previous revision called
 * `repack.getDailySummary()` which reads the `RepackRun` table — that
 * table is empty in the current workflow (all production goes through
 * `DailyProduction`), so the Dashboard's "الإنتاج اليوم" card
 * permanently showed 0 while /production listed real records with
 * hundreds/thousands of units. This is the ONLY correct wire-up.
 *
 * If you need to add another module's production totals in the future,
 * add it to `DailyProductionService.getTodayProductionSummary` — never
 * fork the calculation here.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly inventory: InventoryService,
    private readonly production: DailyProductionService,
    private readonly finance: FinanceService,
    private readonly employees: EmployeesService,
    private readonly licenses: LicensesService,
  ) {}

  async getExecutiveSummary(tenantId: string) {
    const [inv, prod, fin, hr, lic] = await Promise.all([
      this.inventory.getSnapshot(tenantId),
      this.production.getTodayProductionSummary(tenantId),
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
