import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards,
} from '@nestjs/common';
import {
  AssignTerritorySchema,
  CreateTerritorySchema,
  UpdateTerritorySchema,
} from '@amass/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { TerritoriesService } from './territories.service';

@Controller('territories')
@UseGuards(JwtAuthGuard)
export class TerritoriesController {
  constructor(private readonly territories: TerritoriesService) {}

  @Post()
  create(@Body(new ZodValidationPipe(CreateTerritorySchema)) body: Parameters<TerritoriesService['create']>[0]) {
    return this.territories.create(body);
  }

  @Get()
  findAll() {
    return this.territories.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.territories.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateTerritorySchema)) body: Parameters<TerritoriesService['update']>[1],
  ) {
    return this.territories.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.territories.remove(id);
  }

  @Post(':id/assignments')
  assign(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AssignTerritorySchema)) body: { userId: string },
  ) {
    return this.territories.assign(id, body.userId);
  }

  @Delete(':id/assignments/:userId')
  @HttpCode(204)
  unassign(@Param('id') id: string, @Param('userId') userId: string) {
    return this.territories.unassign(id, userId);
  }
}
