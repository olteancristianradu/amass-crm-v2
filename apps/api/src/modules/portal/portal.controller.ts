import {
  Body, Controller, Get, Headers, HttpCode, Param, Post, Query,
} from '@nestjs/common';
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
 */
@Controller('portal')
export class PortalController {
  constructor(private readonly svc: PortalService) {}

  @Post('request-access')
  requestAccess(
    @Headers('x-tenant-id') tenantId: string,
    @Body(new ZodValidationPipe(RequestPortalAccessSchema)) dto: RequestPortalAccessDto,
  ) {
    return this.svc.requestAccess(tenantId, dto);
  }

  @Post('verify-token')
  @HttpCode(200)
  verifyToken(
    @Headers('x-tenant-id') tenantId: string,
    @Body(new ZodValidationPipe(VerifyPortalTokenSchema)) dto: VerifyPortalTokenDto,
  ) {
    return this.svc.verifyToken(tenantId, dto.token);
  }

  @Get('quotes')
  listQuotes(
    @Headers('x-tenant-id') tenantId: string,
    @Query('token') token: string,
  ) {
    return this.svc.listQuotes(tenantId, token);
  }

  @Get('invoices')
  listInvoices(
    @Headers('x-tenant-id') tenantId: string,
    @Query('token') token: string,
  ) {
    return this.svc.listInvoices(tenantId, token);
  }

  @Post('quotes/:id/sign')
  @HttpCode(200)
  signQuote(
    @Headers('x-tenant-id') tenantId: string,
    @Param('id') quoteId: string,
    @Query('token') token: string,
    @Body(new ZodValidationPipe(SignQuotePortalSchema)) dto: SignQuotePortalDto,
  ) {
    return this.svc.signQuote(tenantId, token, quoteId, dto);
  }
}
