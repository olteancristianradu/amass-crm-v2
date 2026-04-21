import { Module } from '@nestjs/common';
import { ScimController } from './scim.controller';

/**
 * A-scaffold: placeholder for the SCIM 2.0 provisioning module. Controller
 * advertises the route surface IdPs expect; real logic (Users, Groups,
 * ServiceProviderConfig, ResourceTypes, Schemas) lands when a customer asks
 * for it — implementing it ahead of demand is waste.
 */
@Module({
  controllers: [ScimController],
})
export class ScimModule {}
