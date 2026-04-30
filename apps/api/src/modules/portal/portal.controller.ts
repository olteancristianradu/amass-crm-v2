import {
  Body, Controller, Get, Headers, HttpCode, Param, Post, Query, UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  RequestPortalAccessSchema, RequestPortalAccessDto,
  VerifyPortalTokenSchema, VerifyPortalTokenDto,
  SignQuotePortalSchema, SignQuotePortalDto,
} from '@amass/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PortalService } from './portal.service';

/**
 * Mostly public endpoints — auth via PortalToken. Exception: `request-access`
 * requires an authenticated tenant user (OWNER/ADMIN/MANAGER) because it
 * MINTS portal tokens and emailing them needs to be authorized.
 *
 * Pre-fix (RED1#4 / RED2#1): request-access was @Public() and accepted
 * arbitrary x-tenant-id + companyId in the body, returning the raw token —
 * an unauthenticated attacker could enumerate tenants and read invoices.
 *
 * tenantId for portal-token-protected endpoints is taken from the
 * X-Tenant-Id header (populated by TenantContextMiddleware via the tenant
 * slug in the subdomain, or passed explicitly from the FE).
 *
 * M-7: every handler has a per-IP @Throttle() because these endpoints are
 * discoverable and attractive for brute-forcing portal tokens / email
 * enumeration. Limits are intentionally tight — portal users only hit these
 * a handful of times per session.
 */
@Controller('portal')
export class PortalController {
  constructor(private readonly svc: PortalService) {}

  @Post('request-access')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN', 'MANAGER')
  // 30 requests / 15min / IP — looser than before because it's now authed.
  @Throttle({ default: { ttl: 900_000, limit: 30 } })
  requestAccess(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(RequestPortalAccessSchema)) dto: RequestPortalAccessDto,
  ) {
    return this.svc.requestAccess(user.tenantId, dto);
  }

  @Post('verify-token')
  @Public()
  @HttpCode(200)
  // 10 attempts / 5min / IP — portal tokens are 32-byte secrets, so any
  // brute-force at scale is infeasible; this cuts noise and CPU burn.
  @Throttle({ default: { ttl: 300_000, limit: 10 } })
  verifyToken(
    @Headers('x-tenant-id') tenantId: string,
    @Body(new ZodValidationPipe(VerifyPortalTokenSchema)) dto: VerifyPortalTokenDto,
  ) {
    return this.svc.verifyToken(tenantId, dto.token);
  }

  @Get('quotes')
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  listQuotes(
    @Headers('x-tenant-id') tenantId: string,
    @Query('token') token: string,
  ) {
    return this.svc.listQuotes(tenantId, token);
  }

  @Get('invoices')
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  listInvoices(
    @Headers('x-tenant-id') tenantId: string,
    @Query('token') token: string,
  ) {
    return this.svc.listInvoices(tenantId, token);
  }

  @Post('quotes/:id/sign')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { ttl: 300_000, limit: 5 } })
  signQuote(
    @Headers('x-tenant-id') tenantId: string,
    @Param('id') quoteId: string,
    @Query('token') token: string,
    @Body(new ZodValidationPipe(SignQuotePortalSchema)) dto: SignQuotePortalDto,
  ) {
    return this.svc.signQuote(tenantId, token, quoteId, dto);
  }
}
