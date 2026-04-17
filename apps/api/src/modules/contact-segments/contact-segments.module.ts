import { Module } from '@nestjs/common';
import { ContactSegmentsController } from './contact-segments.controller';
import { ContactSegmentsService } from './contact-segments.service';

@Module({
  controllers: [ContactSegmentsController],
  providers: [ContactSegmentsService],
  exports: [ContactSegmentsService],
})
export class ContactSegmentsModule {}
