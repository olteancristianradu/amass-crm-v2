import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import {
  ConsentPurpose,
  LawfulBasis,
  Prisma,
  SubjectType,
  UserRole,
} from '@prisma/client';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CedarGuard } from '../access-control/cedar.guard';
import { RequireCedar } from '../access-control/cedar.decorator';
import { ConsentsService } from './consents.service';

// Subject is restricted to natural persons — Companies are not GDPR data subjects.
const ConsentSubjectTypeSchema = z.enum([SubjectType.CONTACT, SubjectType.CLIENT]);

const GrantConsentSchema = z.object({
  subjectType: ConsentSubjectTypeSchema,
  subjectId: z.string().min(1),
  purpose: z.nativeEnum(ConsentPurpose),
  lawfulBasis: z.nativeEnum(LawfulBasis),
  source: z.string().max(120).optional(),
  evidence: z.unknown().optional(),
});

const RevokeConsentSchema = z.object({
  subjectType: ConsentSubjectTypeSchema,
  subjectId: z.string().min(1),
  purpose: z.nativeEnum(ConsentPurpose),
  source: z.string().max(120).optional(),
});

function ipUa(req: Request): { ipAddress?: string; userAgent?: string } {
  const xff = req.headers['x-forwarded-for'];
  const fromXff = Array.isArray(xff) ? xff[0] : xff?.split(',')[0]?.trim();
  const ipAddress = fromXff || req.ip || undefined;
  const uaRaw = req.headers['user-agent'];
  const userAgent = Array.isArray(uaRaw) ? uaRaw[0] : uaRaw ?? undefined;
  return { ipAddress, userAgent };
}

/**
 * Consent management endpoints. All authenticated; Cedar-gated for write
 * operations (MANAGER+) and read for any team member (AGENT+).
 *
 * Data-subject self-service revocation (e.g. "unsubscribe" link in email)
 * lives on the public portal/email-tracking module, not here.
 */
@Controller('consents')
@UseGuards(JwtAuthGuard, RolesGuard, CedarGuard)
export class ConsentsController {
  constructor(private readonly consents: ConsentsService) {}

  /** Record a new consent grant (e.g. signup checkbox, verbal call confirmation). */
  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  @RequireCedar({ action: 'consents::create', resource: 'ConsentRecord::*' })
  grant(
    @Body(new ZodValidationPipe(GrantConsentSchema)) dto: z.infer<typeof GrantConsentSchema>,
    @Req() req: Request,
  ) {
    const { ipAddress, userAgent } = ipUa(req);
    return this.consents.grant({
      subjectType: dto.subjectType,
      subjectId: dto.subjectId,
      purpose: dto.purpose,
      lawfulBasis: dto.lawfulBasis,
      source: dto.source,
      ipAddress,
      userAgent,
      ...(dto.evidence === undefined ? {} : { evidence: dto.evidence as Prisma.InputJsonValue }),
    });
  }

  /** Record a consent revocation (e.g. customer requested unsubscribe). */
  @Post('revoke')
  @HttpCode(200)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  @RequireCedar({ action: 'consents::revoke', resource: 'ConsentRecord::*' })
  revoke(
    @Body(new ZodValidationPipe(RevokeConsentSchema)) dto: z.infer<typeof RevokeConsentSchema>,
    @Req() req: Request,
  ) {
    const { ipAddress, userAgent } = ipUa(req);
    return this.consents.revoke({ ...dto, ipAddress, userAgent });
  }

  /** Full append-only history for a subject (newest first). */
  @Get('subject/:type/:id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  @RequireCedar({
    action: 'consents::read',
    resource: (req) => `ConsentRecord::${(req as { params: { id: string } }).params.id}`,
  })
  list(@Param('type') type: string, @Param('id') id: string) {
    const r = ConsentSubjectTypeSchema.safeParse(type);
    if (!r.success) throw new BadRequestException({ code: 'INVALID_SUBJECT_TYPE', message: `Invalid subject type: ${type}. Must be CONTACT or CLIENT` });
    return this.consents.listForSubject(r.data, id);
  }

  /** Current state per purpose for a subject (one row per purpose, most recent). */
  @Get('subject/:type/:id/current')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  @RequireCedar({
    action: 'consents::read',
    resource: (req) => `ConsentRecord::${(req as { params: { id: string } }).params.id}`,
  })
  current(@Param('type') type: string, @Param('id') id: string) {
    const r = ConsentSubjectTypeSchema.safeParse(type);
    if (!r.success) throw new BadRequestException({ code: 'INVALID_SUBJECT_TYPE', message: `Invalid subject type: ${type}. Must be CONTACT or CLIENT` });
    return this.consents.currentByPurpose(r.data, id);
  }

  /** Pre-flight check: can we send marketing email/SMS to this subject? */
  @Get('check')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  @RequireCedar({ action: 'consents::read', resource: 'ConsentRecord::*' })
  async check(
    @Query('subjectType') subjectType: string,
    @Query('subjectId') subjectId: string,
    @Query('purpose') purpose: string,
  ) {
    const rst = ConsentSubjectTypeSchema.safeParse(subjectType);
    if (!rst.success) throw new BadRequestException({ code: 'INVALID_SUBJECT_TYPE', message: `Invalid subject type: ${subjectType}. Must be CONTACT or CLIENT` });
    const rp = z.nativeEnum(ConsentPurpose).safeParse(purpose);
    if (!rp.success) throw new BadRequestException({ code: 'INVALID_PURPOSE', message: `Invalid consent purpose: ${purpose}` });
    const has = await this.consents.hasConsent(rst.data, subjectId, rp.data);
    return { hasConsent: has };
  }
}
