import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { loadEnv } from '../../config/env';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthService, AuthTokens } from './auth.service';
import {
  ConfirmEmailVerificationDto,
  ConfirmEmailVerificationSchema,
  ConfirmPasswordResetDto,
  ConfirmPasswordResetSchema,
  LoginDto,
  LoginSchema,
  RefreshDto,
  RefreshSchema,
  RegisterDto,
  RegisterSchema,
  RequestPasswordResetDto,
  RequestPasswordResetSchema,
} from './dto';
import { EmailVerificationService } from './email-verification.service';
import { JwtAuthGuard } from './jwt.guard';
import { PasswordResetService } from './password-reset.service';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './refresh-cookie';

@Controller('auth')
export class AuthController {
  private readonly env = loadEnv();
  private readonly isProd = this.env.NODE_ENV === 'production';

  constructor(
    private readonly auth: AuthService,
    private readonly passwordReset: PasswordResetService,
    private readonly emailVerification: EmailVerificationService,
  ) {}

  /**
   * M-10 — mint the refresh token to an httpOnly cookie and STRIP it from
   * the JSON body so it never touches localStorage. Old clients that read
   * `tokens.refreshToken` from the response will now see an empty string;
   * they can continue using the server via the cookie until they upgrade
   * (the browser sends the cookie automatically on /auth/refresh).
   */
  private commitTokensToCookie(res: Response, tokens: AuthTokens): AuthTokens {
    // Refresh TTL matches auth.service (7 days). Keep the two places in sync
    // if you ever bump the session lifetime.
    const sevenDays = 7 * 24 * 60 * 60;
    setRefreshCookie(res, tokens.refreshToken, sevenDays, this.isProd);
    return { ...tokens, refreshToken: '' };
  }

  // Registration: 3 attempts/IP/15min (long window) + 5/min short burst (strict-auth).
  @Post('register')
  @Public()
  @Throttle({
    default: { ttl: 900_000, limit: 3 },
    'strict-auth': { ttl: 60_000, limit: 2 },
  })
  async register(
    @Body(new ZodValidationPipe(RegisterSchema)) dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.register(dto);
    return { ...result, tokens: this.commitTokensToCookie(res, result.tokens) };
  }

  // Login: 5 attempts/IP/15min (brute-force defense) + 3/min short burst.
  @Post('login')
  @Public()
  @HttpCode(200)
  @Throttle({
    default: { ttl: 900_000, limit: 5 },
    'strict-auth': { ttl: 60_000, limit: 3 },
  })
  async login(
    @Body(new ZodValidationPipe(LoginSchema)) dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(dto, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
    return { ...result, tokens: this.commitTokensToCookie(res, result.tokens) };
  }

  // 20 refresh attempts per IP per minute
  @Post('refresh')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() rawBody: unknown,
  ) {
    // Prefer the httpOnly cookie; fall back to the legacy JSON body so
    // older clients and the e2e suite keep working during rollout.
    const cookieToken = readRefreshCookie(req);
    let refreshToken = cookieToken ?? '';
    if (!refreshToken) {
      const parsed = RefreshSchema.safeParse(rawBody);
      if (!parsed.success) {
        throw new BadRequestException({ code: 'REFRESH_MISSING', message: 'Refresh token missing' });
      }
      refreshToken = parsed.data.refreshToken;
    }
    const result = await this.auth.refresh({ refreshToken } as RefreshDto, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
    return { ...result, tokens: this.commitTokensToCookie(res, result.tokens) };
  }

  @Post('logout')
  @HttpCode(204)
  @SkipThrottle()
  @UseGuards(JwtAuthGuard)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() rawBody: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    const cookieToken = readRefreshCookie(req);
    const bodyParsed = RefreshSchema.safeParse(rawBody);
    const refreshToken = cookieToken ?? (bodyParsed.success ? bodyParsed.data.refreshToken : '');
    if (refreshToken) {
      await this.auth.logout(refreshToken, user.jti, user.exp);
    } else {
      // Access-token-only revocation — still valid; they just lost the
      // cookie. Clear the blocklist entry anyway.
      await this.auth.logout('', user.jti, user.exp);
    }
    clearRefreshCookie(res, this.isProd);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @SkipThrottle()
  async me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user.userId);
  }

  /**
   * Password reset — REQUEST. Always returns 204 regardless of whether the
   * email exists, so an attacker cannot probe the user database.
   */
  @Post('password-reset/request')
  @Public()
  @HttpCode(204)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async requestPasswordReset(
    @Body(new ZodValidationPipe(RequestPasswordResetSchema)) dto: RequestPasswordResetDto,
    @Req() req: Request,
  ): Promise<void> {
    const ipAddress = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.ip;
    const { resetUrl } = await this.passwordReset.request(dto.email, dto.tenantSlug, ipAddress);
    // In production the raw token is only sent via email — never surfaced.
    // In dev we return it on the header for manual testing.
    if (!this.isProd && resetUrl) {
      // Visible in the response header so devs can copy/paste the token.
      // Not surfaced in production builds.
      // eslint-disable-next-line no-console
      console.log(`[DEV] password reset token for ${dto.email}: ${resetUrl}`);
    }
  }

  /** Password reset — CONFIRM. Consumes token + rotates password + revokes sessions. */
  @Post('password-reset/confirm')
  @Public()
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async confirmPasswordReset(
    @Body(new ZodValidationPipe(ConfirmPasswordResetSchema)) dto: ConfirmPasswordResetDto,
  ): Promise<void> {
    await this.passwordReset.confirm(dto.token, dto.newPassword);
  }

  /** Email verification — CONFIRM. Sets User.emailVerifiedAt atomically. */
  @Post('email/verify')
  @Public()
  @HttpCode(204)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async verifyEmail(
    @Body(new ZodValidationPipe(ConfirmEmailVerificationSchema)) dto: ConfirmEmailVerificationDto,
  ): Promise<void> {
    await this.emailVerification.confirm(dto.token);
  }
}
