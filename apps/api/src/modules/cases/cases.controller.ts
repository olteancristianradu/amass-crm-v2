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
  CreateCaseSchema,
  ListCasesQuerySchema,
  UpdateCaseSchema,
} from '@amass/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CasesService } from './cases.service';

@Controller('cases')
@UseGuards(JwtAuthGuard)
export class CasesController {
  constructor(private readonly cases: CasesService) {}

  @Post()
  create(@Body(new ZodValidationPipe(CreateCaseSchema)) body: Parameters<CasesService['create']>[0]) {
    return this.cases.create(body);
  }

  @Get()
  findAll(@Query(new ZodValidationPipe(ListCasesQuerySchema)) query: Parameters<CasesService['findAll']>[0]) {
    return this.cases.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.cases.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateCaseSchema)) body: Parameters<CasesService['update']>[1],
  ) {
    return this.cases.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.cases.remove(id);
  }
}
