import {
  Body, Controller, Get, HttpCode, Param, Post, UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CedarGuard } from '../access-control/cedar.guard';
import { RequireCedar } from '../access-control/cedar.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ExportsService } from './exports.service';

const RequestExportSchema = z.object({
  entityType: z.enum(['companies', 'contacts', 'clients', 'deals', 'invoices', 'quotes', 'activities']),
  filters: z.record(z.unknown()).optional(),
});

@Controller('exports')
@UseGuards(JwtAuthGuard, RolesGuard, CedarGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
export class ExportsController {
  constructor(private readonly svc: ExportsService) {}

  @Post()
  @HttpCode(202)
  @RequireCedar({
    action: 'export::request',
    resource: (req) => `Export::${(req as { body: { entityType: string } }).body.entityType}`,
  })
  request(@Body(new ZodValidationPipe(RequestExportSchema)) body: { entityType: string; filters?: Record<string, unknown> }) {
    return this.svc.requestExport(body.entityType, body.filters);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  list() {
    return this.svc.listExports();
  }

  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  get(@Param('id') id: string) {
    return this.svc.getExport(id);
  }

  @Get(':id/download')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  download(@Param('id') id: string) {
    return this.svc.getDownloadUrl(id);
  }
}
