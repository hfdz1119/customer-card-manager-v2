import { describe, expect, it } from 'vitest';
import { businessDate, csvDocument, csvSafe, daysBetween, expiryStatus, knownProfit, PLAN_COST_CENTS } from '../src/lib/shared';

describe('卡种成本与利润',()=>{
 it('固定四种成本，未知售价不生成虚假利润',()=>{
  expect(PLAN_COST_CENTS).toEqual({monthly:600,quarterly:1600,annual:6000,whitelist:24000});
  expect(knownProfit(null,600)).toBeNull(); expect(knownProfit(2000,600)).toBe(1400);
 });
});
describe('日期与到期状态',()=>{
 it('按业务时区生成日期，避免 UTC 日期偏移',()=>{
  expect(businessDate(new Date('2026-01-01T16:30:00Z'),'Asia/Shanghai')).toBe('2026-01-02');
 });
 it('今天仍有效，未来 1–7 天即将到期，第八天仍有效，过去日期已到期',()=>{
  expect(expiryStatus('2026-01-10','2026-01-10')).toBe('active');
  expect(expiryStatus('2026-01-11','2026-01-10')).toBe('upcoming');
  expect(expiryStatus('2026-01-17','2026-01-10')).toBe('upcoming');
  expect(expiryStatus('2026-01-18','2026-01-10')).toBe('active');
  expect(expiryStatus('2026-01-09','2026-01-10')).toBe('expired');
  expect(expiryStatus(null,'2026-01-10')).toBe('no_expiry');
  expect(daysBetween('2026-01-17','2026-01-10')).toBe(7);
 });
});
describe('CSV 安全',()=>{
 it('保留中文、UTF-8 BOM、正确引用引号，并防止公式注入',()=>{
  const csv=csvDocument(['姓名','备注'],[['客户',' =1+1'],['王"五','@SUM(A1:A2)'],['+cmd','正常']]);
  expect(csv.startsWith('\uFEFF')).toBe(true); expect(csv).toContain('"客户"'); expect(csv).toContain('"\' =1+1"'); expect(csv).toContain('"王""五"'); expect(csv).toContain('"\'@SUM(A1:A2)"');
  expect(csvSafe('-1')).toBe("\"\'-1\"");
 });
});
