import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';

// AuthModule provides JwtService — required because the request-access
// endpoint now uses JwtAuthGuard (security fix RED1#4 / RED2#1).
@Module({
  imports: [AuthModule],
  controllers: [PortalController],
  providers: [PortalService],
  exports: [PortalService],
})
export class PortalModule {}
