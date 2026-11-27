import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ResultSchema, ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js';

async function setup(t) {
  const dir = resolve('.tmp', `adapter-test-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  const file = resolve(dir, 'config.json');
  const events = resolve(dir, 'events.jsonl');
  await writeFile(events, '');
  await writeFile(file, JSON.stringify({ events, version: '1', tool: 'fixture_tool' }));
  const env = { ...process.env, PW_FIXTURE_CONFIG: file, PW_PROXY_DISCOVERY_CACHE_DIR: resolve(dir, 'cache') };
  const connections = [];
  t.after(async () => { for (const close of connections) await close(); await rm(dir, { recursive: true, force: true }); });
  return { dir, file, events: async () => (await readFile(events, 'utf8')).split('\n').filter(Boolean).map(JSON.parse),
    open: async extra => {
      const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('test/adapter-fixture.js')], env: { ...env, ...extra }, stderr: 'pipe' });
      const client = new Client({ name: 'cache-test', version: '1' });
      connections.push(() => client.close());
      let errors = ''; transport.stderr.on('data', c => errors += c);
      await client.connect(transport); return { client, transport, errors: () => errors };
    }, env, connections };
}
test('legacy init and ping are answered locally with no worker or cache load', async t => {
  const setup_ = await setup(t);
  const child = spawn(process.execPath, [resolve('test/adapter-fixture.js')], { env: setup_.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  setup_.connections.push(async () => { child.stdin.end(); });
  const pending = new Map(); let next = 0;
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => { const response = JSON.parse(line); pending.get(response.id)?.(response); pending.delete(response.id); });
  const rpc = (method, params) => new Promise(resolve => { const id = ++next; pending.set(id, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  const init = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'legacy-test', version: '1' } });
  assert.equal(init.result.protocolVersion, '2024-11-05');
  assert.deepEqual(init.result.capabilities, { tools: { listChanged: true } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  assert.deepEqual((await rpc('ping', {})).result, {});
  for (const method of ['prompts/list', 'resources/list', 'resources/templates/list']) assert.equal((await rpc(method, {})).error.code, -32601);
  assert.deepEqual(await setup_.events(), []);
  child.stdin.end();
  await new Promise(resolve => child.once('exit', resolve));
});
test('SDK client receives the complete extended public result unchanged on cold/warm replicas despite ttlMs zero', async t => {
  const s = await setup(t);
  const fields = { ttlMs: 0, cacheScope: 'session', resultType: 'catalog', _meta: { 'fixture/vendor': { stable: true } }, futureField: { unknown: ['preserved'] } };
  const config = JSON.parse(await readFile(s.file, 'utf8'));
  await writeFile(s.file, JSON.stringify({ ...config, resultFields: fields, extraAnnotations: { vendorHint: 'keep' }, extraToolFields: { vendorExtension: { keep: true } } }));
  const first = await s.open({ PW_TEST_EXTENDED_WORKER: '1' });
  const cold = await first.client.request({ method: 'tools/list' }, ResultSchema);
  assert.ok(ListToolsResultSchema.safeParse(cold).success);
  for (const [name, value] of Object.entries(fields)) assert.deepEqual(cold[name], value);
  assert.deepEqual(cold.tools.slice(0, 3).map(x => x.name), ['browser_instance_start', 'browser_instance_list', 'browser_instance_stop']);
  const upstream = cold.tools[3];
  assert.equal(upstream.annotations.vendorHint, 'keep');
  assert.deepEqual(upstream.vendorExtension, { keep: true });
  assert.ok(upstream.inputSchema.required.includes('instanceId'));
  const sdkCold = await first.client.listTools();
  await first.client.close();
  const second = await s.open({ PW_TEST_EXTENDED_WORKER: '1' });
  await second.client.ping(); await second.client.ping();
  let sentId; let receivedId;
  const send = second.transport.send.bind(second.transport);
  second.transport.send = request => { if (request.method === 'tools/list') sentId = request.id; return send(request); };
  const receive = second.transport.onmessage;
  second.transport.onmessage = response => { if (response.result?.tools) receivedId = response.id; receive(response); };
  const warm = await second.client.request({ method: 'tools/list' }, ResultSchema);
  assert.deepEqual(warm, cold);
  assert.equal(receivedId, sentId);
  assert.deepEqual(await second.client.listTools(), sdkCold);
  assert.equal((await s.events()).filter(x => x.event === 'start').length, 1);
  const names = (await readdir(resolve(s.dir, 'cache'))).filter(x => x.endsWith('.json'));
  assert.equal(names.length, 1);
  const cached = JSON.parse(await readFile(resolve(s.dir, 'cache', names[0]), 'utf8'));
  assert.equal(cached.format, 2);
  assert.equal(cached.expiresAt - cached.writtenAt, 600000);
  assert.deepEqual(cached.manifest, cold);
});
test('scoped result identifiers are returned intact but skip disk and worker catalog caches', async t => {
  for (const fields of [{ _meta: { sessionId: 'fixture-session' } }, { _meta: { progressToken: 'fixture-progress' } }, { taskId: 'fixture-task' }]) {
    const s = await setup(t);
    const config = JSON.parse(await readFile(s.file, 'utf8'));
    await writeFile(s.file, JSON.stringify({ ...config, resultFields: fields }));
    const { client } = await s.open({ PW_TEST_EXTENDED_WORKER: '1' });
    for (let i = 0; i < 2; i++) {
      const result = await client.request({ method: 'tools/list' }, ResultSchema);
      for (const [key, value] of Object.entries(fields)) assert.deepEqual(result[key], value);
    }
    await Promise.all([client.request({ method: 'tools/list' }, ResultSchema), client.request({ method: 'tools/list' }, ResultSchema)]);
    assert.equal((await s.events()).filter(x => x.event === 'list').length, 4);
    assert.equal((await readdir(resolve(s.dir, 'cache'))).filter(x => x.endsWith('.json')).length, 0);
  }
});
test('a second process initializes and lists from the shared cache; real calls still start worker with original env', async t => {
  const s = await setup(t);
  const first = await s.open({ CODEX_TOOL_CALL_ID: 'one' });
  const catalog = await first.client.listTools();
  assert.equal(catalog.tools[0].description, 'Fixture discovery metadata');
  assert.equal((await s.events()).filter(x => x.event === 'start').length, 1);
  await first.client.close();
  const second = await s.open({ CODEX_TOOL_CALL_ID: 'two' });
  assert.deepEqual(await second.client.listTools(), catalog);
  assert.deepEqual(await second.client.ping(), {});
  assert.equal((await s.events()).filter(x => x.event === 'start').length, 1);
  const result = await second.client.callTool({ name: 'fixture_tool', arguments: {} });
  assert.equal(JSON.parse(result.content[0].text).callId, 'two');
  assert.equal((await s.events()).filter(x => x.event === 'start').length, 2);
  const startup = (await readFile(resolve(s.dir, 'cache', 'env-startup.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(startup.length, 2, 'Only adapter startup, not discovery/ping/tool calls, may append evidence');
  assert.deepEqual(startup.map(x => x.env.CODEX_TOOL_CALL_ID), ['one', 'two']);
});
test('the internal host gate preserves an incoming variable of the same name', async t => {
  const s = await setup(t); const { client } = await s.open({ PW_PROXY_HOST: 'original-user-value' });
  const result = await client.callTool({ name: 'fixture_tool', arguments: {} });
  assert.equal(JSON.parse(result.content[0].text).hostEnv, 'original-user-value');
});
test('replicas share discovery despite launcher env differences while dumps and backend retain original values', async t => {
  const s = await setup(t);
  const firstEnv = { PATH: 'fixture-path-one', INIT_CWD: 'fixture-init-one', npm_config_local_prefix: 'fixture-prefix-one', npm_package_json: 'fixture-package-one' };
  const secondEnv = { PATH: 'fixture-path-two', INIT_CWD: 'fixture-init-two', npm_config_local_prefix: 'fixture-prefix-two', npm_package_json: 'fixture-package-two' };
  const first = await s.open(firstEnv); const catalog = await first.client.listTools(); await first.client.close();
  const second = await s.open(secondEnv); assert.deepEqual(await second.client.listTools(), catalog);
  assert.equal((await s.events()).filter(x => x.event === 'start').length, 1);
  const result = JSON.parse((await second.client.callTool({ name: 'fixture_tool', arguments: {} })).content[0].text);
  assert.equal(result.path, secondEnv.PATH); assert.equal(result.initCwd, secondEnv.INIT_CWD);
  assert.equal(result.npmPrefix, secondEnv.npm_config_local_prefix); assert.equal(result.npmPackage, secondEnv.npm_package_json);
  const startup = (await readFile(resolve(s.dir, 'cache', 'env-startup.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(startup.map(x => x.env.PATH), [firstEnv.PATH, secondEnv.PATH]);
  assert.deepEqual(startup.map(x => x.env.INIT_CWD), [firstEnv.INIT_CWD, secondEnv.INIT_CWD]);
});
test('warm discovery and ping do not postpone worker idle', async t => {
  const s = await setup(t); const { client } = await s.open();
  await client.listTools();
  for (let i = 0; i < 5; i++) { await sleep(250); await client.ping(); await client.listTools(); }
  assert.equal((await s.events()).filter(x => x.event === 'idle').length, 1);
  assert.equal((await s.events()).filter(x => x.event === 'start').length, 1);
});
test('list_changed invalidates other replicas and publishes the new catalog', async t => {
  const s = await setup(t); const first = await s.open();
  await first.client.listTools(); const second = await s.open();
  await second.client.listTools();
  await first.client.callTool({ name: 'update', arguments: {} });
  let result;
  for (let i = 0; i < 20; i++) { result = await second.client.listTools(); if (result.tools[0].name === 'updated_tool') break; await sleep(25); }
  assert.equal(result.tools[0].name, 'updated_tool');
});
test('a changed backend identity discovered by a real call invalidates the file', async t => {
  const s = await setup(t); const first = await s.open();
  await first.client.listTools(); await first.client.close();
  const config = JSON.parse(await readFile(s.file, 'utf8'));
  await writeFile(s.file, JSON.stringify({ ...config, version: '2', tool: 'version_two' }));
  const second = await s.open();
  assert.equal((await second.client.listTools()).tools[0].name, 'fixture_tool');
  await second.client.callTool({ name: 'fixture_tool', arguments: {} });
  assert.equal((await second.client.listTools()).tools[0].name, 'version_two');
});
test('caller cancellation does not replay or pretend backend work finished', async t => {
  const s = await setup(t); const { client } = await s.open(); await client.listTools();
  const abort = new AbortController();
  const work = client.callTool({ name: 'fixture_tool', arguments: { delay: 300 } }, undefined, { signal: abort.signal });
  const rejected = assert.rejects(work);
  for (let i = 0; i < 40 && !(await s.events()).some(x => x.event === 'call'); i++) await sleep(10);
  abort.abort(); await rejected;
  assert.equal((await s.events()).filter(x => x.event === 'finished').length, 0);
  for (let i = 0; i < 40 && !(await s.events()).some(x => x.event === 'finished'); i++) await sleep(20);
  const events = await s.events();
  assert.equal(events.filter(x => x.event === 'call').length, 1);
  assert.equal(events.filter(x => x.event === 'finished').length, 1);
  assert.deepEqual(await client.ping(), {});
});
