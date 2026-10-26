/// <reference types="@cloudflare/workers-types" />
export interface Env { DB: D1Database; ASSETS: Fetcher; ADMIN_PASSWORD_HASH?: string }
export interface CustomerRow { id: string; name: string; contact: string | null; notes: string | null; created_at: string; updated_at: string; last_expiry: string | null; purchase_count: number; }
export interface PurchaseRow { id: string; customer_id: string; customer_name?: string; contact?: string | null; plan: 'monthly'|'quarterly'|'annual'|'whitelist'; purchased_on: string; expires_on: string | null; selling_price_cents: number | null; cost_snapshot_cents: number; notes: string | null; created_at: string; }
