import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DiscoveryCache, invocationKey } from '../src/discovery-cache.js';

const target = { command: 'node', args: ['fixture-worker'], cwd: process.cwd(), env: { API_KEY: 'fixture-secret' } };
const payload = version => ({ identity: { protocolVersion: '2025-11-25', serverInfo: { name: 'fixture', version }, capabilities: { tools: { listChanged: true } }, instructions: 'Fixture instructions' }, manifest: { tools: [{ name: 'fixture_tool', description: 'Fixture tool', inputSchema: { type: 'object', properties: { value: { type: 'string' } } }, annotations: { readOnlyHint: true } }] } });
async function setup(t, options = {}) {
  const directory = resolve('.tmp', `cache-test-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  t.after(() => rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const cache = new DiscoveryCache({ target, directory, load: async () => { calls++; return payload('1'); }, ...options });
  return { cache, directory, calls: () => calls };
}
test('invocation keys include ordered full env, args, cwd and command without leaking values', () => {
  const base = invocationKey(target);
  for (const changed of [{ command: 'other' }, { args: ['other'] }, { cwd: resolve('.tmp') }, { env: { API_KEY: 'changed' } }]) assert.notEqual(invocationKey({ ...target, ...changed }), base);
  assert.equal(invocationKey({ ...target, env: { ...target.env, CODEX_TOOL_CALL_ID: 'one' } }), invocationKey({ ...target, env: { CODEX_TOOL_CALL_ID: 'two', ...target.env } }));
  assert.equal(invocationKey({ ...target, env: { B: '2', A: '1' } }), invocationKey({ ...target, env: { A: '1', B: '2' } }));
  assert.notEqual(invocationKey({ ...target, args: ['a,b', 'c'] }), invocationKey({ ...target, args: ['a', 'b,c'] }));
  assert.equal(invocationKey({ ...target, env: { Path: 'x', Codex_Tool_Call_Id: 'one' } }, { platform: 'win32' }), invocationKey({ ...target, env: { PATH: 'x', CODEX_TOOL_CALL_ID: 'two' } }, { platform: 'win32' }));
  assert.equal(invocationKey({ ...target, env: { OMIT: '1' } }, { ignoredEnv: ['OMIT'] }), invocationKey({ ...target, env: { OMIT: '2' } }, { ignoredEnv: ['OMIT'] }));
  assert.match(base, /^[a-f0-9]{64}$/);
});
test('cold writes complete metadata; a new cache object reads it without its loader', async t => {
  const { cache, directory, calls } = await setup(t);
  const manifest = await cache.get();
  const warm = new DiscoveryCache({ target, directory, load: () => assert.fail('warm loader started') });
  assert.deepEqual(await warm.get(), manifest);
  assert.equal(calls(), 1);
  const raw = await readFile(cache.path, 'utf8');
  assert.ok(!raw.includes('fixture-secret') && !raw.includes('API_KEY') && !raw.includes('sessionId'));
  assert.deepEqual(JSON.parse(raw).identity, payload('1').identity);
});
test('PATH and INIT_/NPM_ families are ignored case-insensitively only in the key', () => {
  for (const platform of ['win32', 'linux']) {
    const key = env => invocationKey({ ...target, env: { ...target.env, ...env } }, { platform });
    const first = { PATH: 'one', INIT_CWD: 'one', INIT_OTHER: 'one', npm_config_local_prefix: 'one', npm_package_json: 'one', NPM_OTHER: 'one' };
    const second = { pAtH: 'two', iNiT_cWd: 'two', init_OTHER: 'two', NpM_CONFIG_local_PREFIX: 'two', Npm_Package_Json: 'two', nPm_OTHER: 'two' };
    assert.equal(key(first), key(second));
    assert.equal(key(first), key({}));
    for (const name of ['API_KEY', 'PATH_SUFFIX', 'INIT', 'NPM', 'MY_INIT_VALUE']) assert.notEqual(key({ [name]: 'changed' }), key({}));
  }
});
test('TTL, old format, corrupt JSON, malformed schemas and unsupported protocol miss safely', async t => {
  let now = 1000;
  const { cache, calls } = await setup(t, { now: () => now, ttlMs: 50 });
  await cache.get(); now = 1050; await cache.get(); assert.equal(calls(), 2);
  for (const raw of ['{broken', JSON.stringify({ format: 0 }), JSON.stringify({ format: 1, key: cache.key, writtenAt: now, expiresAt: now + 50, ...payload('1'), manifest: { tools: 'wrong' } }), JSON.stringify({ format: 1, key: cache.key, writtenAt: now, expiresAt: now + 50, ...payload('1'), identity: { ...payload('1').identity, protocolVersion: 'unsupported' } })]) {
    await writeFile(cache.path, raw); const before = calls(); await cache.get(); assert.equal(calls(), before + 1);
  }
});
test('cache hits preserve the fixed expiry and the default TTL is ten minutes', async t => {
  let now = 1000;
  const { cache, calls } = await setup(t, { now: () => now });
  await cache.get();
  const first = await readFile(cache.path, 'utf8');
  assert.equal(JSON.parse(first).expiresAt, 601000);
  now = 5000; await cache.get();
  assert.equal(await readFile(cache.path, 'utf8'), first);
  assert.equal(calls(), 1);
});
test('invalidations and identity changes propagate to another replica', async t => {
  const { cache, directory, calls } = await setup(t);
  const replica = new DiscoveryCache({ target, directory, load: async () => payload('2') });
  await cache.get(); await replica.invalidate(); await cache.get(); assert.equal(calls(), 2);
  await replica.observeIdentity(payload('2').identity); await cache.get(); assert.equal(calls(), 3);
  await replica.observeIdentity(payload('1').identity); await cache.get(); assert.equal(calls(), 3);
});
test('in-flight stale catalog cannot overwrite a concurrent invalidation', async t => {
  let release;
  const { cache } = await setup(t, { load: async () => { await new Promise(resolve => { release = resolve; }); return payload('1'); } });
  const result = cache.get();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await cache.invalidate(); release(); await result;
  assert.equal(cache.fresh(await cache.record()), false);
});
test('two writers serialize atomic commits and leave a valid shared file', async t => {
  const { directory, cache } = await setup(t);
  const children = [1, 2].map(() => spawn(process.execPath, ['test/cache-writer.js', directory], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }));
  await Promise.all(children.map(async child => {
    let errors = ''; child.stderr.on('data', c => errors += c);
    const [code] = await once(child, 'exit'); assert.equal(code, 0, errors);
  }));
  assert.equal(cache.fresh(await cache.record()), true);
  assert.equal((await readdir(directory)).filter(x => x.endsWith('.lock') || x.endsWith('.tmp')).length, 0);
});
