import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ValidationRulesController } from './validation-rules.controller';
import { ValidationRulesService } from './validation-rules.service';

@Module({
  imports: [AuthModule],
  controllers: [ValidationRulesController],
  providers: [ValidationRulesService],
  exports: [ValidationRulesService],
})
export class ValidationRulesModule {}
