import { Module } from '@nestjs/common';
import { DailyProductionController } from './daily-production.controller';
import { DailyProductionService } from './daily-production.service';

@Module({
  controllers: [DailyProductionController],
  providers: [DailyProductionService],
  exports: [DailyProductionService],
})
export class DailyProductionModule {}
