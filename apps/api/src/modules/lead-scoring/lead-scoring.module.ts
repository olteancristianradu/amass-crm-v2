import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from '../auth/auth.module';
import { LeadScoringController } from './lead-scoring.controller';
import { LeadScoringService } from './lead-scoring.service';
import { LeadScoringProcessor } from './lead-scoring.processor';
import { QUEUE_LEAD_SCORING } from '../../infra/queue/queue.constants';

@Module({
  imports: [
    AuthModule,
    BullModule.registerQueue({ name: QUEUE_LEAD_SCORING }),
  ],
  controllers: [LeadScoringController],
  providers: [LeadScoringService, LeadScoringProcessor],
  exports: [LeadScoringService],
})
export class LeadScoringModule {}
