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
  ChangeQuoteStatusDto,
  ChangeQuoteStatusSchema,
  ConvertQuoteToInvoiceDto,
  ConvertQuoteToInvoiceSchema,
  CreateQuoteDto,
  CreateQuoteSchema,
  ListQuotesQueryDto,
  ListQuotesQuerySchema,
  UpdateQuoteDto,
  UpdateQuoteSchema,
} from '@amass/shared';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CedarGuard } from '../access-control/cedar.guard';
import { RequireCedar } from '../access-control/cedar.decorator';
import { CedarContextService } from '../access-control/cedar-context.service';
import { QuotesService } from './quotes.service';

/**
 * Routes:
 *   POST   /quotes                    create DRAFT quote
 *   GET    /quotes                    list + filter
 *   GET    /quotes/:id                single quote with lines
 *   PATCH  /quotes/:id                update DRAFT quote
 *   POST   /quotes/:id/status         FSM status transition
 *   POST   /quotes/:id/convert        convert ACCEPTED quote → invoice
 *   DELETE /quotes/:id                soft delete DRAFT/REJECTED/EXPIRED
 */
@Controller('quotes')
@UseGuards(JwtAuthGuard, RolesGuard, CedarGuard)
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  create(@Body(new ZodValidationPipe(CreateQuoteSchema)) dto: CreateQuoteDto) {
    return this.quotes.create(dto);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  list(@Query(new ZodValidationPipe(ListQuotesQuerySchema)) query: ListQuotesQueryDto) {
    return this.quotes.list(query);
  }

  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  findOne(@Param('id') id: string) {
    return this.quotes.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  // AGENT users can only update quotes they created (Quote.createdById).
  // OWNER/ADMIN/MANAGER bypass via role.
  @RequireCedar({
    action: 'quote::update',
    resource: (req) => `Quote::${(req as { params: { id: string } }).params.id}`,
    context: CedarContextService.ownerOf('quote'),
  })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateQuoteSchema)) dto: UpdateQuoteDto,
  ) {
    return this.quotes.update(id, dto);
  }

  @Post(':id/status')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  changeStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ChangeQuoteStatusSchema)) dto: ChangeQuoteStatusDto,
  ) {
    return this.quotes.changeStatus(id, dto);
  }

  @Post(':id/convert')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  @RequireCedar({ action: 'quote::convert-to-invoice', resource: (req) => `Quote::${(req as { params: { id: string } }).params.id}` })
  convertToInvoice(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ConvertQuoteToInvoiceSchema)) dto: ConvertQuoteToInvoiceDto,
  ) {
    return this.quotes.convertToInvoice(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  @RequireCedar({
    action: 'quote::delete',
    resource: (req) => `Quote::${(req as { params: { id: string } }).params.id}`,
    context: CedarContextService.ownerOf('quote'),
  })
  remove(@Param('id') id: string) {
    return this.quotes.remove(id);
  }
}
