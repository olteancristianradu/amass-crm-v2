-- Migration: S53 Leads + S54 Contracts + S55 Forecasting + Company hierarchy
-- Created: 2026-04-18

-- leads table
CREATE TABLE leads (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  company TEXT,
  job_title TEXT,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'NEW',
  score INTEGER NOT NULL DEFAULT 0,
  owner_id TEXT,
  notes TEXT,
  converted_at TIMESTAMPTZ,
  converted_to_contact_id TEXT,
  converted_to_company_id TEXT,
  converted_to_deal_id TEXT,
  created_by_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_leads_tenant_status ON leads(tenant_id, status);
CREATE INDEX idx_leads_tenant_owner ON leads(tenant_id, owner_id);
CREATE INDEX idx_leads_tenant_created ON leads(tenant_id, created_at);

-- company hierarchy (parent → subsidiaries)
ALTER TABLE companies ADD COLUMN IF NOT EXISTS parent_id TEXT REFERENCES companies(id);
CREATE INDEX IF NOT EXISTS idx_companies_parent ON companies(parent_id);

-- contracts table
CREATE TABLE contracts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  value DECIMAL(14,2),
  currency TEXT NOT NULL DEFAULT 'RON',
  status TEXT NOT NULL DEFAULT 'DRAFT',
  signed_at TIMESTAMPTZ,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  renewal_date TIMESTAMPTZ,
  auto_renew BOOLEAN NOT NULL DEFAULT FALSE,
  storage_key TEXT,
  created_by_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_contracts_tenant_company ON contracts(tenant_id, company_id);
CREATE INDEX idx_contracts_tenant_status ON contracts(tenant_id, status);
CREATE INDEX idx_contracts_end_date ON contracts(tenant_id, end_date);

-- forecast_quotas table
CREATE TABLE forecast_quotas (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  year INTEGER NOT NULL,
  period INTEGER NOT NULL,
  period_type TEXT NOT NULL DEFAULT 'MONTHLY',
  quota DECIMAL(14,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'RON',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, user_id, year, period, period_type)
);
