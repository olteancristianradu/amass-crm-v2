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
  CreateContractTemplateSchema,
  ListContractTemplatesQuerySchema,
  UpdateContractTemplateSchema,
} from '@amass/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ContractTemplatesService } from './contract-templates.service';

/**
 * Phase 2 F1 — CRUD for ContractTemplate. Templates are tenant-scoped and
 * versioned; see service docstring for the immutability rules.
 *
 * Cedar is intentionally NOT wired here yet — templates are an admin tool
 * and the role gate is enough for the v1 launch. We can add per-template
 * Cedar policies in Phase 2.6 once the FE UI matures.
 */
@Controller('contract-templates')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ContractTemplatesController {
  constructor(private readonly templates: ContractTemplatesService) {}

  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  create(
    @Body(new ZodValidationPipe(CreateContractTemplateSchema))
    body: Parameters<ContractTemplatesService['create']>[0],
  ) {
    return this.templates.create(body);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  findAll(
    @Query(new ZodValidationPipe(ListContractTemplatesQuerySchema))
    query: Parameters<ContractTemplatesService['findAll']>[0],
  ) {
    return this.templates.findAll(query);
  }

  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  findOne(@Param('id') id: string) {
    return this.templates.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateContractTemplateSchema))
    body: Parameters<ContractTemplatesService['update']>[1],
  ) {
    return this.templates.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  remove(@Param('id') id: string) {
    return this.templates.remove(id);
  }
}
