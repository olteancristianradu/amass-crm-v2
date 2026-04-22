import { Global, Module } from '@nestjs/common';
import { CedarGuard } from './cedar.guard';
import { CedarPolicyService } from './cedar-policy.service';
import { ConditionalAccessMiddleware } from './conditional-access.middleware';

/**
 * A/D-scaffold: groups the access-control primitives (Conditional Access
 * middleware + Cedar policy engine + CedarGuard) that back step-up auth,
 * ABAC decisions, and row/column-level filters. Global so feature modules
 * can `@UseGuards(CedarGuard)` without re-importing.
 *
 * No controllers — this module is policy glue, not an API surface.
 */
@Global()
@Module({
  providers: [CedarPolicyService, CedarGuard, ConditionalAccessMiddleware],
  exports: [CedarPolicyService, CedarGuard, ConditionalAccessMiddleware],
})
export class AccessControlModule {}
