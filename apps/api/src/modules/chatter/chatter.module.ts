import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChatterController } from './chatter.controller';
import { ChatterService } from './chatter.service';

@Module({
  imports: [AuthModule],
  controllers: [ChatterController],
  providers: [ChatterService],
  exports: [ChatterService],
})
export class ChatterModule {}
