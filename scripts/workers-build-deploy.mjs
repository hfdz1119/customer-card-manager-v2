import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

if (process.env.WORKERS_CI !== '1') {
  console.error('此命令仅供 Cloudflare Workers Builds 使用。');
  process.exit(2);
}

function run(args) {
  const result = spawnSync(process.execPath, [path.resolve('node_modules/wrangler/bin/wrangler.js'), ...args], {
    stdio: 'inherit',
    env: { ...process.env, CI: '1' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Wrangler 命令失败：${args.join(' ')}`);
}

try {
  const configResult = spawnSync(process.execPath, [path.resolve('scripts/config-workers-build.mjs')], {
    stdio: 'inherit',
    env: process.env,
  });
  if (configResult.error) throw configResult.error;
  if (configResult.status !== 0) throw new Error('D1 部署配置无效。');

  const config = JSON.parse(await readFile('wrangler.build.jsonc', 'utf8'));
  const database = config.d1_databases.find((entry) => entry.binding === 'DB');
  run(['d1', 'migrations', 'apply', database.database_name, '--remote', '--config', 'wrangler.build.jsonc']);
  run(['deploy', '--config', 'wrangler.build.jsonc']);
  console.log('数据库迁移和 Worker 部署均已完成。');
} catch (error) {
  console.error(`Workers Builds 部署停止：${error instanceof Error ? error.message : String(error)}`);
  console.error('迁移失败时不会继续部署；此脚本不会删除数据库或客户记录。请检查构建日志、D1_DATABASE_ID 和部署令牌的 D1 Edit 权限。');
  process.exitCode = 1;
}
