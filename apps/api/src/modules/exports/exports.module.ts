import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from '../auth/auth.module';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';
import { ExportsProcessor } from './exports.processor';
import { QUEUE_EXPORT } from '../../infra/queue/queue.constants';

@Module({
  imports: [
    AuthModule,
    BullModule.registerQueue({ name: QUEUE_EXPORT }),
  ],
  controllers: [ExportsController],
  providers: [ExportsService, ExportsProcessor],
  exports: [ExportsService],
})
export class ExportsModule {}
