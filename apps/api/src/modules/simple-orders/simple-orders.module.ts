import { Module } from '@nestjs/common';
import { SimpleOrdersController } from './simple-orders.controller';
import { SimpleOrdersService } from './simple-orders.service';

@Module({
  controllers: [SimpleOrdersController],
  providers: [SimpleOrdersService],
  exports: [SimpleOrdersService],
})
export class SimpleOrdersModule {}
