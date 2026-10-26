import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDatabaseListed, findDestructiveMigration, requireDatabaseId, withDatabaseId, DATABASE_NAME } from './workers-build.mjs';

const id = '7f915c60-e288-4355-8efd-5c7dc8d7c93b';
const base = { name: 'customer-card-manager-v2', d1_databases: [{ binding: 'DB', database_name: DATABASE_NAME, database_id: '00000000-0000-0000-0000-000000000000' }] };

test('只接受完整 UUID 形式的 D1_DATABASE_ID', () => {
  assert.equal(requireDatabaseId(id), id);
  assert.throws(() => requireDatabaseId(''), /D1_DATABASE_ID/);
  assert.throws(() => requireDatabaseId('not-an-id'), /D1_DATABASE_ID/);
});

test('生成的 Wrangler 配置只替换 DB ID，不改数据库名称或其它配置', () => {
  const config = withDatabaseId(base, id);
  assert.equal(config.d1_databases[0].database_id, id);
  assert.equal(config.d1_databases[0].database_name, DATABASE_NAME);
  assert.equal(base.d1_databases[0].database_id, '00000000-0000-0000-0000-000000000000');
  assert.throws(() => withDatabaseId({ name: 'wrong', d1_databases: [] }, id), /DB 绑定/);
});

test('迁移前必须在当前账户精确找到同 ID、同名称的 D1', () => {
  assert.equal(assertDatabaseListed(JSON.stringify([{ uuid: id, name: DATABASE_NAME }]), id), true);
  assert.throws(() => assertDatabaseListed(JSON.stringify([{ uuid: id, name: 'other-db' }]), id), /名称不是/);
  assert.throws(() => assertDatabaseListed(JSON.stringify([{ uuid: '11111111-1111-4111-8111-111111111111', name: DATABASE_NAME }]), id), /看不到配置的 D1/);
  assert.throws(() => assertDatabaseListed('not-json', id), /未执行迁移或部署/);
});

test('自动部署阻止删除数据库或数据的迁移语句，但忽略注释', () => {
  assert.equal(findDestructiveMigration('-- DROP TABLE old;\nCREATE TABLE safe (id TEXT);'), null);
  assert.match(findDestructiveMigration('DROP TABLE customers;') ?? '', /DROP TABLE/i);
  assert.match(findDestructiveMigration('DELETE FROM customers;') ?? '', /DELETE FROM/i);
  assert.match(findDestructiveMigration('TRUNCATE TABLE purchases;') ?? '', /TRUNCATE TABLE/i);
  assert.match(findDestructiveMigration('ALTER TABLE customers DROP COLUMN contact;') ?? '', /DROP COLUMN/i);
});

test('部署入口先验证目标 D1，再依次迁移和发布；错误条件下不执行写命令', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const { deployFromWorkersBuild } = await import('./workers-build.mjs');
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'workers-build-test-'));
  try {
    await mkdir(path.join(cwd, 'migrations'));
    await writeFile(path.join(cwd, 'wrangler.jsonc'), JSON.stringify(base));
    await writeFile(path.join(cwd, 'migrations', '0001.sql'), 'CREATE TABLE safe (id TEXT);');
    const calls = [];
    const deps = { cwd, env: { D1_DATABASE_ID: id }, listDatabases: async () => JSON.stringify([{ uuid: id, name: DATABASE_NAME }]), run: (_bin, args) => calls.push(args) };
    await deployFromWorkersBuild(deps);
    assert.deepEqual(calls.map((args) => args[0]), ['d1', 'deploy']);
    assert.match(calls[0].join(' '), /migrations apply .* --remote/);
    assert.match(calls[1].join(' '), /--keep-vars --strict/);
    assert.equal(calls[0].at(-1), path.join(cwd, 'wrangler.build.jsonc'));
    assert.equal(calls[1].at(-1), '--strict');
    calls.length = 0;
    await assert.rejects(deployFromWorkersBuild({ ...deps, listDatabases: async () => JSON.stringify([{ uuid: id, name: 'different-db' }]) }), /名称不是/);
    assert.equal(calls.length, 0);
    await writeFile(path.join(cwd, 'migrations', '0001.sql'), 'DROP TABLE customers;');
    await assert.rejects(deployFromWorkersBuild(deps), /保护数据而停止/);
    assert.equal(calls.length, 0);
    await assert.rejects(deployFromWorkersBuild({ ...deps, env: {} }), /D1_DATABASE_ID/);
    assert.equal(calls.length, 0);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
