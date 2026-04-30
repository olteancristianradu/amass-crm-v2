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

// FIX (RED2#2): Pre-fix `filters: z.record(z.unknown())` allowed an authed user
// to override server-side filters like `deletedAt: null`, recovering soft-deleted
// (incl. GDPR-erased) records. Now we explicitly allow-list a small set of
// per-export filter keys; nested operators and unknown keys are rejected by Zod.
const ExportFilterSchema = z.object({
  ownerId: z.string().min(1).max(64).optional(),
  status: z.string().min(1).max(64).optional(),
  createdAfter: z.string().datetime().optional(),
  createdBefore: z.string().datetime().optional(),
  // No `deletedAt`, no `OR`/`NOT`/raw operators — by design.
}).strict().optional();

const RequestExportSchema = z.object({
  entityType: z.enum(['companies', 'contacts', 'clients', 'deals', 'invoices', 'quotes', 'activities']),
  filters: ExportFilterSchema,
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
