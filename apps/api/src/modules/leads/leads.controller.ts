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
  ConvertLeadSchema,
  CreateLeadSchema,
  ListLeadsQuerySchema,
  UpdateLeadSchema,
} from '@amass/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { LeadsService } from './leads.service';

@Controller('leads')
@UseGuards(JwtAuthGuard)
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Post()
  create(@Body(new ZodValidationPipe(CreateLeadSchema)) body: Parameters<LeadsService['create']>[0]) {
    return this.leads.create(body);
  }

  @Get()
  findAll(@Query(new ZodValidationPipe(ListLeadsQuerySchema)) query: Parameters<LeadsService['findAll']>[0]) {
    return this.leads.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.leads.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateLeadSchema)) body: Parameters<LeadsService['update']>[1],
  ) {
    return this.leads.update(id, body);
  }

  @Post(':id/convert')
  convert(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ConvertLeadSchema)) body: Parameters<LeadsService['convert']>[1],
  ) {
    return this.leads.convert(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.leads.remove(id);
  }
}
