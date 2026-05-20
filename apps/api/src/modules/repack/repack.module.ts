import { Module } from '@nestjs/common';
import { RepackController } from './repack.controller';
import { RepackService } from './repack.service';

@Module({
  controllers: [RepackController],
  providers: [RepackService],
})
export class RepackModule {}
