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
import { UserRole } from '@prisma/client';
import {
  ConvertLeadSchema,
  CreateLeadSchema,
  ListLeadsQuerySchema,
  UpdateLeadSchema,
} from '@amass/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CedarGuard } from '../access-control/cedar.guard';
import { RequireCedar } from '../access-control/cedar.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { LeadsService } from './leads.service';

@Controller('leads')
@UseGuards(JwtAuthGuard, RolesGuard, CedarGuard)
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  create(@Body(new ZodValidationPipe(CreateLeadSchema)) body: Parameters<LeadsService['create']>[0]) {
    return this.leads.create(body);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  findAll(@Query(new ZodValidationPipe(ListLeadsQuerySchema)) query: Parameters<LeadsService['findAll']>[0]) {
    return this.leads.findAll(query);
  }

  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  findOne(@Param('id') id: string) {
    return this.leads.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateLeadSchema)) body: Parameters<LeadsService['update']>[1],
  ) {
    return this.leads.update(id, body);
  }

  @Post(':id/convert')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  convert(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ConvertLeadSchema)) body: Parameters<LeadsService['convert']>[1],
  ) {
    return this.leads.convert(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  @RequireCedar({ action: "lead::delete", resource: (req) => `Lead::${(req as { params: { id: string } }).params.id}` })
  remove(@Param('id') id: string) {
    return this.leads.remove(id);
  }
}
