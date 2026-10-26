-- Initial schema for standalone v2. Safe to apply once via Wrangler; all CREATEs are idempotent.
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  contact TEXT CHECK (contact IS NULL OR length(contact) <= 200),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 2000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
CREATE INDEX IF NOT EXISTS idx_customers_contact ON customers(contact);
CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK (plan IN ('monthly', 'quarterly', 'annual', 'whitelist')),
  purchased_on TEXT NOT NULL CHECK (length(purchased_on) = 10),
  expires_on TEXT CHECK (expires_on IS NULL OR length(expires_on) = 10),
  selling_price_cents INTEGER CHECK (selling_price_cents IS NULL OR selling_price_cents >= 0),
  cost_snapshot_cents INTEGER NOT NULL CHECK (cost_snapshot_cents >= 0),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 2000),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchases_customer ON purchases(customer_id);
CREATE INDEX IF NOT EXISTS idx_purchases_expiry ON purchases(expires_on);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(purchased_on);
CREATE INDEX IF NOT EXISTS idx_purchases_plan ON purchases(plan);
CREATE TABLE IF NOT EXISTS login_attempts (
  ip_hash TEXT PRIMARY KEY NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_started_at INTEGER NOT NULL,
  locked_until INTEGER NOT NULL DEFAULT 0
);
