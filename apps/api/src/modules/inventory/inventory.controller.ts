import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { Roles } from '../../core/auth/roles.decorator';
import type { AuthenticatedUser } from '../../core/auth/jwt.strategy';
import { InventoryService } from './inventory.service';

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory')
export class InventoryController {
  constructor(private readonly service: InventoryService) {}

  // ─── Dashboard + Alerts ──────────────────────────
  @Get('dashboard')
  dashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getDashboard(user.tenantId);
  }

  @Get('alerts')
  alerts(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getAlerts(user.tenantId);
  }

  // Items
  @Get('items')
  listItems(
    @CurrentUser() user: AuthenticatedUser,
    @Query('search') search?: string,
    @Query('type') type?: string,
  ) {
    return this.service.listItems(user.tenantId, { search, type });
  }

  /** قائمة مُصفَّحة مع pagination — تدعم limit/offset */
  @Get('items/paginated')
  listItemsPaginated(
    @CurrentUser() user: AuthenticatedUser,
    @Query('search') search?: string,
    @Query('type') type?: string,
    @Query('barcode') barcode?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.service.listItemsPaginated(user.tenantId, {
      search, type, barcode,
      limit: limit ? +limit : undefined,
      offset: offset ? +offset : undefined,
    });
  }

  /** بحث بالباركود (Scan endpoint) */
  @Get('items/barcode/:code')
  findByBarcode(
    @CurrentUser() user: AuthenticatedUser,
    @Param('code') code: string,
  ) {
    return this.service.findByBarcode(user.tenantId, code);
  }

  /** FEFO helper — يقترح الدُفعات للاستهلاك بأولوية أقرب انتهاء */
  @Get('items/:id/fefo')
  suggestFefo(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('warehouseId') warehouseId: string,
    @Query('quantity') quantity: string,
  ) {
    return this.service.suggestFEFO(user.tenantId, id, warehouseId, +quantity);
  }

  @Get('items/:id')
  getItem(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.getItem(user.tenantId, id);
  }

  @Get('items/:id/analytics')
  itemAnalytics(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.getItemAnalytics(user.tenantId, id);
  }

  @Get('items/:id/movements')
  itemMovements(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getItemMovements(user.tenantId, id, limit ? +limit : 100);
  }

  @Patch('items/:id/settings')
  updateItemSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.service.updateItemSettings(user.tenantId, id, body);
  }

  @Roles('MANAGER', 'STAFF')  // إدارة المخزون + الموظف المُخوَّل
  @Post('items')
  createItem(@CurrentUser() user: AuthenticatedUser, @Body() body: any) {
    return this.service.createItem(user.tenantId, body);
  }

  @Roles('MANAGER', 'STAFF')
  @Patch('items/:id')
  updateItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.service.updateItem(user.tenantId, id, body);
  }

  @Roles('MANAGER')
  @Delete('items/:id')
  deleteItem(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.deleteItem(user.tenantId, id);
  }

  // Warehouses
  @Get('warehouses')
  listWarehouses(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listWarehouses(user.tenantId);
  }

  @Post('warehouses')
  createWarehouse(@CurrentUser() user: AuthenticatedUser, @Body() body: any) {
    return this.service.createWarehouse(user.tenantId, body);
  }

  // Movements
  @Post('movements')
  createMovement(@CurrentUser() user: AuthenticatedUser, @Body() body: any) {
    return this.service.createMovement(user.tenantId, user.id, body);
  }

  @Get('movements')
  listMovements(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limit?: string,
  ) {
    return this.service.listMovements(user.tenantId, {
      limit: limit ? +limit : 50,
    });
  }

  // Snapshot (backward compat)
  @Get('snapshot')
  snapshot(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getSnapshot(user.tenantId);
  }

  // ─── Stock Adjustment (تعديل مخزون يدوي) ─────────
  @Post('adjust')
  adjust(@CurrentUser() user: AuthenticatedUser, @Body() body: any) {
    return this.service.adjustStock(user.tenantId, user.id, body);
  }

  // ─── Stock Receipt (استلام) ─────────────────────
  @Post('receive')
  receive(@CurrentUser() user: AuthenticatedUser, @Body() body: any) {
    return this.service.receiveStock(user.tenantId, user.id, body);
  }

  // ─── Suppliers ───────────────────────────────────
  @Get('suppliers')
  listSuppliers(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listSuppliers(user.tenantId);
  }

  @Post('suppliers')
  createSupplier(@CurrentUser() user: AuthenticatedUser, @Body() body: any) {
    return this.service.createSupplier(user.tenantId, body);
  }

  @Patch('suppliers/:id')
  updateSupplier(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.service.updateSupplier(user.tenantId, id, body);
  }

  @Delete('suppliers/:id')
  deleteSupplier(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.deleteSupplier(user.tenantId, id);
  }

  // ─── Transfers ───────────────────────────────────
  @Get('transfers')
  listTransfers(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
  ) {
    return this.service.listTransfers(user.tenantId, { status });
  }

  @Post('transfers')
  createTransfer(@CurrentUser() user: AuthenticatedUser, @Body() body: any) {
    return this.service.createTransfer(user.tenantId, user.id, body);
  }

  @Roles('MANAGER')
  @Post('transfers/:id/approve')
  approveTransfer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.service.approveTransfer(user.tenantId, user.id, id);
  }

  @Roles('MANAGER')
  @Post('transfers/:id/reject')
  rejectTransfer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.service.rejectTransfer(user.tenantId, user.id, id, body?.reason);
  }

  @Post('transfers/:id/cancel')
  cancelTransfer(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.cancelTransfer(user.tenantId, id);
  }

  // ─── Inventory Counts (الجرد) ──────────────────
  @Get('counts')
  listCounts(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
  ) {
    return this.service.listCounts(user.tenantId, { status });
  }

  @Get('counts/:id')
  getCount(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.getCount(user.tenantId, id);
  }

  @Post('counts')
  createCount(@CurrentUser() user: AuthenticatedUser, @Body() body: any) {
    return this.service.createCount(user.tenantId, user.id, body);
  }

  @Patch('counts/lines/:lineId')
  updateCountLine(
    @CurrentUser() user: AuthenticatedUser,
    @Param('lineId') lineId: string,
    @Body() body: { actualQty?: number; notes?: string },
  ) {
    return this.service.updateCountLine(user.tenantId, lineId, user.id, body);
  }

  @Roles('MANAGER')
  @Post('counts/:id/close')
  closeCount(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.closeCount(user.tenantId, user.id, id);
  }

  @Post('counts/:id/cancel')
  cancelCount(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.cancelCount(user.tenantId, id);
  }

  // ─── CSV Reports ───────────────────────────────
  @Get('reports/stock-value.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="stock-value.csv"')
  reportStockValueCsv(@CurrentUser() user: AuthenticatedUser) {
    return this.service.reportStockValueCsv(user.tenantId);
  }

  @Get('reports/movement.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="movement.csv"')
  reportMovementCsv(
    @CurrentUser() user: AuthenticatedUser,
    @Query('days') days?: string,
  ) {
    return this.service.reportMovementCsv(user.tenantId, days ? +days : 30);
  }

  @Get('reports/low-stock.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="low-stock.csv"')
  reportLowStockCsv(@CurrentUser() user: AuthenticatedUser) {
    return this.service.reportLowStockCsv(user.tenantId);
  }

  @Get('reports/dead-stock.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="dead-stock.csv"')
  reportDeadStockCsv(@CurrentUser() user: AuthenticatedUser) {
    return this.service.reportDeadStockCsv(user.tenantId);
  }

  // ─── Bulk + Import ─────────────────────────────
  @Roles('MANAGER')
  @Post('items/bulk-activate')
  bulkActivate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { ids: string[] },
  ) {
    return this.service.bulkActivateItems(user.tenantId, body?.ids ?? []);
  }

  @Roles('MANAGER')
  @Post('items/bulk-deactivate')
  bulkDeactivate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { ids: string[] },
  ) {
    return this.service.bulkDeactivateItems(user.tenantId, body?.ids ?? []);
  }

  @Roles('MANAGER')
  @Post('items/import')
  importItems(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { rows: any[]; dryRun?: boolean },
  ) {
    return this.service.importItems(user.tenantId, body?.rows ?? [], {
      dryRun: !!body?.dryRun,
    });
  }
}
