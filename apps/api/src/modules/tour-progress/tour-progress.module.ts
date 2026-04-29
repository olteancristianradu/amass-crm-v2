import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { loadEnv } from '../../config/env';
import { parseTtlSeconds } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { TourProgressController } from './tour-progress.controller';
import { TourProgressService } from './tour-progress.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => {
        const env = loadEnv();
        return { secret: env.JWT_SECRET, signOptions: { expiresIn: parseTtlSeconds(env.JWT_ACCESS_TTL) } };
      },
    }),
  ],
  controllers: [TourProgressController],
  providers: [TourProgressService, JwtAuthGuard],
  exports: [TourProgressService],
})
export class TourProgressModule {}
