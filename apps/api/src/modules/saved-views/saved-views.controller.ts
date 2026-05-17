import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  PayloadTooLargeException,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  CreateSavedViewDto,
  CreateSavedViewSchema,
  ListSavedViewsQueryDto,
  ListSavedViewsQuerySchema,
  SavedViewResource,
  SavedViewResourceSchema,
  UpdateSavedViewDto,
  UpdateSavedViewSchema,
} from '@amass/shared';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { SavedViewsService } from './saved-views.service';

// T-SV-D-01 — DoS via oversized filter blobs. The global JSON parser caps
// the whole request at 2MB (apps/api/src/main.ts), but saved-view filters
// are tiny structured objects (a couple dozen keys at most). 16 KB is
// roughly 50× any realistic filter set and gives an unambiguous early
// reject before the row hits the DB.
const SAVED_VIEW_MAX_BYTES = 16 * 1024;

function enforcePayloadSize(req: Request): void {
  // Two checks: declared Content-Length (cheap, catches honest clients) and
  // the actual parsed body size (catches missing/chunked-encoding requests).
  //
  // N-3: parse Content-Length defensively. `Number(undefined)` → NaN, which
  // historically passed the bound check because `NaN > N` is false; a
  // malformed header would slip past this gate and the only real defence
  // would be the route-scoped json({limit:'32kb'}) below it. Now any
  // non-finite or negative value short-circuits to "treat as missing" and
  // we fall through to the parsed-body check.
  const rawCl = req.headers['content-length'];
  if (rawCl !== undefined) {
    const declared = Number(rawCl);
    if (!Number.isFinite(declared) || declared < 0) {
      throw new PayloadTooLargeException({
        code: 'INVALID_CONTENT_LENGTH',
        message: 'Content-Length header is malformed',
      });
    }
    if (declared > SAVED_VIEW_MAX_BYTES) {
      throw new PayloadTooLargeException({
        code: 'PAYLOAD_TOO_LARGE',
        message: `Saved view payload exceeds ${SAVED_VIEW_MAX_BYTES} bytes`,
      });
    }
  }
  const bodyBytes = Buffer.byteLength(JSON.stringify(req.body ?? {}), 'utf8');
  if (bodyBytes > SAVED_VIEW_MAX_BYTES) {
    throw new PayloadTooLargeException({
      code: 'PAYLOAD_TOO_LARGE',
      message: `Saved view payload exceeds ${SAVED_VIEW_MAX_BYTES} bytes`,
    });
  }
}

/**
 * Saved views — every authenticated role can manage their OWN views.
 * No Cedar guard: ownership is enforced by the service via ctx.userId,
 * so a tenant member can never read or modify another member's view.
 */
@Controller('saved-views')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SavedViewsController {
  constructor(private readonly svc: SavedViewsService) {}

  /**
   * System default views are static and read-only — must be served BEFORE
   * the `/:id` route or Nest would route `/system-defaults` to findOne()
   * with literal id="system-defaults".
   */
  // LOW-3: response is static (hardcoded in svc.getSystemDefaults) so we
  // can safely tell shared caches to keep it for an hour. Saves an API
  // round-trip on every list page that refetches its default views.
  @Get('system-defaults')
  @Header('Cache-Control', 'public, max-age=3600')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  systemDefaults(@Query('resource') rawResource: string) {
    const parsed = SavedViewResourceSchema.safeParse(rawResource);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Invalid or missing resource query param',
      });
    }
    const resource: SavedViewResource = parsed.data;
    return this.svc.getSystemDefaults(resource);
  }

  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  create(
    @Req() req: Request,
    @Body(new ZodValidationPipe(CreateSavedViewSchema)) dto: CreateSavedViewDto,
  ) {
    enforcePayloadSize(req);
    return this.svc.create(dto);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  list(@Query(new ZodValidationPipe(ListSavedViewsQuerySchema)) query: ListSavedViewsQueryDto) {
    return this.svc.list(query.resource);
  }

  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateSavedViewSchema)) dto: UpdateSavedViewDto,
  ) {
    enforcePayloadSize(req);
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
