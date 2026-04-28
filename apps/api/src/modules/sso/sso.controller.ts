import { Controller, Get, HttpException, HttpStatus, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';

/**
 * SSO / SAML — DISABLED in this build.
 *
 * A previous version exposed /sso/:tenantSlug/login + /callback + /metadata,
 * but passport-saml was never wired into PassportModule.register() so the
 * callback always returned 401. The scaffold also had latent issues:
 *   - JWT payload used `tenantId` instead of `tid`, breaking
 *     TenantContextMiddleware downstream → cross-tenant bypass.
 *   - Role mapping from SAML attributes without a per-tenant allow-list,
 *     so an IdP compromise would grant OWNER to any assertion.
 *   - No XML signature verification at controller level (expected from
 *     the missing passport strategy).
 *
 * Rather than ship broken-but-scary code, we return 410 GONE on every
 * public SSO endpoint and hide the whole controller from OpenAPI. When a
 * paying customer needs SSO, this controller is the correct place to
 * reintroduce a properly-wired + properly-tested SAML/OIDC stack.
 */
@ApiExcludeController()
@Controller('sso')
export class SsoController {
  private gone(): never {
    throw new HttpException(
      {
        code: 'SSO_NOT_IMPLEMENTED',
        message:
          'SSO/SAML is not available in this build. Use email + password (+ TOTP) authentication.',
      },
      HttpStatus.GONE,
    );
  }

  @Get(':tenantSlug/login')
  @Public()
  login(): never {
    this.gone();
  }

  @Post(':tenantSlug/callback')
  @Public()
  callback(): never {
    this.gone();
  }

  @Get(':tenantSlug/metadata')
  @Public()
  metadata(): never {
    this.gone();
  }

  @Post('config')
  createConfig(): never {
    this.gone();
  }

  @Get('config')
  getConfig(): never {
    this.gone();
  }
}
