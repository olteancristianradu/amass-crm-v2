import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { OutlookEmailController } from './outlook-email.controller';
import { OutlookEmailService } from './outlook-email.service';

@Module({
  imports: [AuthModule, AccessControlModule],
  controllers: [OutlookEmailController],
  providers: [OutlookEmailService],
  exports: [OutlookEmailService],
})
export class OutlookEmailModule {}
