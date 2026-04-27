import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CedarGuard } from '../access-control/cedar.guard';
import { RequireCedar } from '../access-control/cedar.decorator';
import { DuplicatesService } from './duplicates.service';
import { z } from 'zod';

const MergeSchema = z.object({
  survivorId: z.string().min(1).max(64),
  victimIds: z.array(z.string().min(1).max(64)).min(1).max(20),
});

@Controller('duplicates')
@UseGuards(JwtAuthGuard, RolesGuard, CedarGuard)
export class DuplicatesController {
  constructor(private readonly svc: DuplicatesService) {}

  @Get('companies/:id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  findCompany(@Param('id') id: string) {
    return this.svc.findCompanyDuplicates(id);
  }

  @Get('contacts/:id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  findContact(@Param('id') id: string) {
    return this.svc.findContactDuplicates(id);
  }

  @Get('clients/:id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  findClient(@Param('id') id: string) {
    return this.svc.findClientDuplicates(id);
  }

  @Post('companies/merge')
  @HttpCode(200)
  @RequireCedar({ action: 'duplicate::merge', resource: 'Duplicate::companies' })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  mergeCompanies(@Body(new ZodValidationPipe(MergeSchema)) body: z.infer<typeof MergeSchema>) {
    return this.svc.mergeCompanies(body.survivorId, body.victimIds);
  }

  @Post('contacts/merge')
  @HttpCode(200)
  @RequireCedar({ action: 'duplicate::merge', resource: 'Duplicate::contacts' })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  mergeContacts(@Body(new ZodValidationPipe(MergeSchema)) body: z.infer<typeof MergeSchema>) {
    return this.svc.mergeContacts(body.survivorId, body.victimIds);
  }

  @Post('clients/merge')
  @HttpCode(200)
  @RequireCedar({ action: 'duplicate::merge', resource: 'Duplicate::clients' })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  mergeClients(@Body(new ZodValidationPipe(MergeSchema)) body: z.infer<typeof MergeSchema>) {
    return this.svc.mergeClients(body.survivorId, body.victimIds);
  }
}
