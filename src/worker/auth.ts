import type { Env } from './types';

const COOKIE = '__Host-allowlist_session';
const SESSION_SECONDS = 12 * 60 * 60;
const encoder = new TextEncoder();

function b64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
function unb64(value: string): Uint8Array {
  const s = value.replaceAll('-', '+').replaceAll('_', '/');
  const bin = atob(s + '='.repeat((4 - s.length % 4) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

type PasswordHash = { rounds: number; salt: Uint8Array; expected: Uint8Array };
function parsePasswordHash(stored: string | undefined): PasswordHash | null {
  if (!stored) return null;
  const [kind, algorithm, roundsText, saltText, expectedText, ...extra] = stored.split('$');
  if (kind !== 'pbkdf2' || algorithm !== 'sha256' || extra.length ||
      !/^\d+$/.test(roundsText ?? '') || !/^[A-Za-z0-9_-]+$/.test(saltText ?? '') ||
      !/^[A-Za-z0-9_-]+$/.test(expectedText ?? '')) return null;
  const rounds = Number(roundsText);
  if (!Number.isSafeInteger(rounds) || rounds < 100_000 || rounds > 1_000_000) return null;
  try {
    const salt = unb64(saltText);
    const expected = unb64(expectedText);
    if (salt.length < 16 || expected.length !== 32) return null;
    return { rounds, salt, expected };
  } catch {
    return null;
  }
}
export function passwordSecretConfigured(env: Env): boolean {
  return parsePasswordHash(env.ADMIN_PASSWORD_HASH) !== null;
}
function signingSecret(env: Env): string {
  // The verifier itself is held only as a Cloudflare Secret; it never enters D1 or source control.
  return env.ADMIN_PASSWORD_HASH ?? '';
}
async function hmac(secret: string, text: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(text)));
}
async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parsePasswordHash(stored);
  if (!parsed) return false;
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: parsed.salt, iterations: parsed.rounds }, material, 256));
  return constantTimeEqual(bits, parsed.expected);
}
export async function createSession(env: Env): Promise<{ cookie: string; csrf: string }> {
  if (!passwordSecretConfigured(env)) throw new Error('管理员密码哈希 Secret 未配置。');
  const payload = { exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS, csrf: b64(crypto.getRandomValues(new Uint8Array(24))) };
  const encoded = b64(encoder.encode(JSON.stringify(payload)));
  const value = `${encoded}.${b64(await hmac(signingSecret(env), encoded))}`;
  return { cookie: `${COOKIE}=${value}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`, csrf: payload.csrf };
}
export async function getSession(request: Request, env: Env): Promise<{ csrf: string } | null> {
  // Fail closed even for a forged cookie if the runtime Secret is missing or malformed.
  if (!passwordSecretConfigured(env)) return null;
  const raw = request.headers.get('Cookie')?.split(';').map((x) => x.trim()).find((x) => x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!raw) return null;
  const [encoded, signature] = raw.split('.');
  if (!encoded || !signature) return null;
  let expected: string;
  try { expected = b64(await hmac(signingSecret(env), encoded)); } catch { return null; }
  const signatureBytes = encoder.encode(signature);
  if (!constantTimeEqual(encoder.encode(expected), signatureBytes)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(unb64(encoded))) as { exp: number; csrf: string };
    if (typeof payload.exp !== 'number' || payload.exp <= Date.now() / 1000 || typeof payload.csrf !== 'string') return null;
    return { csrf: payload.csrf };
  } catch { return null; }
}
export function clearSessionCookie(): string {
  return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}
export async function login(request: Request, env: Env): Promise<{ cookie: string; csrf: string } | null> {
  const body = await request.json().catch(() => null) as { password?: unknown } | null;
  if (!body || typeof body.password !== 'string' || body.password.length > 1024 || !passwordSecretConfigured(env)) return null;
  const valid = await verifyPassword(body.password, env.ADMIN_PASSWORD_HASH!);
  return valid ? createSession(env) : null;
}
export async function clientIpHash(request: Request, env: Env): Promise<string> {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  return b64(await hmac(signingSecret(env), `login-ip:${ip}`));
}
