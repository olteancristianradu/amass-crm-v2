import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  CreateCustomerSubscriptionSchema,
  ListCustomerSubscriptionsQuerySchema,
  UpdateCustomerSubscriptionSchema,
} from '@amass/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CustomerSubscriptionsService } from './customer-subscriptions.service';

@Controller('customer-subscriptions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomerSubscriptionsController {
  constructor(private readonly subs: CustomerSubscriptionsService) {}

  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  create(@Body(new ZodValidationPipe(CreateCustomerSubscriptionSchema)) body: Parameters<CustomerSubscriptionsService['create']>[0]) {
    return this.subs.create(body);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  findAll(@Query(new ZodValidationPipe(ListCustomerSubscriptionsQuerySchema)) q: Parameters<CustomerSubscriptionsService['findAll']>[0]) {
    return this.subs.findAll(q);
  }

  @Get('snapshot')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  snapshot() {
    return this.subs.snapshot();
  }

  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  findOne(@Param('id') id: string) {
    return this.subs.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateCustomerSubscriptionSchema)) body: Parameters<CustomerSubscriptionsService['update']>[1],
  ) {
    return this.subs.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  remove(@Param('id') id: string) {
    return this.subs.remove(id);
  }
}
