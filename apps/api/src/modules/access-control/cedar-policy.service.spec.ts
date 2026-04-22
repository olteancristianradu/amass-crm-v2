import { describe, expect, it } from 'vitest';
import { CedarPolicyService } from './cedar-policy.service';

describe('CedarPolicyService (seed policies)', () => {
  const svc = new CedarPolicyService();
  const call = (role: string | null, action: string, resource: string, extra: Record<string, unknown> = {}) =>
    svc.check({
      principal: 'User::u1',
      action,
      resource,
      context: { ...(role ? { role } : {}), ...extra },
    });

  it('denies when no role is present (default-deny)', () => {
    expect(call(null, 'deal::read', 'Deal::d1').allow).toBe(false);
  });

  it('OWNER can do everything, including owner-only actions', () => {
    expect(call('OWNER', 'tenant::delete', 'Tenant::t1').allow).toBe(true);
    expect(call('OWNER', 'deal::delete', 'Deal::d1').allow).toBe(true);
  });

  it('ADMIN cannot delete tenant-config resources even though they can delete others', () => {
    expect(call('ADMIN', 'deal::delete', 'Deal::d1').allow).toBe(true);
    expect(call('ADMIN', 'sso::delete', 'SsoConfig::s1').allow).toBe(false);
    expect(call('ADMIN', 'billing::delete', 'BillingSubscription::b1').allow).toBe(false);
  });

  it('MANAGER reads everything and writes sales-ish resources', () => {
    expect(call('MANAGER', 'contact::read', 'Contact::c1').allow).toBe(true);
    expect(call('MANAGER', 'deal::update', 'Deal::d1').allow).toBe(true);
    expect(call('MANAGER', 'user::delete', 'User::u1').allow).toBe(false);
    expect(call('MANAGER', 'sso::update', 'SsoConfig::s1').allow).toBe(false);
  });

  it('AGENT can write their own deals/contacts/tasks but not others', () => {
    expect(call('AGENT', 'deal::update', 'Deal::d1', { isOwner: true }).allow).toBe(true);
    expect(call('AGENT', 'deal::update', 'Deal::d1', { isOwner: false }).allow).toBe(false);
    expect(call('AGENT', 'invoice::update', 'Invoice::i1', { isOwner: true }).allow).toBe(false);
    expect(call('AGENT', 'contact::read', 'Contact::c1').allow).toBe(true);
  });

  it('VIEWER is read-only', () => {
    expect(call('VIEWER', 'deal::read', 'Deal::d1').allow).toBe(true);
    expect(call('VIEWER', 'deal::update', 'Deal::d1').allow).toBe(false);
  });

  it('owner-only actions are denied for non-owner roles', () => {
    expect(call('ADMIN', 'tenant::delete', 'Tenant::t1').allow).toBe(false);
    expect(call('MANAGER', 'billing::cancel-subscription', 'BillingSubscription::b1').allow).toBe(false);
  });
});
