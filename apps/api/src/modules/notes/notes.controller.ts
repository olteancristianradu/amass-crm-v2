import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  CreateNoteDto,
  CreateNoteSchema,
  SubjectTypeDto,
  SubjectTypeSchema,
  UpdateNoteDto,
  UpdateNoteSchema,
} from '@amass/shared';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { NotesService } from './notes.service';

/**
 * Polymorphic notes endpoints. Path uses `:subjectType` so a single
 * controller handles companies/contacts/clients without three near-identical
 * controllers. The :subjectType param is validated through SubjectTypeSchema
 * (uppercase enum).
 *
 * Two routes shapes:
 *  - /:subjectType/:subjectId/notes      (collection ops + create)
 *  - /:subjectType/:subjectId/timeline   (merged notes + activities)
 *  - /notes/:noteId                      (update / delete a single note by id)
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  private parseSubject(raw: string): SubjectTypeDto {
    // Accept lowercase too for ergonomic URLs.
    return SubjectTypeSchema.parse(raw.toUpperCase());
  }

  @Post(':subjectType/:subjectId/notes')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  create(
    @Param('subjectType') subjectType: string,
    @Param('subjectId') subjectId: string,
    @Body(new ZodValidationPipe(CreateNoteSchema)) dto: CreateNoteDto,
  ) {
    return this.notes.create(this.parseSubject(subjectType), subjectId, dto);
  }

  @Get(':subjectType/:subjectId/notes')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  list(@Param('subjectType') subjectType: string, @Param('subjectId') subjectId: string) {
    return this.notes.list(this.parseSubject(subjectType), subjectId);
  }

  @Get(':subjectType/:subjectId/timeline')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  timeline(
    @Param('subjectType') subjectType: string,
    @Param('subjectId') subjectId: string,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limitRaw: string | undefined,
  ) {
    const limit = Math.min(Math.max(Number(limitRaw) || 20, 1), 100);
    return this.notes.getTimeline(this.parseSubject(subjectType), subjectId, cursor, limit);
  }

  @Patch('notes/:noteId')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  update(
    @Param('noteId') noteId: string,
    @Body(new ZodValidationPipe(UpdateNoteSchema)) dto: UpdateNoteDto,
  ) {
    return this.notes.update(noteId, dto);
  }

  @Delete('notes/:noteId')
  @HttpCode(204)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  remove(@Param('noteId') noteId: string) {
    return this.notes.remove(noteId);
  }
}
