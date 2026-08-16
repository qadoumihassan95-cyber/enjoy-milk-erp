import { Module } from '@nestjs/common';
import { DailyProductionController } from './daily-production.controller';
import { DailyProductionService } from './daily-production.service';
import { FifoCostingService } from '../fifo/fifo.service';

@Module({
  controllers: [DailyProductionController],
  providers: [DailyProductionService, FifoCostingService],
  exports: [DailyProductionService],
})
export class DailyProductionModule {}
