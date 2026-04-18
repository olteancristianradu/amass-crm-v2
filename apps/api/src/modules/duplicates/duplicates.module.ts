import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DuplicatesController } from './duplicates.controller';
import { DuplicatesService } from './duplicates.service';

@Module({
  imports: [AuthModule],
  controllers: [DuplicatesController],
  providers: [DuplicatesService],
})
export class DuplicatesModule {}
