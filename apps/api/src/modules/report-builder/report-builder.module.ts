import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReportBuilderController } from './report-builder.controller';
import { ReportBuilderService } from './report-builder.service';

@Module({
  imports: [AuthModule],
  controllers: [ReportBuilderController],
  providers: [ReportBuilderService],
  exports: [ReportBuilderService],
})
export class ReportBuilderModule {}
