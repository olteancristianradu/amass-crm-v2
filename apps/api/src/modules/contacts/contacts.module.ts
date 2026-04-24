import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';

/**
 * ContactsModule — people inside B2B companies. A Contact OPTIONALLY
 * belongs to a Company (companyId nullable so we can store leads who
 * haven't been linked yet). When companyId IS set, the service verifies
 * the company exists in the same tenant — defends against forged FK
 * cross-tenant attacks even though Prisma + RLS would also catch it.
 *
 * Routes mirror Companies (CRUD + cursor pagination + q= search).
 * Activities are logged with action = "contact.created" etc.
 */
@Module({
  imports: [AuthModule, AccessControlModule],
  controllers: [ContactsController],
  providers: [ContactsService],
})
export class ContactsModule {}
