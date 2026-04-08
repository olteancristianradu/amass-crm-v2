import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QueueModule } from '../../infra/queue/queue.module';
import { ImporterController } from './importer.controller';
import { ImporterService } from './importer.service';
import { ImportProcessor } from './import.processor';

@Module({
  imports: [AuthModule, QueueModule],
  controllers: [ImporterController],
  providers: [ImporterService, ImportProcessor],
})
export class ImporterModule {}
