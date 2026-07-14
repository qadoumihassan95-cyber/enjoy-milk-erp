import { Module } from '@nestjs/common';
import { SimpleOrdersController } from './simple-orders.controller';
import { SimpleOrdersService } from './simple-orders.service';
import { FifoModule } from '../fifo/fifo.module';

@Module({
  imports: [FifoModule],
  controllers: [SimpleOrdersController],
  providers: [SimpleOrdersService],
  exports: [SimpleOrdersService],
})
export class SimpleOrdersModule {}
