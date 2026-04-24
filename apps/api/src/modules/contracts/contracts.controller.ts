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
  CreateContractSchema,
  ListContractsQuerySchema,
  UpdateContractSchema,
} from '@amass/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CedarGuard } from '../access-control/cedar.guard';
import { RequireCedar } from '../access-control/cedar.decorator';
import { ContractsService } from './contracts.service';

@Controller('contracts')
@UseGuards(JwtAuthGuard, RolesGuard, CedarGuard)
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  create(@Body(new ZodValidationPipe(CreateContractSchema)) body: Parameters<ContractsService['create']>[0]) {
    return this.contracts.create(body);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  findAll(@Query(new ZodValidationPipe(ListContractsQuerySchema)) query: Parameters<ContractsService['findAll']>[0]) {
    return this.contracts.findAll(query);
  }

  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  findOne(@Param('id') id: string) {
    return this.contracts.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  @RequireCedar({ action: 'contract::update', resource: (req) => `Contract::${(req as { params: { id: string } }).params.id}` })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateContractSchema)) body: Parameters<ContractsService['update']>[1],
  ) {
    return this.contracts.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @RequireCedar({ action: 'contract::delete', resource: (req) => `Contract::${(req as { params: { id: string } }).params.id}` })
  remove(@Param('id') id: string) {
    return this.contracts.remove(id);
  }
}
