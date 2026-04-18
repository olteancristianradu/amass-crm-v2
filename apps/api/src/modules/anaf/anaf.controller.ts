import { Controller, Get, Header, Param, Post, HttpCode, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AnafService } from './anaf.service';

/**
 * ANAF e-Factura endpoints:
 *   POST /anaf/invoices/:id/submit  — generate XML + upload to SPV
 *   GET  /anaf/invoices/:id/status  — check validation status
 *   GET  /anaf/invoices/:id/xml     — download generated XML
 */
@Controller('anaf')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AnafController {
  constructor(private readonly svc: AnafService) {}

  @Post('invoices/:id/submit')
  @HttpCode(200)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  submit(@Param('id') id: string) {
    return this.svc.submitInvoice(id);
  }

  @Get('invoices/:id/status')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  status(@Param('id') id: string) {
    return this.svc.checkStatus(id);
  }

  @Get('invoices/:id/xml')
  @Header('Content-Type', 'application/xml')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  async xml(@Param('id') id: string) {
    return this.svc.getXml(id);
  }
}
