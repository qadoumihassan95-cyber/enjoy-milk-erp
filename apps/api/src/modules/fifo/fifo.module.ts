import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { FifoController } from './fifo.controller';
import { FifoCostingService } from './fifo.service';

@Module({
  imports: [PrismaModule],
  controllers: [FifoController],
  providers: [FifoCostingService],
  exports: [FifoCostingService],
})
export class FifoModule {}
