import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const mode = process.argv.includes('--remote') ? 'remote' : process.argv.includes('--local') ? 'local' : '';
if (!mode) { console.error('请选择 --local 或 --remote。'); process.exit(2); }
if (!process.stdin.isTTY || !process.stdout.isTTY) { console.error('为了隐藏密码输入，请在交互式终端运行此命令。'); process.exit(2); }
function promptHidden(label) {
  return new Promise((resolve, reject) => {
    const input = process.stdin; const output = process.stdout; let value = '';
    output.write(label); input.setRawMode(true); input.resume(); input.setEncoding('utf8');
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\u0003') { cleanup(); reject(new Error('已取消')); return; }
        if (ch === '\r' || ch === '\n') { cleanup(); output.write('\n'); resolve(value); return; }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else if (ch >= ' ' && ch <= '~') value += ch;
      }
    };
    function cleanup() { input.off('data', onData); input.setRawMode(false); input.pause(); }
    input.on('data', onData);
  });
}
let first, second;
try { first = await promptHidden('输入管理员密码（至少 16 位，不会显示）：'); second = await promptHidden('再输入一次确认：'); }
catch { console.error('密码设置已取消。'); process.exit(1); }
if (first.length < 16) { console.error('密码至少需要 16 位；没有保存任何内容。'); process.exit(1); }
if (first !== second) { console.error('两次输入不一致；没有保存任何内容。'); process.exit(1); }
const rounds = 310000; const salt = randomBytes(18); const derived = pbkdf2Sync(first, salt, rounds, 32, 'sha256');
const encoded = `pbkdf2$sha256$${rounds}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
first = ''; second = '';
if (mode === 'local') {
  const file = '.dev.vars'; let text = '';
  try { text = await readFile(file, 'utf8'); } catch {}
  const lines = text.split(/\r?\n/).filter((line) => line && !line.startsWith('ADMIN_PASSWORD_HASH='));
  lines.push(`ADMIN_PASSWORD_HASH="${encoded}"`);
  await writeFile(file, `${lines.join('\n')}\n`, { mode: 0o600 });
  console.log('已保存本地开发用密码哈希到 .dev.vars（已被 Git 忽略）；密码本身未保存。');
} else {
  const configIndex = process.argv.indexOf('--config'); const config = configIndex >= 0 ? process.argv[configIndex + 1] : 'wrangler.jsonc';
  const wrangler = path.resolve('node_modules/wrangler/bin/wrangler.js');
  const child = spawn(process.execPath, [wrangler, 'secret', 'put', 'ADMIN_PASSWORD_HASH', '--config', config], { stdio: ['pipe', 'inherit', 'inherit'], env: { ...process.env, CI: '1' } });
  child.stdin.end(`${encoded}\n`);
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  if (code !== 0) { console.error('Cloudflare Secret 设置失败；未部署。'); process.exit(Number(code) || 1); }
  console.log('Cloudflare Secret 已设置；密码不会写入项目文件。');
}
