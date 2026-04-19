import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FormulaFieldsController } from './formula-fields.controller';
import { FormulaFieldsService } from './formula-fields.service';

@Module({
  imports: [AuthModule],
  controllers: [FormulaFieldsController],
  providers: [FormulaFieldsService],
  exports: [FormulaFieldsService],
})
export class FormulaFieldsModule {}
