import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CreateReportTemplateSchema, CreateReportTemplateDto, UpdateReportTemplateSchema, UpdateReportTemplateDto } from '@amass/shared';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CedarGuard } from '../access-control/cedar.guard';
import { RequireCedar } from '../access-control/cedar.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ReportBuilderService } from './report-builder.service';

@Controller('report-builder')
@UseGuards(JwtAuthGuard, RolesGuard, CedarGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
export class ReportBuilderController {
  constructor(private readonly svc: ReportBuilderService) {}

  @Post('templates')
  @RequireCedar({ action: 'report-template::create', resource: 'ReportTemplate::*' })
  create(@Body(new ZodValidationPipe(CreateReportTemplateSchema)) dto: CreateReportTemplateDto) {
    return this.svc.createTemplate(dto);
  }

  @Get('templates')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  list() {
    return this.svc.listTemplates();
  }

  @Get('templates/:id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  get(@Param('id') id: string) {
    return this.svc.getTemplate(id);
  }

  @Patch('templates/:id')
  @RequireCedar({
    action: 'report-template::update',
    resource: (req) => `ReportTemplate::${(req as { params: { id: string } }).params.id}`,
  })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateReportTemplateSchema)) dto: UpdateReportTemplateDto,
  ) {
    return this.svc.updateTemplate(id, dto);
  }

  @Delete('templates/:id')
  @HttpCode(204)
  @RequireCedar({
    action: 'report-template::delete',
    resource: (req) => `ReportTemplate::${(req as { params: { id: string } }).params.id}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  delete(@Param('id') id: string) {
    return this.svc.deleteTemplate(id);
  }

  @Post('templates/:id/run')
  @HttpCode(200)
  @RequireCedar({
    action: 'report::run',
    resource: (req) => `ReportTemplate::${(req as { params: { id: string } }).params.id}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  run(@Param('id') id: string) {
    return this.svc.runTemplate(id);
  }
}
