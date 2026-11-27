import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { Instances } from '../src/instances.js';
import { optionsSchema, upstreamArgs, withInstance } from '../src/options.js';
function fixture() {
  const connections = [];
  const manager = new Instances({
    resolve: async () => ({ entry: 'fixture', version: '1' }),
    open: async (_args, config) => {
      const c = { config, calls: [], closed: false, list: async () => ({ tools: [{ name: 'browser_snapshot', inputSchema: { type: 'object', properties: {} } }] }),
        call: async request => { c.calls.push(request); return { content: [{ type: 'text', text: 'ok' }] }; },
        close: async () => { c.closed = true; } };
      connections.push(c); return c;
    },
  });
  return { manager, connections };
}
test('options keep extension and launch separate; file access is explicit', () => {
  assert.throws(() => optionsSchema.parse({ mode: 'extension', headless: false }));
  assert.throws(() => optionsSchema.parse({ isolated: true, userDataDir: 'x' }));
  assert.throws(() => optionsSchema.parse({ unknown: true }));
  assert.ok(!upstreamArgs({}, '/project').includes('--allow-unrestricted-file-access'));
  assert.ok(upstreamArgs({ allowUnrestrictedFileAccess: true }, '/project').includes('--allow-unrestricted-file-access'));
});
test('schema adds routing without changing the upstream schema', () => {
  const tool = { name: 'browser_click', inputSchema: { type: 'object', properties: { target: { type: 'string' } }, required: ['target'], additionalProperties: false } };
  assert.deepEqual(withInstance(tool).inputSchema.required, ['target', 'instanceId']);
  assert.equal(tool.inputSchema.properties.instanceId, undefined);
});
test('instances route and strip instanceId; list never renews idle expiry', async () => {
  const { manager, connections } = fixture();
  try {
    const a = await manager.start({ idleTimeoutMs: 1000 });
    const b = await manager.start({ mode: 'extension', idleTimeoutMs: 0 });
    const expiry = manager.list()[0].expiresAt;
    await sleep(5); manager.list();
    assert.equal(manager.list()[0].expiresAt, expiry);
    await manager.call('browser_navigate', { instanceId: b.instanceId, url: 'https://example.com' });
    assert.deepEqual(connections[1].calls, [{ name: 'browser_navigate', arguments: { url: 'https://example.com' } }]);
    assert.equal(connections[0].calls.length, 0);
    assert.equal(connections[0].config.protect, true);
    assert.equal(connections[1].config.protect, false);
    await manager.stop(a.instanceId);
    assert.throws(() => manager.call('browser_snapshot', { instanceId: a.instanceId }), /unavailable/);
  } finally { await manager.close(); }
});
test('queue is serial, retains running work, stop drains it and rejects new work', async () => {
  const { manager, connections } = fixture();
  const a = await manager.start({ idleTimeoutMs: 15 });
  let release;
  connections[0].call = async request => {
    connections[0].calls.push(request);
    if (request.name === 'first') await new Promise(resolve => { release = resolve; });
    return { content: [] };
  };
  const first = manager.call('first', { instanceId: a.instanceId });
  const second = manager.call('second', { instanceId: a.instanceId });
  await sleep(35);
  assert.equal(connections[0].calls.length, 1);
  assert.equal(connections[0].closed, false);
  const stop = manager.stop(a.instanceId);
  assert.throws(() => manager.call('third', { instanceId: a.instanceId }));
  release(); await Promise.all([first, second, stop]);
  assert.equal(connections[0].closed, true);
  assert.equal(connections[0].calls.length, 2);
});
test('idle expiry closes once; same ID cannot restart; browser_close safely detaches', async () => {
  const { manager, connections } = fixture();
  const a = await manager.start({ idleTimeoutMs: 15 });
  await sleep(50);
  assert.equal(manager.list()[0].reason, 'idle-expired');
  assert.throws(() => manager.call('browser_snapshot', { instanceId: a.instanceId }));
  const b = await manager.start({ mode: 'extension' });
  await manager.call('browser_close', { instanceId: b.instanceId });
  await sleep(5);
  assert.equal(connections[1].calls.length, 0);
  assert.equal(connections[1].closed, true);
  await manager.close();
});
test('operation failure releases queue and does not replay', async () => {
  const { manager, connections } = fixture();
  const a = await manager.start({ idleTimeoutMs: 0 });
  let calls = 0;
  connections[0].call = async () => { if (++calls === 1) throw new Error('failed'); return { content: [] }; };
  await assert.rejects(manager.call('click', { instanceId: a.instanceId }), /failed/);
  await manager.call('snapshot', { instanceId: a.instanceId });
  assert.equal(calls, 2); assert.equal(manager.list()[0].pending, 0);
  await manager.close();
});
test('shutdown during startup closes the late connection', async () => {
  const { manager, connections } = fixture();
  const open = manager.open;
  let release;
  manager.open = async (...args) => { await new Promise(resolve => { release = resolve; }); return open(...args); };
  const start = manager.start({});
  await sleep(1); await manager.close(); release();
  await assert.rejects(start, /closed during startup/);
  assert.equal(connections[0].closed, true);
});
test('forced stop interrupts work without waiting for the queue', async () => {
  const { manager, connections } = fixture();
  const a = await manager.start({ idleTimeoutMs: 0 });
  let rejectCall;
  connections[0].call = () => new Promise((_resolve, reject) => { rejectCall = reject; });
  connections[0].close = async () => { rejectCall(new Error('connection closed')); };
  const work = manager.call('hung', { instanceId: a.instanceId });
  const rejected = assert.rejects(work, /connection closed/);
  await sleep(1);
  const stopped = await manager.stop(a.instanceId, 'forced-stop', true);
  await rejected;
  assert.equal(stopped.state, 'closed');
  assert.equal(stopped.reason, 'forced-stop');
});
