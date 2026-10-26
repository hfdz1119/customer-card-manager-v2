export const PLAN_COST_CENTS = { monthly: 600, quarterly: 1600, annual: 6000, whitelist: 24000 } as const;
export const PLAN_LABELS = { monthly: '月卡', quarterly: '季卡', annual: '年卡', whitelist: '白名单' } as const;
export type Plan = keyof typeof PLAN_COST_CENTS;
export type CustomerStatus = 'active' | 'upcoming' | 'expired' | 'no_expiry';
export function businessDate(now = new Date(), timeZone = 'Asia/Shanghai'): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const val = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${val('year')}-${val('month')}-${val('day')}`;
}
export function daysBetween(date: string, today: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86_400_000);
}
export function expiryStatus(date: string | null, today: string): CustomerStatus {
  if (!date) return 'no_expiry';
  const days = daysBetween(date, today);
  if (days < 0) return 'expired';
  if (days === 0) return 'active';
  if (days <= 7) return 'upcoming';
  return 'active';
}
export function csvSafe(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function csvDocument(headers: string[], rows: unknown[][]): string {
  return '\uFEFF' + [headers, ...rows].map((row) => row.map(csvSafe).join(',')).join('\r\n');
}
export function knownProfit(sellingPriceCents: number | null, costCents: number): number | null {
  return sellingPriceCents === null ? null : sellingPriceCents - costCents;
}
export function isISODate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
