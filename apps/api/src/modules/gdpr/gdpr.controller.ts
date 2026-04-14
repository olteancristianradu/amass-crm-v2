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
import { GdprService } from './gdpr.service';

/**
 * GDPR endpoints (OWNER/ADMIN only):
 *
 *   GET    /gdpr/contacts/:id/export    — download full data package as JSON
 *   GET    /gdpr/clients/:id/export     — same for clients
 *   DELETE /gdpr/contacts/:id           — right to erasure (anonymise)
 *   DELETE /gdpr/clients/:id            — right to erasure (anonymise)
 *   POST   /gdpr/retention-sweep        — manually trigger retention sweep
 */
@Controller('gdpr')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN)
export class GdprController {
  constructor(private readonly gdpr: GdprService) {}

  @Get('contacts/:id/export')
  async exportContact(@Param('id') id: string, @Res() res: Response) {
    const data = await this.gdpr.exportContact(id);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="gdpr-contact-${id}.json"`);
    res.send(JSON.stringify(data, null, 2));
  }

  @Get('clients/:id/export')
  async exportClient(@Param('id') id: string, @Res() res: Response) {
    const data = await this.gdpr.exportClient(id);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="gdpr-client-${id}.json"`);
    res.send(JSON.stringify(data, null, 2));
  }

  @Delete('contacts/:id')
  @HttpCode(200)
  eraseContact(@Param('id') id: string) {
    return this.gdpr.eraseContact(id);
  }

  @Delete('clients/:id')
  @HttpCode(200)
  eraseClient(@Param('id') id: string) {
    return this.gdpr.eraseClient(id);
  }

  @Post('retention-sweep')
  @HttpCode(200)
  retentionSweep(@Query('retentionDays') retentionDays?: string) {
    return this.gdpr.retentionSweep(retentionDays ? parseInt(retentionDays, 10) : 365);
  }
}
