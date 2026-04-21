import {
  Body, Controller, Get, Headers, HttpCode, Param, Post, Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  RequestPortalAccessSchema, RequestPortalAccessDto,
  VerifyPortalTokenSchema, VerifyPortalTokenDto,
  SignQuotePortalSchema, SignQuotePortalDto,
} from '@amass/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PortalService } from './portal.service';

/**
 * Public endpoints — no JWT guard. Authentication is via PortalToken.
 * tenantId is taken from the X-Tenant-Id header (populated by TenantContextMiddleware
 * via the tenant slug in the subdomain, or passed explicitly from the FE).
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
  // 5 requests / 15min / IP — stops email enumeration + mailbombing.
  @Throttle({ default: { ttl: 900_000, limit: 5 } })
  requestAccess(
    @Headers('x-tenant-id') tenantId: string,
    @Body(new ZodValidationPipe(RequestPortalAccessSchema)) dto: RequestPortalAccessDto,
  ) {
    return this.svc.requestAccess(tenantId, dto);
  }

  @Post('verify-token')
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
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  listQuotes(
    @Headers('x-tenant-id') tenantId: string,
    @Query('token') token: string,
  ) {
    return this.svc.listQuotes(tenantId, token);
  }

  @Get('invoices')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  listInvoices(
    @Headers('x-tenant-id') tenantId: string,
    @Query('token') token: string,
  ) {
    return this.svc.listInvoices(tenantId, token);
  }

  @Post('quotes/:id/sign')
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
