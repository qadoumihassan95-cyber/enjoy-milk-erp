import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import type { AuthenticatedUser } from '../../core/auth/jwt.strategy';
import { InventoryService } from './inventory.service';

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory')
export class InventoryController {
  constructor(private readonly service: InventoryService) {}

  // Items
  @Get('items')
  listItems(
    @CurrentUser() user: AuthenticatedUser,
    @Query('search') search?: string,
    @Query('type') type?: string,
  ) {
    return this.service.listItems(user.tenantId, { search, type });
  }

  @Get('items/:id')
  getItem(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.getItem(user.tenantId, id);
  }

  @Post('items')
  createItem(@CurrentUser() user: AuthenticatedUser, @Body() body: any) {
    return this.service.createItem(user.tenantId, body);
  }

  @Patch('items/:id')
  updateItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.service.updateItem(user.tenantId, id, body);
  }

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

  // Snapshot
  @Get('snapshot')
  snapshot(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getSnapshot(user.tenantId);
  }
}
