import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AnafController } from './anaf.controller';
import { AnafService } from './anaf.service';

@Module({
  imports: [AuthModule],
  controllers: [AnafController],
  providers: [AnafService],
  exports: [AnafService],
})
export class AnafModule {}
