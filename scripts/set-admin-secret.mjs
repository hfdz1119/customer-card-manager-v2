import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
const generateOnly = process.argv.includes('--generate');
const mode = process.argv.includes('--remote') ? 'remote' : process.argv.includes('--local') ? 'local' : '';
if (!mode && !generateOnly) { console.error('请选择 --generate、--local 或 --remote。'); process.exit(2); }
const configIndex = process.argv.indexOf('--config');
const config = configIndex >= 0 ? process.argv[configIndex + 1] : '';
const outputIndex = process.argv.indexOf('--output-file');
const outputFile = outputIndex >= 0 ? process.argv[outputIndex + 1] : '';
if (outputIndex >= 0 && (!outputFile || mode !== 'remote' || generateOnly)) { console.error('--output-file 仅供远程首次部署使用。'); process.exit(2); }
const wrangler = path.resolve('node_modules/wrangler/bin/wrangler.js');
function finish(message) { process.stdout.write(`${message}\n`, () => process.exit(0)); }
if (mode === 'remote') {
  if (!config) { console.error('远程设置需要明确的部署配置；先运行 npm run deploy。'); process.exit(2); }
  try {
    await access(config);
    const parsed = JSON.parse(await readFile(config, 'utf8'));
    const db = parsed.d1_databases?.find((binding) => binding.binding === 'DB');
    if (!db?.database_id || db.database_id === '00000000-0000-0000-0000-000000000000') throw new Error();
  } catch { console.error('找不到有效的本机部署配置；先运行 npm run deploy。'); process.exit(2); }
  if (!process.argv.includes('--account-confirmed')) {
    const who = spawnSync(process.execPath, [wrangler, 'whoami'], { stdio: 'inherit' });
    if (who.status !== 0) { console.error('Wrangler 尚未登录；没有修改 Secret。'); process.exit(2); }
    if (!process.stdin.isTTY || !process.stdout.isTTY) { console.error('请在交互式终端确认 Cloudflare 账户；没有修改 Secret。'); process.exit(2); }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question('以上 Wrangler 账户是要修改管理员密码的账户吗？输入 y 确认：');
    rl.close();
    if (answer.trim().toLowerCase() !== 'y') { console.error('未确认账户；没有修改 Secret。'); process.exit(2); }
  }
}
if (!process.stdin.isTTY || !process.stdout.isTTY) { console.error('为了隐藏密码输入，请在交互式终端运行此命令。'); process.exit(2); }
function promptHidden(label) {
  return new Promise((resolve, reject) => {
    const input = process.stdin; const output = process.stdout; let value = '';
    input.setRawMode(true); input.setEncoding('utf8');
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\u0003') { cleanup(); reject(new Error('已取消')); return; }
        if (ch === '\r' || ch === '\n') { cleanup(); output.write('\n'); resolve(value); return; }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else if (ch >= ' ' && ch <= '~') value += ch;
      }
    };
    function cleanup() { input.off('data', onData); input.setRawMode(false); input.pause(); }
    input.on('data', onData); input.resume(); output.write(label);
  });
}
let first, second;
try { first = await promptHidden('输入管理员密码（至少 16 位，不会显示）：'); second = await promptHidden('再输入一次确认：'); }
catch { console.error('密码设置已取消。'); process.exit(1); }
process.stdin.destroy();
if (first.length < 16) { console.error('密码至少需要 16 位；没有保存任何内容。'); process.exit(1); }
if (first !== second) { console.error('两次输入不一致；没有保存任何内容。'); process.exit(1); }
const rounds = 310000; const salt = randomBytes(18); const derived = pbkdf2Sync(first, salt, rounds, 32, 'sha256');
const encoded = `pbkdf2$sha256$${rounds}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
first = ''; second = '';
if (outputFile) {
  try {
    await writeFile(outputFile, `${JSON.stringify({ ADMIN_PASSWORD_HASH: encoded })}\n`, { mode: 0o600, flag: 'wx' });
    finish('已生成仅含密码哈希的临时 Secret 文件；部署完成后会自动删除。');
  } catch { console.error('无法安全创建临时 Secret 文件；没有部署。'); process.exit(1); }
} else if (generateOnly) {
  finish(`把下一行仅粘贴到 Cloudflare Production Secret：ADMIN_PASSWORD_HASH。哈希也要保密，不要提交或发给别人。\n${encoded}`);
} else if (mode === 'local') {
  const file = '.dev.vars'; let text = '';
  try { text = await readFile(file, 'utf8'); } catch {}
  const lines = text.split(/\r?\n/).filter((line) => line && !line.startsWith('ADMIN_PASSWORD_HASH='));
  lines.push(`ADMIN_PASSWORD_HASH="${encoded}"`);
  await writeFile(file, `${lines.join('\n')}\n`, { mode: 0o600 });
  finish('已保存本地开发用密码哈希到 .dev.vars（已被 Git 忽略）；密码本身未保存。');
} else {
  const child = spawn(process.execPath, [wrangler, 'secret', 'put', 'ADMIN_PASSWORD_HASH', '--config', config], { stdio: ['pipe', 'inherit', 'inherit'], env: { ...process.env, CI: '1' } });
  child.stdin.end(`${encoded}\n`);
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  if (code !== 0) { console.error('Cloudflare Secret 设置失败；未部署。'); process.exit(Number(code) || 1); }
  finish('Cloudflare Secret 已设置；密码不会写入项目文件。');
}
