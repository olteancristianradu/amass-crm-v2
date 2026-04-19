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
  CreateCampaignSchema,
  ListCampaignsQuerySchema,
  UpdateCampaignSchema,
} from '@amass/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CampaignsService } from './campaigns.service';

@Controller('campaigns')
@UseGuards(JwtAuthGuard)
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Post()
  create(@Body(new ZodValidationPipe(CreateCampaignSchema)) body: Parameters<CampaignsService['create']>[0]) {
    return this.campaigns.create(body);
  }

  @Get()
  findAll(@Query(new ZodValidationPipe(ListCampaignsQuerySchema)) query: Parameters<CampaignsService['findAll']>[0]) {
    return this.campaigns.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.campaigns.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateCampaignSchema)) body: Parameters<CampaignsService['update']>[1],
  ) {
    return this.campaigns.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.campaigns.remove(id);
  }
}
