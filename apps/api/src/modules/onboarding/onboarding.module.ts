import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { loadEnv } from '../../config/env';
import { parseTtlSeconds } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => {
        const env = loadEnv();
        return { secret: env.JWT_SECRET, signOptions: { expiresIn: parseTtlSeconds(env.JWT_ACCESS_TTL) } };
      },
    }),
  ],
  controllers: [OnboardingController],
  providers: [OnboardingService, JwtAuthGuard],
  exports: [OnboardingService],
})
export class OnboardingModule {}
