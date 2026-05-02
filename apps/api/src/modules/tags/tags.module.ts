import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';

@Module({
  imports: [PrismaModule, AuthModule, AccessControlModule],
  controllers: [TagsController],
  providers: [TagsService],
  exports: [TagsService],
})
export class TagsModule {}
