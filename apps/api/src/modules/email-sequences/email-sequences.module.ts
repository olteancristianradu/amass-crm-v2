import { Module } from '@nestjs/common';
import { EmailSequencesController } from './email-sequences.controller';
import { EmailSequencesService } from './email-sequences.service';

@Module({
  controllers: [EmailSequencesController],
  providers: [EmailSequencesService],
  exports: [EmailSequencesService],
})
export class EmailSequencesModule {}
