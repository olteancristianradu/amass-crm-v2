import { Body, Controller, Get, HttpCode, Patch, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from './jwt.guard';
import { TotpService } from './totp.service';

const EnableSchema = z.object({ code: z.string().length(6) });
const DisableSchema = z.object({ password: z.string().min(1) });
const RegenerateBackupCodesSchema = z.object({ password: z.string().min(1) });

@Controller('auth/totp')
@UseGuards(JwtAuthGuard)
export class TotpController {
  constructor(private readonly totp: TotpService) {}

  /** Begin TOTP enrolment — returns QR data URL and temp secret. */
  @Post('setup')
  async setup(@CurrentUser() user: AuthenticatedUser) {
    return this.totp.beginSetup(user.userId, user.tenantId);
  }

  /** Confirm first code — activates TOTP + returns 10 backup codes (one-time view). */
  @Post('enable')
  @HttpCode(200)
  async enable(
    @Body(new ZodValidationPipe(EnableSchema)) body: { code: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const { backupCodes } = await this.totp.enable(user.userId, user.tenantId, body.code);
    return { message: '2FA enabled successfully', backupCodes };
  }

  /** Disable TOTP — requires current password. Using PATCH so a request body is standard. */
  @Patch('disable')
  @HttpCode(200)
  async disable(
    @Body(new ZodValidationPipe(DisableSchema)) body: { password: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.totp.disable(user.userId, user.tenantId, body.password);
    return { message: '2FA disabled' };
  }

  /**
   * B2-PR5: regenerate the 10-code backup list. Password-confirmed so a
   * stolen JWT can't silently rotate the user's recovery path.
   * Returns the new raw codes ONCE — operator must save them now.
   */
  @Post('backup-codes/regenerate')
  @HttpCode(200)
  async regenerateBackupCodes(
    @Body(new ZodValidationPipe(RegenerateBackupCodesSchema)) body: { password: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.totp.regenerateBackupCodes(user.userId, user.tenantId, body.password);
  }

  /** B2-PR5: how many backup codes still work (lets the FE warn at e.g. <=2). */
  @Get('backup-codes/remaining')
  async backupCodesRemaining(@CurrentUser() user: AuthenticatedUser) {
    return this.totp.backupCodesRemaining(user.userId, user.tenantId);
  }
}
