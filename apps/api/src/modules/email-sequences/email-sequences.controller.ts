import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import {
  CreateEmailSequenceDto, CreateEmailSequenceSchema,
  EnrollContactDto, EnrollContactSchema,
  UpdateEmailSequenceDto, UpdateEmailSequenceSchema,
} from '@amass/shared';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CedarGuard } from '../access-control/cedar.guard';
import { RequireCedar } from '../access-control/cedar.decorator';
import { EmailSequencesService } from './email-sequences.service';

@Controller('email-sequences')
@UseGuards(JwtAuthGuard, RolesGuard, CedarGuard)
export class EmailSequencesController {
  constructor(private readonly svc: EmailSequencesService) {}

  @Post()
  @RequireCedar({ action: 'email-sequence::create', resource: 'EmailSequence::*' })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  create(@Body(new ZodValidationPipe(CreateEmailSequenceSchema)) dto: CreateEmailSequenceDto) {
    return this.svc.create(dto);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  list(@Query('status') status?: string) {
    return this.svc.list(status);
  }

  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }

  @Patch(':id')
  @RequireCedar({
    action: 'email-sequence::update',
    resource: (req) => `EmailSequence::${(req as { params: { id: string } }).params.id}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateEmailSequenceSchema)) dto: UpdateEmailSequenceDto,
  ) {
    return this.svc.update(id, dto);
  }

  @Post(':id/activate')
  @RequireCedar({
    action: 'email-sequence::update',
    resource: (req) => `EmailSequence::${(req as { params: { id: string } }).params.id}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  activate(@Param('id') id: string) {
    return this.svc.activate(id);
  }

  @Post(':id/pause')
  @RequireCedar({
    action: 'email-sequence::update',
    resource: (req) => `EmailSequence::${(req as { params: { id: string } }).params.id}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  pause(@Param('id') id: string) {
    return this.svc.pause(id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireCedar({
    action: 'email-sequence::delete',
    resource: (req) => `EmailSequence::${(req as { params: { id: string } }).params.id}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  archive(@Param('id') id: string) {
    return this.svc.archive(id);
  }

  @Post(':id/enroll')
  @RequireCedar({
    action: 'email-sequence::enroll',
    resource: (req) => `EmailSequence::${(req as { params: { id: string } }).params.id}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  enroll(
    @Param('id') _id: string,
    @Body(new ZodValidationPipe(EnrollContactSchema)) dto: EnrollContactDto,
  ) {
    return this.svc.enroll(dto);
  }

  @Get(':id/enrollments')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  listEnrollments(@Param('id') id: string) {
    return this.svc.listEnrollments(id);
  }

  @Delete('enrollments/:enrollmentId')
  @HttpCode(204)
  @RequireCedar({
    action: 'email-sequence::unenroll',
    resource: (req) => `EmailSequenceEnrollment::${(req as { params: { enrollmentId: string } }).params.enrollmentId}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  unenroll(@Param('enrollmentId') enrollmentId: string) {
    return this.svc.unenroll(enrollmentId);
  }
}
