let csrf: string | null = null;
export async function refreshSession(): Promise<boolean> {
  const r = await fetch('/api/auth/status', { credentials: 'same-origin' }).catch(() => null);
  if (!r?.ok) return false;
  const data = await r.json() as { authenticated: boolean; csrf: string | null }; csrf = data.csrf; return data.authenticated;
}
export function setCsrf(value: string | null) { csrf = value; }
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers); if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (options.method && options.method !== 'GET') { if (csrf) headers.set('X-CSRF-Token', csrf); }
  const response = await fetch(path, { ...options, headers, credentials: 'same-origin' });
  if (!response.ok) { const body = await response.json().catch(() => ({})) as { error?: string }; throw new Error(body.error || `请求失败（${response.status}）`); }
  const type = response.headers.get('content-type') || ''; return (type.includes('json') ? response.json() : response.text()) as Promise<T>;
}
export async function download(path: string) {
  const response = await fetch(path, { credentials: 'same-origin' }); if (!response.ok) throw new Error('导出失败，请重试。');
  const blob = await response.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = path.endsWith('customers') ? 'customers.csv' : 'purchases.csv'; a.click(); URL.revokeObjectURL(url);
}
