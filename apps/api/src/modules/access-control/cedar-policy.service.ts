import { Injectable, Logger } from '@nestjs/common';

/**
 * D-scaffold (now default-deny with minimal seed rules): lightweight ABAC
 * evaluator. When `@cedar-policy/cedar-wasm` is pulled in (tracked as
 * follow-up — wasm adds ~1.5MB to the bundle), swap `evaluate()` for the
 * real engine; the input/output shapes below are a subset of Cedar's,
 * chosen so callers don't have to change.
 *
 * Until then: deny-by-default plus a tiny seed ruleset that mirrors the
 * role hierarchy used elsewhere (`@Roles` decorator + RolesGuard). This
 * keeps the service useful for new callers without waiting for the real
 * engine.
 *
 * Seed rules (evaluated in order, first match wins):
 *
 *   1. OWNER   — allow everything on every resource.
 *   2. ADMIN   — allow all actions except `*::delete` on billing/sso.
 *   3. MANAGER — allow read/write on Deal/Quote/Invoice/Contract; read on
 *                everything else; no delete on tenant-level config.
 *   4. AGENT   — read/write on own Deal/Contact/Task; read-only elsewhere.
 *   5. VIEWER  — read-only on everything.
 *   6. (no role) — deny.
 *
 * Callers provide `{ principal, action, resource, context }`. `context`
 * is free-form and carries per-request facts (e.g. tenantId, owner match,
 * mfa). The seed rules use `context.role` which RolesGuard already writes.
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

type Role = 'OWNER' | 'ADMIN' | 'MANAGER' | 'AGENT' | 'VIEWER';

/** Actions that only OWNER can perform, regardless of role hierarchy. */
const OWNER_ONLY_ACTIONS = new Set<string>([
  'tenant::delete',
  'billing::cancel-subscription',
  'sso::disable',
  'user::demote-owner',
]);

/** Resources marked as tenant-level configuration — no delete below ADMIN. */
const TENANT_CONFIG_RESOURCES = ['SsoConfig', 'BillingSubscription', 'Tenant', 'WebhookEndpoint'];

@Injectable()
export class CedarPolicyService {
  private readonly logger = new Logger(CedarPolicyService.name);

  check(input: CedarDecisionInput): CedarDecision {
    const role = this.extractRole(input.context);
    const verb = this.actionVerb(input.action);
    const resourceType = this.resourceType(input.resource);

    // Owner-only allow-list always wins.
    if (OWNER_ONLY_ACTIONS.has(input.action)) {
      if (role === 'OWNER') return this.allow('owner_only_action');
      return this.deny(`owner_only: ${input.action}`);
    }

    if (!role) return this.deny('no_role');

    switch (role) {
      case 'OWNER':
        return this.allow('owner');

      case 'ADMIN': {
        if (verb === 'delete' && TENANT_CONFIG_RESOURCES.includes(resourceType)) {
          return this.deny('admin_cannot_delete_tenant_config');
        }
        return this.allow('admin');
      }

      case 'MANAGER': {
        const writeable = ['Deal', 'Quote', 'Invoice', 'Contract', 'Order', 'Task'];
        if (verb === 'read') return this.allow('manager_read_all');
        if (writeable.includes(resourceType)) return this.allow('manager_write_sales');
        if (TENANT_CONFIG_RESOURCES.includes(resourceType)) {
          return this.deny('manager_cannot_touch_tenant_config');
        }
        return this.deny(`manager_no_${verb}_on_${resourceType}`);
      }

      case 'AGENT': {
        if (verb === 'read') return this.allow('agent_read_all');
        const ownerMatch = input.context?.isOwner === true;
        if (['Deal', 'Contact', 'Task'].includes(resourceType) && ownerMatch) {
          return this.allow('agent_write_own');
        }
        return this.deny(`agent_no_${verb}_on_${resourceType}`);
      }

      case 'VIEWER':
        if (verb === 'read') return this.allow('viewer_read_only');
        return this.deny('viewer_read_only');
    }
  }

  private extractRole(ctx: Record<string, unknown> | undefined): Role | null {
    const raw = ctx?.role;
    if (typeof raw !== 'string') return null;
    const roles: Role[] = ['OWNER', 'ADMIN', 'MANAGER', 'AGENT', 'VIEWER'];
    return roles.includes(raw as Role) ? (raw as Role) : null;
  }

  private actionVerb(action: string): string {
    // "deal::update" → "update" ; "tenant::delete" → "delete" ; "view" → "view"
    const colon = action.lastIndexOf('::');
    return (colon >= 0 ? action.slice(colon + 2) : action).toLowerCase();
  }

  private resourceType(resource: string): string {
    // "Deal::abc123" → "Deal" ; "Deal" → "Deal"
    const colon = resource.indexOf('::');
    return colon >= 0 ? resource.slice(0, colon) : resource;
  }

  private allow(reason: string): CedarDecision {
    return { allow: true, reasons: [reason] };
  }

  private deny(reason: string): CedarDecision {
    this.logger.debug(`cedar deny: ${reason}`);
    return { allow: false, reasons: [reason] };
  }
}
