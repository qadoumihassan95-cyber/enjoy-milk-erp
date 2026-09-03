import { Module } from '@nestjs/common';
import { AuditModule } from '../../core/audit/audit.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { StockReconciliationService } from './stock-reconciliation.service';

@Module({
  imports: [AuditModule],
  controllers: [InventoryController],
  providers: [InventoryService, StockReconciliationService],
  exports: [InventoryService, StockReconciliationService],
})
export class InventoryModule {}
