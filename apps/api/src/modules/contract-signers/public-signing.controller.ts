import {
  Body,
  Controller,
  Get,
  HttpCode,
  Headers,
  Ip,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { DeclineSignatureSchema, SubmitSignatureSchema } from '@amass/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Public } from '../../common/decorators/public.decorator';
import { EsignEnabledGuard } from './esign-enabled.guard';
import { CeremonyService } from './ceremony.service';
import { SigningService } from './signing.service';

/**
 * Phase 2 F1 — counterparty-facing ceremony endpoints. No JWT — the
 * 64-hex ceremonyToken IS the auth (HMAC-bound to a specific
 * ContractSignature row id).
 *
 * Defenses on every handler:
 *  - @Public() so the global JWT guard lets the request through.
 *  - EsignEnabledGuard before everything else — if the feature is off,
 *    503 before we even read the token.
 *  - Per-IP throttle: signing widget hits view once per page load, sign
 *    once per decision. Anything more is a brute-force probe.
 *
 * Mounted under /p/sign so the public surface is grep-able in the FE
 * router and in WAF/Caddy rules (only /p/* is exempt from CSRF).
 */
@Controller('p/sign')
@UseGuards(EsignEnabledGuard)
export class PublicSigningController {
  constructor(
    private readonly ceremony: CeremonyService,
    private readonly signing: SigningService,
  ) {}

  /**
   * GET /p/sign/:token — counterparty fetches the ceremony view.
   * Returns a fresh presigned PDF download URL each time (15-min TTL).
   * Throttle: 30/min per IP — the widget polls for status sometimes.
   */
  @Public()
  @Get(':token')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async view(
    @Param('token') token: string,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ) {
    return this.ceremony.view(token, ip, userAgent);
  }

  /**
   * POST /p/sign/:token/sign — submit the canvas-drawn PNG signature.
   * Throttle: 5/min per IP — actual submission is a single click.
   */
  @Public()
  @Post(':token/sign')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async sign(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(SubmitSignatureSchema)) body: Parameters<SigningService['sign']>[1],
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ) {
    return this.signing.sign(token, body, { ipAddress: ip, userAgent: userAgent ?? null });
  }

  /**
   * POST /p/sign/:token/decline — counterparty refuses to sign.
   * Cascades to other signers (they all flip to VOIDED), so a single
   * decline kills the contract.
   */
  @Public()
  @Post(':token/decline')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async decline(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(DeclineSignatureSchema))
    body: Parameters<SigningService['decline']>[1],
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ) {
    return this.signing.decline(token, body, { ipAddress: ip, userAgent: userAgent ?? null });
  }
}
