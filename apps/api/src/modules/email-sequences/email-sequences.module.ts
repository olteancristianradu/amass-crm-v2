import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';
import { EmailSequencesController } from './email-sequences.controller';
import { EmailSequencesScheduler } from './email-sequences.scheduler';
import { EmailSequencesService } from './email-sequences.service';

@Module({
  imports: [AuthModule, EmailModule],
  controllers: [EmailSequencesController],
  providers: [EmailSequencesService, EmailSequencesScheduler],
  exports: [EmailSequencesService],
})
export class EmailSequencesModule {}
