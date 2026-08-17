import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { StockReconciliationService } from './stock-reconciliation.service';

@Module({
  controllers: [InventoryController],
  providers: [InventoryService, StockReconciliationService],
  exports: [InventoryService, StockReconciliationService],
})
export class InventoryModule {}
