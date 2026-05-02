import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Query,
  Post,
  Redirect,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { OutlookEmailService } from './outlook-email.service';
import { loadEnv } from '../../config/env';

function defaultRedirectUri(): string {
  return `${process.env['API_BASE_URL'] ?? 'http://localhost:3000'}/api/v1/outlook/callback`;
}

function frontendBase(): string {
  return loadEnv().CORS_ALLOWED_ORIGINS.split(',')[0] ?? 'http://localhost:5173';
}

const SendMessageSchema = z.object({
  to: z.array(z.string().email()).min(1),
  cc: z.array(z.string().email()).optional(),
  subject: z.string().min(1).max(998),
  bodyHtml: z.string().min(1).max(1_048_576),
  saveToSentItems: z.boolean().optional(),
});

@Controller('outlook')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OutlookEmailController {
  constructor(private readonly svc: OutlookEmailService) {}

  /** Step 1 — redirect user to Microsoft consent screen. */
  @Get('connect')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  @Redirect()
  async connect(@Query('redirectUri') redirectUri?: string) {
    const uri = redirectUri ?? defaultRedirectUri();
    const url = await this.svc.buildAuthUrl(uri);
    return { url, statusCode: 302 };
  }

  /** Step 2 — Microsoft redirects here with authorization code. */
  @Get('callback')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  @Redirect()
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('redirectUri') redirectUri?: string,
    @Query('error') error?: string,
  ) {
    if (error) {
      return { url: `${frontendBase()}/app/settings/email?outlook=error&reason=${encodeURIComponent(error)}`, statusCode: 302 };
    }
    const uri = redirectUri ?? defaultRedirectUri();
    await this.svc.handleCallback(code, state, uri);
    return { url: `${frontendBase()}/app/settings/email?outlook=connected`, statusCode: 302 };
  }

  @Get('status')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  status() {
    return this.svc.getStatus();
  }

  @Get('messages')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  messages(@Query('limit') limit?: string) {
    return this.svc.listMessages(limit ? parseInt(limit, 10) : 20);
  }

  @Post('messages/send')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  send(@Body(new ZodValidationPipe(SendMessageSchema)) dto: z.infer<typeof SendMessageSchema>) {
    return this.svc.sendMessage(dto);
  }

  @Delete('disconnect')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  disconnect() {
    return this.svc.disconnect();
  }
}
