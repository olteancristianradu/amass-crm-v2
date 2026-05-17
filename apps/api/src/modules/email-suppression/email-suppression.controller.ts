import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  CreateEmailSuppressionDto,
  CreateEmailSuppressionSchema,
  ListEmailSuppressionsQueryDto,
  ListEmailSuppressionsQuerySchema,
} from '@amass/shared';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { EmailSuppressionService } from './email-suppression.service';

/**
 * Phase 1 F1 — admin CRUD over the email suppression list.
 *
 * Roles:
 *   - OWNER / ADMIN can add + remove (mutates "do not contact" policy)
 *   - MANAGER can list (read-only audit visibility)
 *
 * AGENT / VIEWER intentionally excluded — surfacing the suppression list
 * to a wide audience risks doxxing recipients who explicitly opted out.
 *
 * Tracking endpoints OWN the high-volume webhook + unsubscribe paths
 * (EmailTrackingController -> EmailTrackingService.recordUnsubscribe /
 * .recordBounce); they call into EmailSuppressionService.addSystem()
 * directly, bypassing this controller.
 */
@Controller('email-suppressions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EmailSuppressionController {
  constructor(private readonly suppression: EmailSuppressionService) {}

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  list(
    @Query(new ZodValidationPipe(ListEmailSuppressionsQuerySchema))
    q: ListEmailSuppressionsQueryDto,
  ) {
    return this.suppression.list(q);
  }

  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  create(
    @Body(new ZodValidationPipe(CreateEmailSuppressionSchema)) dto: CreateEmailSuppressionDto,
  ) {
    return this.suppression.add(dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  remove(@Param('id') id: string): Promise<void> {
    return this.suppression.remove(id);
  }
}
