import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  InitiateCallDto,
  InitiateCallSchema,
  ListCallsQueryDto,
  ListCallsQuerySchema,
} from '@amass/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CedarGuard } from '../access-control/cedar.guard';
import { RequireCedar } from '../access-control/cedar.decorator';
import { CallsService } from './calls.service';

/**
 * Authenticated call endpoints.
 *
 *   POST   /calls/initiate    click-to-call (AGENT+)
 *   GET    /calls             list (filterable by subject, user, status, direction)
 *   GET    /calls/:id         single call + transcript
 */
@Controller('calls')
@UseGuards(JwtAuthGuard, RolesGuard, CedarGuard)
export class CallsController {
  constructor(private readonly calls: CallsService) {}

  @Post('initiate')
  @RequireCedar({ action: 'call::create', resource: 'Call::*' })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  initiateCall(@Body(new ZodValidationPipe(InitiateCallSchema)) dto: InitiateCallDto) {
    return this.calls.initiateCall(dto);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  list(@Query(new ZodValidationPipe(ListCallsQuerySchema)) q: ListCallsQueryDto) {
    return this.calls.list(q);
  }

  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  findOne(@Param('id') id: string) {
    return this.calls.findOne(id);
  }
}
