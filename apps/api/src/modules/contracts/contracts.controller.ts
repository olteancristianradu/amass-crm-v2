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
  CreateContractSchema,
  ListContractsQuerySchema,
  UpdateContractSchema,
} from '@amass/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { ContractsService } from './contracts.service';

@Controller('contracts')
@UseGuards(JwtAuthGuard)
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @Post()
  create(@Body(new ZodValidationPipe(CreateContractSchema)) body: Parameters<ContractsService['create']>[0]) {
    return this.contracts.create(body);
  }

  @Get()
  findAll(@Query(new ZodValidationPipe(ListContractsQuerySchema)) query: Parameters<ContractsService['findAll']>[0]) {
    return this.contracts.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.contracts.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateContractSchema)) body: Parameters<ContractsService['update']>[1],
  ) {
    return this.contracts.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.contracts.remove(id);
  }
}
