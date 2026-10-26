import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
const wrangler = path.resolve('node_modules/wrangler/bin/wrangler.js');
function run(args, { capture = false } = {}) {
  const result = spawnSync(process.execPath, [wrangler, ...args], { encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', env: { ...process.env, CI: '1' } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`wrangler ${args[0]} ${args[1] || ''} 失败。请先检查登录状态和命令提示。`);
  return capture ? (result.stdout || '') : '';
}
function parseJson(text) { const i = text.indexOf('['); if (i < 0) return null; try { return JSON.parse(text.slice(i)); } catch { return null; } }
async function confirmExistingDatabase(name, id) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error(`账号里已有名为 ${name} 的 D1，但本机没有保存此前确认的数据库 ID。请在交互式终端重跑，并确认它确实是本项目专用库；未应用迁移。`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(`找到已有 D1「${name}」（ID 末尾 ${id.slice(-8)}）。确认它是本项目专用数据库并继续？输入 y 确认：`)).trim().toLowerCase() === 'y'; }
  finally { rl.close(); }
}
function runLocalCheck() {
  // npm_execpath is set by npm/pnpm/yarn scripts; invoking it with Node avoids Windows .cmd spawn failures.
  const packageManager = process.env.npm_execpath;
  const command = packageManager ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const args = packageManager ? [packageManager, 'run', 'check'] : ['run', 'check'];
  const r = spawnSync(command, args, { stdio: 'inherit', env: { ...process.env, CI: '1' }, shell: !packageManager && process.platform === 'win32' });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error('本地检查未通过；尚未访问或修改 Cloudflare 资源。');
}
function extractCreatedId(text) { const direct = text.match(/"(?:uuid|database_id)"\s*:\s*"([a-f0-9-]{36})"/i); if (direct) return direct[1]; const any = text.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i); return any?.[1] || null; }
const createOnly = process.argv.includes('--create-only'); const migrateOnly = process.argv.includes('--migrate-only');
try {
  runLocalCheck();
  run(['whoami']);
  const base = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
  const db = base.d1_databases?.find(x => x.binding === 'DB'); if (!db) throw new Error('wrangler.jsonc 缺少 DB 绑定模板。');
  let rememberedId = null;
  try { const prior = JSON.parse(await readFile('wrangler.deploy.jsonc', 'utf8')); rememberedId = prior.d1_databases?.find(x => x.binding === 'DB')?.database_id || null; } catch {}
  const configuredId = db.database_id && db.database_id !== '00000000-0000-0000-0000-000000000000' ? db.database_id : null;
  const listText = run(['d1', 'list', '--json'], { capture: true }); let list = parseJson(listText);
  if (!Array.isArray(list)) { const start = listText.indexOf('{'); if (start >= 0) { try { const o = JSON.parse(listText.slice(start)); list = o.result || o.databases || null; } catch { list = null; } } }
  if (!Array.isArray(list)) throw new Error('无法读取 Cloudflare D1 列表；为避免误建同名数据库，已停止，未应用迁移。请检查 Wrangler 输出后重试。');
  const matches = (list || []).filter(x => (x.name || x.database_name) === db.database_name);
  if (matches.length > 1 && !rememberedId && !configuredId) throw new Error(`账号中存在多个名为 ${db.database_name} 的数据库；为避免绑定错库，请先在 Cloudflare 控制台确认目标账号并配置正确 ID。`);
  const knownId = rememberedId || configuredId;
  const found = knownId ? matches.find(x => (x.uuid || x.database_id || x.id) === knownId) : matches[0];
  if (knownId && !found) throw new Error(`本地记录的 D1 ID 未在当前账号找到，或名称不匹配；为保护已有数据，未创建/选择其他数据库。请核对账号和绑定配置。`);
  let databaseId = found?.uuid || found?.database_id || found?.id;
  if (found) {
    if (!knownId && !(await confirmExistingDatabase(db.database_name, databaseId))) throw new Error('未确认已有数据库；没有应用迁移或部署。');
    console.log(`将沿用已确认的 D1 数据库 ${db.database_name}，不会重建或清空。`);
  }
  if (!databaseId) { const out = run(['d1', 'create', db.database_name], { capture: true }); process.stdout.write(out); databaseId = extractCreatedId(out); if (!databaseId) throw new Error(`已请求创建 ${db.database_name}，但未能识别返回的 ID。请检查 Cloudflare D1 列表后重试；不要重复创建。`); console.log(`已创建 D1 数据库 ${db.database_name}。`); }
  db.database_id = databaseId;
  const config = 'wrangler.deploy.jsonc'; await writeFile(config, `${JSON.stringify(base, null, 2)}\n`, { mode: 0o600 });
  if (createOnly) { console.log(`部署配置已生成：${config}（本地忽略，不提交 Git）。`); process.exit(0); }
  run(['d1', 'migrations', 'apply', db.database_name, '--remote', '--config', config]);
  if (migrateOnly) { console.log('数据库迁移命令已完成；没有执行部署。'); process.exit(0); }
  const secretList = run(['secret', 'list', '--config', config, '--format', 'json'], { capture: true });
  const secrets = (() => { try { const i = secretList.indexOf('['); if (i < 0) return null; return JSON.parse(secretList.slice(i)); } catch { return null; } })();
  if (!Array.isArray(secrets)) throw new Error('无法确认远程管理员 Secret 状态；为避免意外覆盖，已停止部署。');
  if (!secrets.some(s => s.name === 'ADMIN_PASSWORD_HASH')) {
    console.log('尚未配置管理员密码，接下来会通过隐藏输入设置一次密码。');
    const script = path.resolve('scripts/set-admin-secret.mjs');
    const child = spawnSync(process.execPath, [script, '--remote', '--config', config], { stdio: 'inherit' });
    if (child.status !== 0) throw new Error('管理员密码 Secret 未设置，停止部署。');
  }
  run(['deploy', '--config', config]);
  console.log('部署完成。请使用 Wrangler 输出的网址打开后台，并先用测试记录验收。');
} catch (e) { console.error(`\n部署流程停止：${e instanceof Error ? e.message : String(e)}`); console.error('请先核对 Wrangler 登录状态及 Cloudflare 命令结果；脚本不会删除数据库或覆盖客户记录。'); process.exitCode = 1; }
