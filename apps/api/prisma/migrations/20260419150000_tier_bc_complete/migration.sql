-- Migration: Tier B+C complete — MRR, validation rules, formula fields,
-- product bundles/variants, commissions, territories, chatter, events.
-- Created: 2026-04-19

-- Company parent_id (self-referencing hierarchy)
ALTER TABLE companies ADD COLUMN IF NOT EXISTS parent_id TEXT;
CREATE INDEX IF NOT EXISTS idx_companies_parent_id ON companies(parent_id);

-- ── Customer subscriptions (MRR/ARR tracking) ───────────────────────────────
CREATE TABLE customer_subscriptions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  name TEXT NOT NULL,
  plan TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  mrr DECIMAL(14,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'RON',
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_customer_subs_tenant_status ON customer_subscriptions(tenant_id, status);
CREATE INDEX idx_customer_subs_tenant_company ON customer_subscriptions(tenant_id, company_id);

-- ── Validation rules ────────────────────────────────────────────────────────
CREATE TABLE validation_rules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  field TEXT NOT NULL,
  operator TEXT NOT NULL,
  value TEXT NOT NULL,
  error_message TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_validation_rules_tenant_entity ON validation_rules(tenant_id, entity_type, is_active);

-- ── Formula fields ──────────────────────────────────────────────────────────
CREATE TABLE formula_fields (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  field_name TEXT NOT NULL,
  expression TEXT NOT NULL,
  return_type TEXT NOT NULL DEFAULT 'STRING',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, entity_type, field_name)
);

-- ── Product variants ────────────────────────────────────────────────────────
CREATE TABLE product_variants (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  price DECIMAL(14,2),
  stock_qty INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, sku)
);
CREATE INDEX idx_product_variants_product ON product_variants(product_id);

-- ── Product bundles ─────────────────────────────────────────────────────────
CREATE TABLE product_bundles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  price DECIMAL(14,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'RON',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE product_bundle_items (
  id TEXT PRIMARY KEY,
  bundle_id TEXT NOT NULL REFERENCES product_bundles(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_product_bundle_items_bundle ON product_bundle_items(bundle_id);

-- ── Sales commissions ───────────────────────────────────────────────────────
CREATE TABLE commission_plans (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  percent DECIMAL(5,2) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE commissions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  deals_count INTEGER NOT NULL DEFAULT 0,
  basis DECIMAL(14,2) NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'RON',
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, user_id, year, month)
);

-- ── Territories (Tier C) ────────────────────────────────────────────────────
CREATE TABLE territories (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  counties TEXT[] NOT NULL DEFAULT '{}',
  industries TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE territory_assignments (
  id TEXT PRIMARY KEY,
  territory_id TEXT NOT NULL REFERENCES territories(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(territory_id, user_id)
);

-- ── Chatter (Tier C) ────────────────────────────────────────────────────────
CREATE TABLE chatter_posts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  body TEXT NOT NULL,
  mentions TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_chatter_subject ON chatter_posts(tenant_id, subject_type, subject_id, created_at);

-- ── Events (Tier C) ─────────────────────────────────────────────────────────
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  kind TEXT NOT NULL DEFAULT 'CONFERENCE',
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  location TEXT,
  capacity INTEGER,
  created_by_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_events_tenant_start ON events(tenant_id, start_at);

CREATE TABLE event_attendees (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  contact_id TEXT,
  client_id TEXT,
  email TEXT,
  full_name TEXT,
  status TEXT NOT NULL DEFAULT 'INVITED',
  registered_at TIMESTAMPTZ,
  attended_at TIMESTAMPTZ
);
CREATE INDEX idx_event_attendees_event ON event_attendees(event_id);

-- ── RLS policies ────────────────────────────────────────────────────────────
-- Enable RLS on all tenant-scoped tables added in this migration.
ALTER TABLE customer_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE validation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE formula_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE territories ENABLE ROW LEVEL SECURITY;
ALTER TABLE chatter_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

CREATE POLICY p_tenant_isolation ON customer_subscriptions USING (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY p_tenant_isolation ON validation_rules USING (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY p_tenant_isolation ON formula_fields USING (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY p_tenant_isolation ON product_variants USING (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY p_tenant_isolation ON product_bundles USING (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY p_tenant_isolation ON commission_plans USING (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY p_tenant_isolation ON commissions USING (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY p_tenant_isolation ON territories USING (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY p_tenant_isolation ON chatter_posts USING (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY p_tenant_isolation ON events USING (tenant_id = current_setting('app.tenant_id', true));
