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
  CreateOrderSchema,
  ListOrdersQuerySchema,
  UpdateOrderSchema,
} from '@amass/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { OrdersService } from './orders.service';

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  create(@Body(new ZodValidationPipe(CreateOrderSchema)) body: Parameters<OrdersService['create']>[0]) {
    return this.orders.create(body);
  }

  @Get()
  findAll(@Query(new ZodValidationPipe(ListOrdersQuerySchema)) query: Parameters<OrdersService['findAll']>[0]) {
    return this.orders.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.orders.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateOrderSchema)) body: Parameters<OrdersService['update']>[1],
  ) {
    return this.orders.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.orders.remove(id);
  }
}
