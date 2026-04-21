import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { Request } from 'express';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthService } from './auth.service';
import { LoginDto, LoginSchema, RefreshDto, RefreshSchema, RegisterDto, RegisterSchema } from './dto';
import { JwtAuthGuard } from './jwt.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // Registration: 3 attempts/IP/15min (long window) + 5/min short burst (strict-auth).
  @Post('register')
  @Throttle({
    default: { ttl: 900_000, limit: 3 },
    'strict-auth': { ttl: 60_000, limit: 2 },
  })
  async register(@Body(new ZodValidationPipe(RegisterSchema)) dto: RegisterDto) {
    return this.auth.register(dto);
  }

  // Login: 5 attempts/IP/15min (brute-force defense) + 3/min short burst.
  @Post('login')
  @HttpCode(200)
  @Throttle({
    default: { ttl: 900_000, limit: 5 },
    'strict-auth': { ttl: 60_000, limit: 3 },
  })
  async login(@Body(new ZodValidationPipe(LoginSchema)) dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
  }

  // 20 refresh attempts per IP per minute
  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async refresh(@Body(new ZodValidationPipe(RefreshSchema)) dto: RefreshDto, @Req() req: Request) {
    return this.auth.refresh(dto, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
  }

  @Post('logout')
  @HttpCode(204)
  @SkipThrottle()
  @UseGuards(JwtAuthGuard)
  async logout(
    @Body(new ZodValidationPipe(RefreshSchema)) dto: RefreshDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.auth.logout(dto.refreshToken, user.jti, user.exp);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @SkipThrottle()
  async me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user.userId);
  }
}
