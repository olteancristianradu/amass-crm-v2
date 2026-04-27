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
  CreateEmailAccountDto,
  CreateEmailAccountSchema,
  ListEmailsQueryDto,
  ListEmailsQuerySchema,
  SendEmailDto,
  SendEmailSchema,
  UpdateEmailAccountDto,
  UpdateEmailAccountSchema,
} from '@amass/shared';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CedarGuard } from '../access-control/cedar.guard';
import { RequireCedar } from '../access-control/cedar.decorator';
import { EmailService } from './email.service';

/**
 * Email endpoints:
 *
 * Accounts (per-user SMTP config):
 *   POST   /email/accounts       create
 *   GET    /email/accounts       list (current user's accounts)
 *   GET    /email/accounts/:id   single account
 *   PATCH  /email/accounts/:id   update
 *   DELETE /email/accounts/:id   soft delete
 *
 * Messages:
 *   POST   /email/send           compose + queue
 *   GET    /email/messages       list (filterable by subject, account, status)
 *   GET    /email/messages/:id   single message
 */
@Controller('email')
@UseGuards(JwtAuthGuard, RolesGuard, CedarGuard)
export class EmailController {
  constructor(private readonly email: EmailService) {}

  // ─── Accounts ───────────────────────────────────────────────────

  @Post('accounts')
  @RequireCedar({ action: 'email::create', resource: 'EmailAccount::*' })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  createAccount(
    @Body(new ZodValidationPipe(CreateEmailAccountSchema)) dto: CreateEmailAccountDto,
  ) {
    return this.email.createAccount(dto);
  }

  @Get('accounts')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  listAccounts() {
    return this.email.listAccounts();
  }

  @Get('accounts/:id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  findAccount(@Param('id') id: string) {
    // findAccount returns the full account — sanitise for response
    return this.email.listAccounts().then((accs) => accs.find((a) => a.id === id) ?? null);
  }

  @Patch('accounts/:id')
  @RequireCedar({
    action: 'email::update',
    resource: (req) => `EmailAccount::${(req as { params: { id: string } }).params.id}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  updateAccount(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateEmailAccountSchema)) dto: UpdateEmailAccountDto,
  ) {
    return this.email.updateAccount(id, dto);
  }

  @Delete('accounts/:id')
  @HttpCode(204)
  @RequireCedar({
    action: 'email::delete',
    resource: (req) => `EmailAccount::${(req as { params: { id: string } }).params.id}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  removeAccount(@Param('id') id: string) {
    return this.email.removeAccount(id);
  }

  // ─── Messages ───────────────────────────────────────────────────

  @Post('send')
  @RequireCedar({ action: 'email::send', resource: 'EmailMessage::*' })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  send(@Body(new ZodValidationPipe(SendEmailSchema)) dto: SendEmailDto) {
    return this.email.send(dto);
  }

  @Get('messages')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  listMessages(@Query(new ZodValidationPipe(ListEmailsQuerySchema)) q: ListEmailsQueryDto) {
    return this.email.listMessages(q);
  }

  @Get('messages/:id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  findMessage(@Param('id') id: string) {
    return this.email.findMessage(id);
  }
}
