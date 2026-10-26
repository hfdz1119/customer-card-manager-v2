import { readFile, writeFile } from 'node:fs/promises';

const id = process.env.D1_DATABASE_ID?.trim() ?? '';
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
  console.error('缺少有效的 D1_DATABASE_ID。请在 Cloudflare Worker → Settings → Builds → Build variables 中填入专用 D1 的 Database ID。');
  process.exit(2);
}

const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
const database = config.d1_databases?.find((entry) => entry.binding === 'DB');
if (!database) {
  console.error('wrangler.jsonc 缺少 DB 数据库绑定。');
  process.exit(2);
}
if (database.database_name !== 'customer') {
  console.error('DB 绑定模板的数据库名不是 customer；为避免误操作，已停止。');
  process.exit(2);
}

database.database_id = id;
await writeFile('wrangler.build.jsonc', `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
console.log('Workers Builds 专用 Wrangler 配置已生成；D1 ID 未写入 Git 跟踪配置。');
