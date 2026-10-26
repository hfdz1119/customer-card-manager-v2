import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('D1 初始迁移安全性',()=>{
 it('仅以幂等的新增表和索引初始化，不删除数据或放入示例客户',async()=>{
  const sql=await readFile(new URL('../migrations/0001_init.sql',import.meta.url),'utf8');
  expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS customers/i);
  expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS purchases/i);
  expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS login_attempts/i);
  expect(sql).toMatch(/ON DELETE CASCADE/i);
  expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS/i);
  expect(sql).not.toMatch(/\bDROP\s+TABLE\b/i);
  expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
  expect(sql).not.toMatch(/INSERT\s+INTO\s+customers/i);
 });
});
