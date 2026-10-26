import { spawnSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const wrangler = path.resolve('node_modules/wrangler/bin/wrangler.js');
const placeholderId = '00000000-0000-0000-0000-000000000000';

try {
  let config = 'wrangler.deploy.jsonc';
  let parsed;
  try {
    parsed = JSON.parse(await readFile(config, 'utf8'));
  } catch {
    config = 'wrangler.jsonc';
    parsed = JSON.parse(await readFile(config, 'utf8'));
  }
  const db = parsed.d1_databases?.find((binding) => binding.binding === 'DB');
  if (!db?.database_name || !db.database_id || db.database_id === placeholderId) {
    throw new Error('请先运行 npm run db:create 或 npm run deploy 生成本地数据库配置。');
  }

  await mkdir('backups', { recursive: true });
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const output = path.resolve(`backups/${db.database_name}-${stamp}.sql`);
  const result = spawnSync(process.execPath, [wrangler, 'd1', 'export', db.database_name, '--remote', '--output', output, '--config', config], {
    stdio: 'inherit',
    env: { ...process.env, CI: '1' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('D1 导出失败，请查看 Wrangler 提示。');
  console.log(`已导出数据库备份：${output}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
