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
  CreateCompanyDto,
  CreateCompanySchema,
  PaginationDto,
  PaginationSchema,
  UpdateCompanyDto,
  UpdateCompanySchema,
} from '@amass/shared';
import { UserRole } from '@prisma/client';
import { z } from 'zod';

/**
 * Faza-D bulk-delete payload. Capped at 200 ids per call so a runaway
 * client can't soft-delete an entire tenant in one request.
 */
const BulkDeleteSchema = z.object({
  ids: z.array(z.string().min(1).max(64)).min(1).max(200),
});
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CedarGuard } from '../access-control/cedar.guard';
import { RequireCedar } from '../access-control/cedar.decorator';
import { CompaniesService } from './companies.service';

@Controller('companies')
@UseGuards(JwtAuthGuard, RolesGuard, CedarGuard)
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  create(@Body(new ZodValidationPipe(CreateCompanySchema)) dto: CreateCompanyDto) {
    return this.companies.create(dto);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  list(@Query(new ZodValidationPipe(PaginationSchema)) q: PaginationDto) {
    return this.companies.list(q.cursor, q.limit, q.q);
  }

  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  findOne(@Param('id') id: string) {
    return this.companies.findOne(id);
  }

  @Get(':id/subsidiaries')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  subsidiaries(@Param('id') id: string) {
    return this.companies.subsidiaries(id);
  }

  @Patch(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateCompanySchema)) dto: UpdateCompanyDto,
  ) {
    return this.companies.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  @RequireCedar({ action: "company::delete", resource: (req) => `Company::${(req as { params: { id: string } }).params.id}` })
  remove(@Param('id') id: string) {
    return this.companies.remove(id);
  }

  /**
   * Faza-D bulk delete. Replaces the FE's previous "fan out N requests"
   * pattern with a single transaction so the operator gets atomic
   * all-or-nothing semantics + a single audit row instead of N.
   */
  @Post('bulk-delete')
  @HttpCode(200)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  @RequireCedar({ action: 'company::bulk-delete', resource: 'Company::*' })
  bulkDelete(@Body(new ZodValidationPipe(BulkDeleteSchema)) dto: { ids: string[] }) {
    return this.companies.bulkDelete(dto.ids);
  }
}
