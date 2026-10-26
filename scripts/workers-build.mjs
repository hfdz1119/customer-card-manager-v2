import { spawnSync } from 'node:child_process';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DATABASE_NAME = 'customer-card-manager-v2-data';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requireDatabaseId(value) {
  if (!value || !UUID.test(value)) {
    throw new Error('Cloudflare Build 变量 D1_DATABASE_ID 缺失或格式无效。请填入本项目专用 D1 的完整 ID。');
  }
  return value;
}

export function withDatabaseId(config, databaseId) {
  const parsed = typeof config === 'string' ? JSON.parse(config) : structuredClone(config);
  const binding = parsed.d1_databases?.find((item) => item.binding === 'DB');
  if (!binding || binding.database_name !== DATABASE_NAME) {
    throw new Error(`Wrangler 配置必须包含名为 ${DATABASE_NAME} 的 DB 绑定。`);
  }
  binding.database_id = requireDatabaseId(databaseId);
  return parsed;
}

function extractJson(text) {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch {}
  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start >= 0 && end > start) {
    try { return JSON.parse(trimmed.slice(start, end + 1)); } catch {}
  }
  throw new Error('无法读取 Wrangler 返回的 D1 列表；未执行迁移或部署。');
}

export function assertDatabaseListed(output, expectedId) {
  const parsed = extractJson(output);
  const rows = Array.isArray(parsed) ? parsed : (parsed?.result ?? parsed?.databases ?? []);
  if (!Array.isArray(rows)) throw new Error('Wrangler D1 列表格式异常；未执行迁移或部署。');
  const match = rows.find((row) => (row.uuid ?? row.database_id ?? row.id) === expectedId);
  if (!match) {
    throw new Error(`当前 Cloudflare 构建账号看不到配置的 D1 ID（${expectedId.slice(-8)}）；请核对账号和 D1_DATABASE_ID。未执行迁移或部署。`);
  }
  if ((match.name ?? match.database_name) !== DATABASE_NAME) {
    throw new Error(`该 D1 ID 的数据库名称不是 ${DATABASE_NAME}；为避免改错库，已停止，未执行迁移或部署。`);
  }
  return true;
}

export function findDestructiveMigration(sql) {
  const withoutComments = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '');
  const match = withoutComments.match(/\b(?:DROP\s+(?:TABLE|COLUMN|INDEX|DATABASE|TRIGGER|VIEW)|DELETE\s+FROM|TRUNCATE\s+TABLE)\b/i);
  return match?.[0] ?? null;
}

function listD1(wrangler, configPath, env) {
  const result = spawnSync(process.execPath, [wrangler, 'd1', 'list', '--json', '--config', configPath], { encoding: 'utf8', env: { ...env, CI: '1' } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('无法读取当前 Cloudflare 账号的 D1 列表；请检查 Workers Build 凭据是否有 D1 读取权限。未执行迁移或部署。');
  return result.stdout;
}

function runWrangler(wrangler, args) {
  const result = spawnSync(process.execPath, [wrangler, ...args], {
    stdio: 'inherit',
    env: { ...process.env, CI: '1' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Wrangler 命令失败（退出码 ${result.status ?? '未知'}）；已停止后续步骤。`);
}

async function checkMigrations(cwd) {
  const migrationDir = path.join(cwd, 'migrations');
  const files = (await readdir(migrationDir)).filter((name) => name.endsWith('.sql')).sort();
  if (!files.length) throw new Error('没有找到 SQL migrations。');
  for (const file of files) {
    const sql = await readFile(path.join(migrationDir, file), 'utf8');
    const dangerous = findDestructiveMigration(sql);
    if (dangerous) throw new Error(`迁移 ${file} 含有 ${dangerous}；自动构建为保护数据而停止。请先人工审查并调整部署流程。`);
  }
}

export async function deployFromWorkersBuild({ env = process.env, cwd = process.cwd(), run = runWrangler, listDatabases = listD1 } = {}) {
  const id = requireDatabaseId(env.D1_DATABASE_ID);
  await checkMigrations(cwd);
  const base = JSON.parse(await readFile(path.join(cwd, 'wrangler.jsonc'), 'utf8'));
  const generated = withDatabaseId(base, id);
  const configPath = path.join(cwd, 'wrangler.build.jsonc');
  const wrangler = path.join(cwd, 'node_modules/wrangler/bin/wrangler.js');
  try {
    await writeFile(configPath, `${JSON.stringify(generated, null, 2)}\n`, { mode: 0o600 });
    const databases = await listDatabases(wrangler, configPath, env);
    assertDatabaseListed(databases, id);
    run(wrangler, ['d1', 'migrations', 'apply', DATABASE_NAME, '--remote', '--config', configPath]);
    run(wrangler, ['deploy', '--config', configPath, '--keep-vars', '--strict']);
    return { databaseName: DATABASE_NAME, workerName: generated.name };
  } finally {
    await rm(configPath, { force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  deployFromWorkersBuild().then(({ workerName }) => {
    console.log(`已完成 Cloudflare Workers 构建并部署 Worker：${workerName}`);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : 'Workers 构建部署失败。');
    process.exitCode = 1;
  });
}
