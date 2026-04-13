import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CreatePhoneNumberDto, CreatePhoneNumberSchema } from '@amass/shared';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { PhoneNumbersService } from './phone-numbers.service';

const UpdatePhoneNumberSchema = CreatePhoneNumberSchema.partial();
type UpdatePhoneNumberDto = z.infer<typeof UpdatePhoneNumberSchema>;

/**
 * Phone number CRUD.
 * Numbers are typically purchased in the Twilio console and then
 * registered here so the CRM knows which numbers belong to which users.
 *
 *   POST   /phone-numbers
 *   GET    /phone-numbers
 *   GET    /phone-numbers/:id
 *   PATCH  /phone-numbers/:id
 *   DELETE /phone-numbers/:id
 */
@Controller('phone-numbers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PhoneNumbersController {
  constructor(private readonly phoneNumbers: PhoneNumbersService) {}

  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  create(@Body(new ZodValidationPipe(CreatePhoneNumberSchema)) dto: CreatePhoneNumberDto) {
    return this.phoneNumbers.create(dto);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  list() {
    return this.phoneNumbers.list();
  }

  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  findOne(@Param('id') id: string) {
    return this.phoneNumbers.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdatePhoneNumberSchema)) dto: UpdatePhoneNumberDto,
  ) {
    return this.phoneNumbers.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  remove(@Param('id') id: string) {
    return this.phoneNumbers.remove(id);
  }
}
