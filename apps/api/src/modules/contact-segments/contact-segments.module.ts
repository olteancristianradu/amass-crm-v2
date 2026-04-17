import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ContactSegmentsController } from './contact-segments.controller';
import { ContactSegmentsService } from './contact-segments.service';

@Module({
  imports: [AuthModule],
  controllers: [ContactSegmentsController],
  providers: [ContactSegmentsService],
  exports: [ContactSegmentsService],
})
export class ContactSegmentsModule {}
