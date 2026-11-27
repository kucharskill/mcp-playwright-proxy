import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
async function setup(t) {
  const dir = resolve('.tmp', `retention-${randomUUID()}`); await mkdir(dir, { recursive: true });
  const events = resolve(dir, 'events.jsonl'); await writeFile(events, '');
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('test/retention-fixture.js')], env: { ...process.env, PW_FIXTURE_EVENTS: events, PW_PROXY_WORKER_IDLE_MS: '300', PW_PROXY_WORKER_TOOL_IDLE_MS: '1000' }, stderr: 'inherit' });
  const client = new Client({ name: 'retention-test', version: '1' });
  let closed = false; client.onclose = () => { closed = true; };
  t.after(async () => { await client.close(); await rm(dir, { recursive: true, force: true }); });
  await client.connect(transport);
  return { client, closed: () => closed, events: async () => (await readFile(events, 'utf8')).split('\n').filter(Boolean).map(JSON.parse) };
}
test('discovery-only worker expires despite local ping', async t => {
  const s = await setup(t); await s.client.listTools(); await sleep(170); await s.client.ping();
  for (let i = 0; i < 30 && !s.closed(); i++) await sleep(50);
  assert.equal(s.closed(), true); assert.equal((await s.events()).filter(x => x.event === 'started').length, 0);
});
test('active work survives discovery deadline; shorter discovery never shortens real-operation retention', async t => {
  const s = await setup(t); await s.client.listTools();
  const work = s.client.callTool({ name: 'fixture_tool', arguments: { delay: 600 } });
  await sleep(400); assert.equal(s.closed(), false);
  assert.deepEqual(await s.client.ping(), {});
  await work;
  await sleep(350); await s.client.listTools(); // 300 ms discovery must not replace the 1000 ms tool deadline.
  await sleep(350); assert.equal(s.closed(), false);
  for (let i = 0; i < 40 && !s.closed(); i++) await sleep(50);
  assert.equal(s.closed(), true);
  const events = await s.events();
  assert.ok(events.find(x => x.event === 'closed').time - events.find(x => x.event === 'finished').time >= 950);
});
