import { beforeEach, describe, expect, it } from 'vitest';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import worker from '../src/worker/index';
import type { Env } from '../src/worker/types';

type Row = Record<string, unknown>;
class Statement {
  values: unknown[]=[];
  constructor(public sql:string,private db:FakeDb){}
  bind(...values:unknown[]){this.values=values;return this;}
  async first<T>():Promise<T|null>{return this.db.first<T>(this.sql,this.values);}
  async all<T>():Promise<{results:T[]}>{return {results:this.db.all<T>(this.sql,this.values)};}
  async run(){return this.db.run(this.sql,this.values);}
}
class FakeDb {
  customers=new Map<string,Row>(); purchases=new Map<string,Row>(); attempts=new Map<string,{attempts:number;locked_until:number;window_started_at:number}>();
  prepare(sql:string){return new Statement(sql,this);}
  first<T>(sql:string,v:unknown[]):T|null{
    if(sql.includes('FROM login_attempts'))return (this.attempts.get(String(v[0])) as T)||null;
    if(sql.includes('FROM customers') && sql.includes('WHERE'))return (this.customers.get(String(v[v.length-1])) as T)||null;
    if(sql.includes('FROM purchases WHERE id=?'))return (this.purchases.get(String(v[0])) as T)||null;
    if(sql.includes('FROM purchases')){
      const rows=[...this.purchases.values()];return {sales:rows.reduce((n,p)=>n+Number(p.selling_price_cents||0),0),profit:rows.reduce((n,p)=>n+(p.selling_price_cents===null?0:Number(p.selling_price_cents)-Number(p.cost_snapshot_cents)),0),missing:rows.filter(p=>p.selling_price_cents===null).length} as T;
    }
    return null;
  }
  all<T>(sql:string,v:unknown[]=[]):T[]{
    if(sql.includes('FROM customers c LEFT JOIN purchases'))return [...this.customers.values()].map(c=>{const ps=[...this.purchases.values()].filter(p=>p.customer_id===c.id);return {...c,last_expiry:ps.map(p=>p.expires_on).filter(Boolean).sort().at(-1)??null,purchase_count:ps.length};}) as T[];
    if(sql.includes('FROM purchases WHERE customer_id=?'))return [...this.purchases.values()].filter(p=>p.customer_id===v[0]).sort((a,b)=>String(b.purchased_on).localeCompare(String(a.purchased_on))) as T[];
    if(sql.includes('FROM purchases p JOIN customers c'))return [...this.purchases.values()].flatMap(p=>{const c=this.customers.get(String(p.customer_id));return c?[{...p,customer_name:c.name,contact:c.contact}]:[]}) as T[];
    return [];
  }
  run(sql:string,v:unknown[]){
    if(sql.startsWith('DELETE FROM login_attempts'))this.attempts.delete(String(v[0]));
    else if(sql.startsWith('INSERT INTO login_attempts')){const key=String(v[0]);const now=Number(v[1]);const old=this.attempts.get(key);const fresh=!old||old.window_started_at<Number(v[2]);const attempts=fresh?1:old.attempts+1;this.attempts.set(key,{attempts,window_started_at:fresh?now:old.window_started_at,locked_until:attempts>=8?now+900:0});}
    else if(sql.startsWith('INSERT INTO customers'))this.customers.set(String(v[0]),{id:v[0],name:v[1],contact:v[2],notes:v[3],created_at:v[4],updated_at:v[5]});
    else if(sql.startsWith('UPDATE customers SET')){const id=String(v[v.length-1]);const c=this.customers.get(id);if(c){const cols=sql.slice('UPDATE customers SET '.length,sql.indexOf(' WHERE')).split(',').map(x=>x.split('=')[0]);cols.forEach((key,i)=>c[key]=v[i]);}}
    else if(sql.startsWith('DELETE FROM customers')){const id=String(v[0]);this.customers.delete(id);for(const [key,p] of this.purchases)if(p.customer_id===id)this.purchases.delete(key);}
    else if(sql.startsWith('INSERT INTO purchases'))this.purchases.set(String(v[0]),{id:v[0],customer_id:v[1],plan:v[2],purchased_on:v[3],expires_on:v[4],selling_price_cents:v[5],cost_snapshot_cents:v[6],notes:v[7],created_at:v[8]});
    else if(sql.startsWith('UPDATE purchases SET')){const id=String(v[v.length-1]);const p=this.purchases.get(id);if(p){const cols=sql.slice('UPDATE purchases SET '.length,sql.indexOf(' WHERE')).split(',').map(x=>x.split('=')[0]);cols.forEach((key,i)=>p[key]=v[i]);}}
    else if(sql.startsWith('DELETE FROM purchases'))this.purchases.delete(String(v[0]));
    return {success:true,meta:{changes:1}};
  }
}
const password='correct-horse-battery-staple-2026';
const salt=randomBytes(18);const hash=`pbkdf2$sha256$310000$${salt.toString('base64url')}$${pbkdf2Sync(password,salt,310000,32,'sha256').toString('base64url')}`;
let db:FakeDb;let env:Env;
function req(path:string,method='GET',body?:unknown,cookie?:string,csrf?:string){const headers=new Headers();if(body)headers.set('Content-Type','application/json');if(method!=='GET')headers.set('Origin','https://unit.test');if(body)headers.set('Origin','https://unit.test');if(cookie)headers.set('Cookie',cookie);if(csrf)headers.set('X-CSRF-Token',csrf);return new Request(`https://unit.test${path}`,{method,headers,body:body?JSON.stringify(body):undefined});}
async function login(){const r=await worker.fetch(req('/api/auth/login','POST',{password}),env);expect(r.status).toBe(200);const cookie=r.headers.get('Set-Cookie')!;const data=await r.json() as {csrf:string};return {cookie:cookie.split(';')[0],csrf:data.csrf,fullCookie:cookie};}
beforeEach(()=>{db=new FakeDb();env={DB:db as unknown as D1Database,ASSETS:{} as Fetcher,ADMIN_PASSWORD_HASH:hash};});
describe('会话与登录 API',()=>{
 it('有效密码可登录并设置安全会话 Cookie',async()=>{const s=await login();expect(s.fullCookie).toContain('HttpOnly');expect(s.fullCookie).toContain('Secure');expect(s.fullCookie).toContain('SameSite=Strict');});
 it('错误密码拒绝登录且通用提示',async()=>{const r=await worker.fetch(req('/api/auth/login','POST',{password:'wrong'}),env);expect(r.status).toBe(401);expect(await r.json()).toEqual({error:'登录失败，请检查密码后重试。'});});
 it('连续八次错误后暂时锁定该来源',async()=>{for(let i=0;i<8;i++){const r=await worker.fetch(req('/api/auth/login','POST',{password:'wrong'}),env);expect(r.status).toBe(401);}const locked=await worker.fetch(req('/api/auth/login','POST',{password}),env);expect(locked.status).toBe(429);});
 it('未登录访问业务 API 返回 401',async()=>{const r=await worker.fetch(req('/api/dashboard'),env);expect(r.status).toBe(401);});
 it('首次部署未设置管理员 Secret 时公开状态并拒绝业务 API',async()=>{const unset={DB:db as unknown as D1Database,ASSETS:{} as Fetcher};const status=await worker.fetch(req('/api/auth/status'),unset);expect(await status.json()).toEqual({authenticated:false,configured:false,csrf:null});const protectedResponse=await worker.fetch(req('/api/dashboard'),unset);expect(protectedResponse.status).toBe(503);});
 it('运行时只接受 PBKDF2-SHA256 Secret；不接受明文密码 Secret',async()=>{const plain={DB:db as unknown as D1Database,ASSETS:{} as Fetcher,ADMIN_PASSWORD:password} as unknown as Env;const status=await worker.fetch(req('/api/auth/status'),plain);expect(await status.json()).toMatchObject({configured:false});const response=await worker.fetch(req('/api/auth/login','POST',{password}),plain);expect(response.status).toBe(503);});
 it('缺失或格式错误的哈希 Secret 时 fail closed，包括伪造会话 Cookie',async()=>{for(const hash of [undefined,'not-a-hash','pbkdf2$sha256$10$c2FsdA$YWJj']){const invalid={DB:db as unknown as D1Database,ASSETS:{} as Fetcher,...(hash?{ADMIN_PASSWORD_HASH:hash}:{})};const status=await worker.fetch(req('/api/auth/status'),invalid);expect(await status.json()).toMatchObject({configured:false});const protectedResponse=await worker.fetch(req('/api/dashboard','GET',undefined,'__Host-allowlist_session=eyJleHAiOjQwMDAwMDAwMDAsImNzcmYiOiJ4In0.abc'),invalid);expect(protectedResponse.status).toBe(503);}});
 it('拒绝跨站登录请求',async()=>{const r=new Request('https://unit.test/api/auth/login',{method:'POST',headers:{Origin:'https://attacker.test','Content-Type':'application/json'},body:JSON.stringify({password})});expect((await worker.fetch(r,env)).status).toBe(403);});
 it('拒绝缺少 CSRF 校验的写请求',async()=>{const s=await login();const r=await worker.fetch(req('/api/customers','POST',{name:'测试客户'},s.cookie),env);expect(r.status).toBe(403);});
});
describe('客户和购买 API',()=>{
 it('支持客户新增、读取、编辑和级联删除',async()=>{const s=await login();const create=await worker.fetch(req('/api/customers','POST',{name:'测试客户',contact:'test@example.test',notes:'仅用于自动化测试'},s.cookie,s.csrf),env);expect(create.status).toBe(201);const {id}=await create.json() as {id:string};expect(db.customers.get(id)?.name).toBe('测试客户');
 const read=await worker.fetch(req(`/api/customers/${id}`,'GET',undefined,s.cookie),env);expect(read.status).toBe(200);expect((await read.json() as {customer:{name:string}}).customer.name).toBe('测试客户');
 const edit=await worker.fetch(req(`/api/customers/${id}`,'PATCH',{name:'已编辑',contact:null},s.cookie,s.csrf),env);expect(edit.status).toBe(200);expect(db.customers.get(id)?.name).toBe('已编辑');expect(db.customers.get(id)?.contact).toBeNull();
 const createPurchase=await worker.fetch(req('/api/purchases','POST',{customer_id:id,plan:'monthly',purchased_on:'2026-10-01',expires_on:'2026-11-01',selling_price_cents:2000},s.cookie,s.csrf),env);expect(createPurchase.status).toBe(201);const purchase=await createPurchase.json() as {id:string};expect(db.purchases.get(purchase.id)?.cost_snapshot_cents).toBe(600);
 const dashboard=await worker.fetch(req('/api/dashboard','GET',undefined,s.cookie),env);expect(await dashboard.json()).toMatchObject({sales_cents:2000,profit_cents:1400,missing_prices:0});
 const remove=await worker.fetch(req(`/api/customers/${id}`,'DELETE',undefined,s.cookie,s.csrf),env);expect(remove.status).toBe(200);expect(db.customers.has(id)).toBe(false);expect(db.purchases.has(purchase.id)).toBe(false);
 });
 it('未知售价显示为待补录且不计入销售额和利润',async()=>{const s=await login();const cr=await worker.fetch(req('/api/customers','POST',{name:'历史客户'},s.cookie,s.csrf),env);const {id}=await cr.json() as {id:string};const r=await worker.fetch(req('/api/purchases','POST',{customer_id:id,plan:'annual',purchased_on:'2026-01-01',selling_price_cents:null},s.cookie,s.csrf),env);expect(r.status).toBe(201);const list=await worker.fetch(req('/api/purchases','GET',undefined,s.cookie),env);const rows=await list.json() as Array<{selling_price_cents:number|null;cost_snapshot_cents:number}>;expect(rows[0].selling_price_cents).toBeNull();expect(rows[0].cost_snapshot_cents).toBe(6000);const dashboard=await worker.fetch(req('/api/dashboard','GET',undefined,s.cookie),env);expect(await dashboard.json()).toMatchObject({sales_cents:0,profit_cents:0,missing_prices:1});});
 it('仪表盘按自然日统计有效、即将到期、已到期和无到期日期客户',async()=>{
  const s=await login();
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const shift=(days:number)=>{const d=new Date(`${today}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
  for(const [name,expires] of [['今天',shift(0)],['七天内',shift(7)],['更远',shift(8)],['已过期',shift(-1)],['无日期',null]] as const){
    const id=crypto.randomUUID();db.customers.set(id,{id,name,contact:null,notes:null,created_at:today,updated_at:today});
    if(expires){const purchaseId=crypto.randomUUID();db.purchases.set(purchaseId,{id:purchaseId,customer_id:id,plan:'monthly',purchased_on:today,expires_on:expires,selling_price_cents:null,cost_snapshot_cents:600,created_at:today});}
  }
  const response=await worker.fetch(req('/api/dashboard','GET',undefined,s.cookie),env);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({customers:5,statuses:{active:3,upcoming:1,expired:1,no_expiry:1}});
 });

});
