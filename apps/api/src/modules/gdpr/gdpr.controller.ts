import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CedarGuard } from '../access-control/cedar.guard';
import { RequireCedar } from '../access-control/cedar.decorator';
import { GdprService } from './gdpr.service';

/**
 * GDPR endpoints (OWNER/ADMIN only):
 *
 *   GET    /gdpr/contacts/:id/export    — download full data package as JSON
 *   GET    /gdpr/clients/:id/export     — same for clients
 *   DELETE /gdpr/contacts/:id           — right to erasure (anonymise)
 *   DELETE /gdpr/clients/:id            — right to erasure (anonymise)
 *   POST   /gdpr/retention-sweep        — manually trigger retention sweep
 *
 * RolesGuard already limits to OWNER/ADMIN. CedarGuard is layered on top —
 * it is currently permissive (no policies ⇒ allow) but the hooks are in
 * place for ABAC checks (e.g. "only the legal officer role may bulk-erase").
 */
@Controller('gdpr')
@UseGuards(JwtAuthGuard, RolesGuard, CedarGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN)
export class GdprController {
  constructor(private readonly gdpr: GdprService) {}

  @Get('contacts/:id/export')
  @RequireCedar({ action: 'gdpr::export', resource: (req) => `Contact::${(req as { params: { id: string } }).params.id}` })
  async exportContact(@Param('id') id: string, @Res() res: Response) {
    const data = await this.gdpr.exportContact(id);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="gdpr-contact-${id}.json"`);
    res.send(JSON.stringify(data, null, 2));
  }

  @Get('clients/:id/export')
  @RequireCedar({ action: 'gdpr::export', resource: (req) => `Client::${(req as { params: { id: string } }).params.id}` })
  async exportClient(@Param('id') id: string, @Res() res: Response) {
    const data = await this.gdpr.exportClient(id);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="gdpr-client-${id}.json"`);
    res.send(JSON.stringify(data, null, 2));
  }

  @Delete('contacts/:id')
  @HttpCode(200)
  @RequireCedar({ action: 'gdpr::erase', resource: (req) => `Contact::${(req as { params: { id: string } }).params.id}` })
  eraseContact(@Param('id') id: string) {
    return this.gdpr.eraseContact(id);
  }

  @Delete('clients/:id')
  @HttpCode(200)
  @RequireCedar({ action: 'gdpr::erase', resource: (req) => `Client::${(req as { params: { id: string } }).params.id}` })
  eraseClient(@Param('id') id: string) {
    return this.gdpr.eraseClient(id);
  }

  @Post('retention-sweep')
  @HttpCode(200)
  @RequireCedar({ action: 'gdpr::retention-sweep', resource: 'Tenant::self' })
  retentionSweep(@Query('retentionDays') retentionDays?: string) {
    return this.gdpr.retentionSweep(retentionDays ? parseInt(retentionDays, 10) : 365);
  }
}
