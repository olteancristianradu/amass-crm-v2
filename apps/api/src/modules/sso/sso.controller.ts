import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, Res, UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Request, Response } from 'express';
import { CreateSsoConfigSchema, CreateSsoConfigDto, UpdateSsoConfigSchema, UpdateSsoConfigDto } from '@amass/shared';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { SsoService, SamlProfile } from './sso.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';

/**
 * SSO / SAML endpoints:
 *   GET  /sso/:tenantSlug/login     → redirect to IdP
 *   POST /sso/:tenantSlug/callback  → receive SAML assertion → issue JWT
 *   GET  /sso/:tenantSlug/metadata  → SP metadata XML (for IdP configuration)
 *
 * Config management (OWNER only, authenticated):
 *   POST   /sso/config
 *   PATCH  /sso/config
 *   DELETE /sso/config
 */
@Controller('sso')
export class SsoController {
  constructor(private readonly svc: SsoService) {}

  // ─── Public SAML flow ──────────────────────────────────────────────────────

  @Get(':tenantSlug/login')
  async login(@Param('tenantSlug') tenantSlug: string, @Res() res: Response) {
    const { config } = await this.svc.getConfig(tenantSlug);
    // Redirect browser to IdP SSO URL with SAMLRequest param
    // In production wire up passport-saml strategy; here we provide the redirect target
    const loginUrl = `${config.idpSsoUrl}?entityID=${encodeURIComponent(config.spEntityId)}`;
    return res.redirect(loginUrl);
  }

  @Post(':tenantSlug/callback')
  @HttpCode(200)
  async callback(
    @Param('tenantSlug') tenantSlug: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // passport-saml populates req.user after strategy validates the assertion
    const profile = (req as Request & { user?: SamlProfile }).user;
    if (!profile) {
      return res.status(401).json({ message: 'SAML assertion missing or invalid' });
    }
    const token = await this.svc.handleCallback(tenantSlug, profile);
    return res.json({ access_token: token });
  }

  @Get(':tenantSlug/metadata')
  async metadata(@Param('tenantSlug') tenantSlug: string, @Res() res: Response) {
    const { config } = await this.svc.getConfig(tenantSlug);
    const xml = `<?xml version="1.0"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${config.spEntityId}">
  <SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true"
    protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
      Location="${config.spEntityId.replace('/metadata', '')}/callback" index="1"/>
  </SPSSODescriptor>
</EntityDescriptor>`;
    res.set('Content-Type', 'application/xml');
    return res.send(xml);
  }

  // ─── Config management (requires auth) ────────────────────────────────────

  @Post('config')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  createConfig(@Body(new ZodValidationPipe(CreateSsoConfigSchema)) dto: CreateSsoConfigDto) {
    const { tenantId } = requireTenantContext();
    return this.svc.createConfig(tenantId, dto);
  }

  @Patch('config')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  updateConfig(@Body(new ZodValidationPipe(UpdateSsoConfigSchema)) dto: UpdateSsoConfigDto) {
    const { tenantId } = requireTenantContext();
    return this.svc.updateConfig(tenantId, dto);
  }

  @Delete('config')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  deleteConfig() {
    const { tenantId } = requireTenantContext();
    return this.svc.deleteConfig(tenantId);
  }
}
