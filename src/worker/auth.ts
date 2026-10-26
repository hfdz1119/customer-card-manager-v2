import type { Env } from './types';
const COOKIE = '__Host-allowlist_session';
const SESSION_SECONDS = 12 * 60 * 60;
const encoder = new TextEncoder();
function b64(bytes: Uint8Array): string { let bin = ''; for (const b of bytes) bin += String.fromCharCode(b); return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); }
function unb64(value: string): Uint8Array { const s = value.replaceAll('-', '+').replaceAll('_', '/'); const bin = atob(s + '='.repeat((4 - s.length % 4) % 4)); return Uint8Array.from(bin, (c) => c.charCodeAt(0)); }
async function hmac(secret: string, text: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(text)));
}
async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, algorithm, rounds, salt, expected] = stored.split('$');
  if (algorithm !== 'sha256' || !/^\d+$/.test(rounds ?? '') || Number(rounds) < 100_000 || Number(rounds) > 1_000_000 || !salt || !expected) return false;
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt), iterations: Number(rounds) }, material, 256));
  const a = b64(bits); let diff = a.length ^ expected.length;
  for (let i = 0; i < Math.max(a.length, expected.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  return diff === 0;
}
export async function createSession(env: Env): Promise<{ cookie: string; csrf: string }> {
  const payload = { exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS, csrf: b64(crypto.getRandomValues(new Uint8Array(24))) };
  const encoded = b64(encoder.encode(JSON.stringify(payload)));
  const value = `${encoded}.${b64(await hmac(env.ADMIN_PASSWORD_HASH, encoded))}`;
  return { cookie: `${COOKIE}=${value}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`, csrf: payload.csrf };
}
export async function getSession(request: Request, env: Env): Promise<{ csrf: string } | null> {
  const raw = request.headers.get('Cookie')?.split(';').map((x) => x.trim()).find((x) => x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!raw) return null;
  const [encoded, signature] = raw.split('.');
  if (!encoded || !signature) return null;
  const expected = b64(await hmac(env.ADMIN_PASSWORD_HASH, encoded));
  if (expected.length !== signature.length) return null;
  let diff = 0; for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  if (diff) return null;
  try { const payload = JSON.parse(new TextDecoder().decode(unb64(encoded))) as { exp: number; csrf: string }; if (payload.exp <= Date.now() / 1000 || typeof payload.csrf !== 'string') return null; return { csrf: payload.csrf }; } catch { return null; }
}
export function clearSessionCookie(): string { return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`; }
export async function login(request: Request, env: Env): Promise<{ cookie: string; csrf: string } | null> {
  const body = await request.json().catch(() => null) as { password?: unknown } | null;
  if (!body || typeof body.password !== 'string' || body.password.length > 1024) return null;
  return await verifyPassword(body.password, env.ADMIN_PASSWORD_HASH) ? createSession(env) : null;
}
export async function clientIpHash(request: Request, env: Env): Promise<string> {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  return b64(await hmac(env.ADMIN_PASSWORD_HASH, `login-ip:${ip}`));
}
