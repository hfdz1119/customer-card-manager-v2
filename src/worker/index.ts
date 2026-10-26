import { z } from 'zod';
import { PLAN_COST_CENTS, PLAN_LABELS, businessDate, csvDocument, daysBetween, expiryStatus, isISODate } from '../lib/shared';
import { clearSessionCookie, clientIpHash, getSession, login } from './auth';
import type { CustomerRow, Env, PurchaseRow } from './types';

const planSchema = z.enum(['monthly', 'quarterly', 'annual', 'whitelist']);
const customerSchema = z.object({ name: z.string().trim().min(1).max(120), contact: z.string().trim().max(200).optional().nullable(), notes: z.string().trim().max(2000).optional().nullable() });
const purchaseSchema = z.object({ customer_id: z.string().uuid(), plan: planSchema, purchased_on: z.string().refine(isISODate), expires_on: z.string().refine(isISODate).nullable().optional(), selling_price_cents: z.number().int().min(0).max(100_000_000).nullable().optional(), notes: z.string().trim().max(2000).optional().nullable() });
const idSchema = z.string().uuid();
const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: jsonHeaders });
const error = (message: string, status = 400) => json({ error: message }, status);
const nowIso = () => new Date().toISOString();
function sameOrigin(request: Request): boolean { const origin = request.headers.get('Origin'); return !!origin && origin === new URL(request.url).origin; }
function isMutation(request: Request): boolean { return !['GET', 'HEAD', 'OPTIONS'].includes(request.method); }
function statusCounts(rows: CustomerRow[], today: string) {
  const counts = { active: 0, upcoming: 0, expired: 0, no_expiry: 0 };
  for (const row of rows) {
    const status = expiryStatus(row.last_expiry, today);
    if (status === 'no_expiry') counts.no_expiry += 1;
    else if (status === 'expired') counts.expired += 1;
    else {
      // Active means expiration is today or later; due-soon is a separate overlapping count.
      counts.active += 1;
      if (status === 'upcoming') counts.upcoming += 1;
    }
  }
  return counts;
}
function sessionCookie(headers: Headers, cookie: string) { headers.append('Set-Cookie', cookie); }
function validateCsrf(request: Request, csrf: string): boolean { return sameOrigin(request) && request.headers.get('X-CSRF-Token') === csrf; }
async function listCustomers(env: Env): Promise<CustomerRow[]> {
  const result = await env.DB.prepare(`SELECT c.id,c.name,c.contact,c.notes,c.created_at,c.updated_at,
    MAX(p.expires_on) AS last_expiry, COUNT(p.id) AS purchase_count
    FROM customers c LEFT JOIN purchases p ON p.customer_id=c.id
    GROUP BY c.id ORDER BY c.updated_at DESC`).all<CustomerRow>();
  return result.results ?? [];
}
async function handleApi(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return error('数据库 DB 尚未绑定，请先绑定 D1 后重新部署。', 503);
  if (!env.ADMIN_PASSWORD_HASH || !env.ADMIN_PASSWORD_HASH.startsWith('pbkdf2$sha256$')) return error('管理员密码尚未初始化。请在部署环境设置 ADMIN_PASSWORD_HASH。', 503);
  const url = new URL(request.url); const path = url.pathname.replace(/\/$/, '') || '/';
  if (path === '/api/auth/status' && request.method === 'GET') {
    const session = await getSession(request, env); return json({ authenticated: !!session, csrf: session?.csrf ?? null });
  }
  if (path === '/api/auth/login' && request.method === 'POST') {
    if (!sameOrigin(request)) return error('请求来源无效。', 403);
    const ipHash = await clientIpHash(request, env); const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare('DELETE FROM login_attempts WHERE window_started_at < ?').bind(now - 86_400).run();
    const attempt = await env.DB.prepare('SELECT attempts,locked_until FROM login_attempts WHERE ip_hash=?').bind(ipHash).first<{ attempts: number; locked_until: number }>();
    if (attempt && attempt.locked_until > now) return error('登录尝试过多，请稍后再试。', 429);
    const session = await login(request, env);
    if (!session) {
      await env.DB.prepare(`INSERT INTO login_attempts (ip_hash,attempts,window_started_at,locked_until) VALUES (?,1,?,0)
        ON CONFLICT(ip_hash) DO UPDATE SET attempts=CASE WHEN window_started_at < ? THEN 1 ELSE attempts+1 END,
        window_started_at=CASE WHEN window_started_at < ? THEN ? ELSE window_started_at END,
        locked_until=CASE WHEN (CASE WHEN window_started_at < ? THEN 1 ELSE attempts+1 END)>=8 THEN ? ELSE 0 END`)
        .bind(ipHash, now, now - 900, now - 900, now, now - 900, now + 900).run();
      return error('登录失败，请检查密码后重试。', 401);
    }
    await env.DB.prepare('DELETE FROM login_attempts WHERE ip_hash=?').bind(ipHash).run();
    const response = json({ authenticated: true, csrf: session.csrf }); sessionCookie(response.headers, session.cookie); return response;
  }
  const current = await getSession(request, env);
  if (path === '/api/auth/logout' && request.method === 'POST') {
    if (!current) return json({ ok: true });
    if (!validateCsrf(request, current.csrf)) return error('请求校验失败，请刷新后重试。', 403);
    const response = json({ ok: true }); sessionCookie(response.headers, clearSessionCookie()); return response;
  }
  if (!current) return error('请先登录。', 401);
  if (isMutation(request) && !validateCsrf(request, current.csrf)) return error('请求校验失败，请刷新后重试。', 403);

  if (path === '/api/dashboard' && request.method === 'GET') {
    const today = businessDate(new Date(), 'Asia/Shanghai');
    const customers = await listCustomers(env);
    const totals = await env.DB.prepare(`SELECT COALESCE(SUM(selling_price_cents),0) sales,
      COALESCE(SUM(CASE WHEN selling_price_cents IS NOT NULL THEN selling_price_cents-cost_snapshot_cents ELSE 0 END),0) profit,
      SUM(CASE WHEN selling_price_cents IS NULL THEN 1 ELSE 0 END) missing FROM purchases`).first<{ sales: number; profit: number; missing: number }>();
    return json({ today, customers: customers.length, statuses: statusCounts(customers, today), sales_cents: totals?.sales ?? 0, profit_cents: totals?.profit ?? 0, missing_prices: totals?.missing ?? 0 });
  }
  if (path === '/api/customers' && request.method === 'GET') {
    const search = url.searchParams.get('search')?.trim().slice(0, 200) || '';
    const filter = url.searchParams.get('status') || '';
    const today = businessDate(new Date(), 'Asia/Shanghai');
    const rows = await listCustomers(env);
    const results = rows.filter((r) => { const statusMatch = !filter || (filter === 'active' ? !!r.last_expiry && r.last_expiry >= today : expiryStatus(r.last_expiry, today) === filter); return (!search || `${r.name} ${r.contact ?? ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) && statusMatch; });
    return json(results);
  }
  const customerMatch = path.match(/^\/api\/customers\/([^/]+)$/);
  if (customerMatch) {
    const id = idSchema.safeParse(customerMatch[1]); if (!id.success) return error('客户编号无效。');
    if (request.method === 'GET') {
      const customer = await env.DB.prepare('SELECT c.*,MAX(p.expires_on) last_expiry,COUNT(p.id) purchase_count FROM customers c LEFT JOIN purchases p ON p.customer_id=c.id WHERE c.id=? GROUP BY c.id').bind(id.data).first();
      if (!customer) return error('客户不存在。', 404);
      const purchases = await env.DB.prepare('SELECT * FROM purchases WHERE customer_id=? ORDER BY purchased_on DESC,created_at DESC').bind(id.data).all<PurchaseRow>();
      return json({ customer, purchases: purchases.results ?? [] });
    }
    if (request.method === 'PATCH') {
      const parsed = customerSchema.partial().safeParse(await request.json().catch(() => null)); if (!parsed.success) return error('客户资料无效。');
      const old = await env.DB.prepare('SELECT id FROM customers WHERE id=?').bind(id.data).first(); if (!old) return error('客户不存在。', 404);
      const fields = parsed.data; const sets: string[] = []; const values: unknown[] = [];
      for (const key of ['name','contact','notes'] as const) if (Object.hasOwn(fields,key)) { sets.push(`${key}=?`); values.push(fields[key] ?? null); }
      if (!sets.length) return json({ ok: true, changes: 0 });
      sets.push('updated_at=?'); values.push(nowIso(),id.data);
      const update = await env.DB.prepare(`UPDATE customers SET ${sets.join(',')} WHERE id=?`).bind(...values).run();
      return json({ ok: true, changes: update.meta.changes });
    }
    if (request.method === 'DELETE') {
      await env.DB.prepare('DELETE FROM customers WHERE id=?').bind(id.data).run(); return json({ ok: true });
    }
  }
  if (path === '/api/purchases' && request.method === 'GET') {
    const search = url.searchParams.get('search')?.trim().slice(0, 200) || '';
    const plan = planSchema.safeParse(url.searchParams.get('plan'));
    const from = url.searchParams.get('from'); const to = url.searchParams.get('to');
    const where = ['1=1']; const binds: unknown[] = [];
    if (search) { where.push('(c.name LIKE ? OR COALESCE(c.contact,\'\') LIKE ?)'); binds.push(`%${search}%`,`%${search}%`); }
    if (plan.success) { where.push('p.plan=?'); binds.push(plan.data); }
    if (from && isISODate(from)) { where.push('p.purchased_on>=?'); binds.push(from); }
    if (to && isISODate(to)) { where.push('p.purchased_on<=?'); binds.push(to); }
    const result = await env.DB.prepare(`SELECT p.*,c.name customer_name,c.contact FROM purchases p JOIN customers c ON c.id=p.customer_id WHERE ${where.join(' AND ')} ORDER BY p.purchased_on DESC`).bind(...binds).all<PurchaseRow>();
    return json(result.results ?? []);
  }
  const purchaseMatch = path.match(/^\/api\/purchases\/([^/]+)$/);
  if (purchaseMatch) {
    const id = idSchema.safeParse(purchaseMatch[1]); if (!id.success) return error('订单编号无效。');
    if (request.method === 'PATCH') {
      const parsed = purchaseSchema.partial().safeParse(await request.json().catch(() => null)); if (!parsed.success) return error('购买记录无效。');
      const old = await env.DB.prepare('SELECT * FROM purchases WHERE id=?').bind(id.data).first<PurchaseRow>(); if (!old) return error('购买记录不存在。', 404);
      const p = parsed.data; const sets: string[] = []; const values: unknown[] = [];
      for (const key of ['customer_id','plan','purchased_on','expires_on','selling_price_cents','notes'] as const) if (Object.hasOwn(p,key)) { sets.push(`${key}=?`); values.push(p[key] ?? null); }
      if (Object.hasOwn(p,'plan')) { sets.push('cost_snapshot_cents=?'); values.push(PLAN_COST_CENTS[p.plan!]); }
      if (!sets.length) return json({ ok: true });
      values.push(id.data); await env.DB.prepare(`UPDATE purchases SET ${sets.join(',')} WHERE id=?`).bind(...values).run();
      return json({ ok: true });
    }
    if (request.method === 'DELETE') { await env.DB.prepare('DELETE FROM purchases WHERE id=?').bind(id.data).run(); return json({ ok: true }); }
  }
  if (path === '/api/purchases' && request.method === 'POST') {
    const parsed = purchaseSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return error('购买记录无效。');
    const id = crypto.randomUUID(); const p = parsed.data;
    await env.DB.prepare(`INSERT INTO purchases(id,customer_id,plan,purchased_on,expires_on,selling_price_cents,cost_snapshot_cents,notes,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
      .bind(id,p.customer_id,p.plan,p.purchased_on,p.expires_on ?? null,p.selling_price_cents ?? null,PLAN_COST_CENTS[p.plan],p.notes ?? null,nowIso()).run();
    return json({ id }, 201);
  }
  if (path === '/api/customers' && request.method === 'POST') {
    const parsed = customerSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return error('客户资料无效。');
    const id = crypto.randomUUID(); const now = nowIso(); const c = parsed.data;
    await env.DB.prepare('INSERT INTO customers(id,name,contact,notes,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(id,c.name,c.contact ?? null,c.notes ?? null,now,now).run();
    return json({ id }, 201);
  }
  if (path === '/api/expiry' && request.method === 'GET') {
    const kind = url.searchParams.get('status'); const today = businessDate(new Date(), 'Asia/Shanghai');
    let where = 'p.expires_on IS NOT NULL'; if (kind === 'upcoming') where += ` AND p.expires_on>? AND p.expires_on<=?`; else if (kind === 'expired') where += ' AND p.expires_on<?';
    let query = `SELECT p.*,c.name customer_name,c.contact FROM purchases p JOIN customers c ON c.id=p.customer_id WHERE ${where} ORDER BY p.expires_on ASC`;
    let result;
    if (kind === 'upcoming') result = await env.DB.prepare(query).bind(today,todayPlus(today,7)).all<PurchaseRow>();
    else if (kind === 'expired') result = await env.DB.prepare(query).bind(today).all<PurchaseRow>();
    else result = await env.DB.prepare(query).all<PurchaseRow>();
    return json((result.results ?? []).map((r) => ({ ...r, days_remaining: daysBetween(r.expires_on!, today) })));
  }
  if (path === '/api/export/customers' && request.method === 'GET') {
    const rows = await env.DB.prepare(`SELECT c.id,c.name,c.contact,c.notes,c.created_at,c.updated_at,MAX(p.expires_on) last_expiry,COUNT(p.id) purchase_count FROM customers c LEFT JOIN purchases p ON c.id=p.customer_id GROUP BY c.id ORDER BY c.name`).all<CustomerRow>();
    return csvResponse('customers.csv', csvDocument(['客户编号','姓名','联系方式','备注','最近到期日','购买记录数','创建时间','更新时间'], (rows.results ?? []).map((r) => [r.id,r.name,r.contact,r.notes,r.last_expiry,r.purchase_count,r.created_at,r.updated_at])));
  }
  if (path === '/api/export/purchases' && request.method === 'GET') {
    const rows = await env.DB.prepare(`SELECT p.*,c.name customer_name,c.contact FROM purchases p JOIN customers c ON c.id=p.customer_id ORDER BY p.purchased_on DESC`).all<PurchaseRow>();
    return csvResponse('purchases.csv', csvDocument(['客户姓名','联系方式','卡类型','购买日期','到期日期','售价(元)','成本(元)','利润(元)','备注'], (rows.results ?? []).map((r) => [r.customer_name,r.contact,PLAN_LABELS[r.plan],r.purchased_on,r.expires_on,money(r.selling_price_cents),money(r.cost_snapshot_cents),r.selling_price_cents === null ? '待补录' : money(r.selling_price_cents-r.cost_snapshot_cents),r.notes])));
  }
  return error('没有找到这个接口。', 404);
}
function money(cents: number | null): string { return cents === null ? '' : (cents / 100).toFixed(2); }
function todayPlus(date: string, days: number): string { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10); }
function csvResponse(filename: string, text: string): Response { return new Response(text,{headers:{'content-type':'text/csv; charset=utf-8','content-disposition':`attachment; filename="${filename}"`,'cache-control':'no-store','x-content-type-options':'nosniff'}}); }
export default { async fetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(request,env);
    const asset = await env.ASSETS.fetch(request);
    const headers = new Headers(asset.headers);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('X-Frame-Options', 'DENY');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
    return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers });
  } catch {
    return error('服务暂时无法完成请求，请稍后重试；如持续发生，请检查数据库绑定和迁移。', 500);
  }
} };
