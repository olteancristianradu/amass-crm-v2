import { Injectable } from '@nestjs/common';

/**
 * D-scaffold: Cedar policy engine wrapper. Cedar (https://www.cedarpolicy.com/)
 * is AWS's open-source ABAC engine — policies-as-data, with a small
 * well-defined language. We defer pulling the `@cedar-policy/cedar-wasm`
 * dependency until actually needed; for now `check()` returns `allow: true`
 * so route guards using this service are no-ops.
 *
 * Intended entity shape when real:
 *   - principal: User::"<cuid>"
 *   - action:    Action::"read" | "write" | "delete" | ...
 *   - resource:  Deal::"<id>"   (typed per model)
 *   - context:   { ip, mfa, roles, tenantId, shardId, timestamp }
 */
export interface CedarDecisionInput {
  principal: string;
  action: string;
  resource: string;
  context?: Record<string, unknown>;
}

export interface CedarDecision {
  allow: boolean;
  reasons?: string[];
}

@Injectable()
export class CedarPolicyService {
  check(_input: CedarDecisionInput): CedarDecision {
    // Until the engine is wired, default-allow so the rest of the stack is
    // unaffected. Flip to default-deny once policies are seeded.
    return { allow: true };
  }
}
