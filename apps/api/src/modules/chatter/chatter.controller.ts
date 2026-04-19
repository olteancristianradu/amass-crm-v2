import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import {
  CreateChatterPostSchema,
  ListChatterQuerySchema,
  UpdateChatterPostSchema,
} from '@amass/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { ChatterService } from './chatter.service';

@Controller('chatter')
@UseGuards(JwtAuthGuard)
export class ChatterController {
  constructor(private readonly chatter: ChatterService) {}

  @Post()
  create(@Body(new ZodValidationPipe(CreateChatterPostSchema)) body: Parameters<ChatterService['create']>[0]) {
    return this.chatter.create(body);
  }

  @Get()
  list(@Query(new ZodValidationPipe(ListChatterQuerySchema)) q: Parameters<ChatterService['list']>[0]) {
    return this.chatter.list(q);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateChatterPostSchema)) body: Parameters<ChatterService['update']>[1],
  ) {
    return this.chatter.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.chatter.remove(id);
  }
}
