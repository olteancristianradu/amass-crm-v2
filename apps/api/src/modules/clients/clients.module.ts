import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';

/**
 * ClientsModule — B2C natural persons (Romanian SMB scenario: hairdresser
 * appointments, dental clinic patients, etc.). Distinct from Contacts
 * because there's no parent Company and the field set differs (CNP,
 * birthDate, address line). Same RBAC + activity logging conventions.
 */
@Module({
  imports: [AuthModule, AccessControlModule],
  controllers: [ClientsController],
  providers: [ClientsService],
})
export class ClientsModule {}
