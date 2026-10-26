import { readFile, writeFile } from 'node:fs/promises';
const base=JSON.parse(await readFile('wrangler.jsonc','utf8'));
const db=base.d1_databases.find(x=>x.binding==='DB');
if(process.argv.includes('--local')) db.database_id='00000000-0000-0000-0000-000000000000';
else { console.error('请用 npm run deploy 创建部署配置；不要手工修改账号 ID。'); process.exit(2); }
await writeFile('wrangler.local.jsonc',`${JSON.stringify(base,null,2)}\n`,{mode:0o600});
