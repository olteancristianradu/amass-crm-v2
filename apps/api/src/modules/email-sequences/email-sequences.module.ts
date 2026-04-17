import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmailSequencesController } from './email-sequences.controller';
import { EmailSequencesService } from './email-sequences.service';

@Module({
  imports: [AuthModule],
  controllers: [EmailSequencesController],
  providers: [EmailSequencesService],
  exports: [EmailSequencesService],
})
export class EmailSequencesModule {}
