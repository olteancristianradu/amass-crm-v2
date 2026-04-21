import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { loadEnv } from '../../config/env';
import { AuthModule } from '../auth/auth.module';
import { SsoController } from './sso.controller';
import { SsoService } from './sso.service';

@Module({
  imports: [
    AuthModule,
    JwtModule.registerAsync({
      useFactory: () => {
        const env = loadEnv();
        return { secret: env.JWT_SECRET, signOptions: { expiresIn: env.JWT_ACCESS_TTL } };
      },
    }),
  ],
  controllers: [SsoController],
  providers: [SsoService],
})
export class SsoModule {}
