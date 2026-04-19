import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import {
  CreateCustomerSubscriptionSchema,
  ListCustomerSubscriptionsQuerySchema,
  UpdateCustomerSubscriptionSchema,
} from '@amass/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CustomerSubscriptionsService } from './customer-subscriptions.service';

@Controller('customer-subscriptions')
@UseGuards(JwtAuthGuard)
export class CustomerSubscriptionsController {
  constructor(private readonly subs: CustomerSubscriptionsService) {}

  @Post()
  create(@Body(new ZodValidationPipe(CreateCustomerSubscriptionSchema)) body: Parameters<CustomerSubscriptionsService['create']>[0]) {
    return this.subs.create(body);
  }

  @Get()
  findAll(@Query(new ZodValidationPipe(ListCustomerSubscriptionsQuerySchema)) q: Parameters<CustomerSubscriptionsService['findAll']>[0]) {
    return this.subs.findAll(q);
  }

  @Get('snapshot')
  snapshot() {
    return this.subs.snapshot();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.subs.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateCustomerSubscriptionSchema)) body: Parameters<CustomerSubscriptionsService['update']>[1],
  ) {
    return this.subs.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.subs.remove(id);
  }
}
