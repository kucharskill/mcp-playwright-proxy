import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const entry = resolve(process.argv[2] ?? 'src/cli.js');
const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env: { ...process.env, PW_PROXY_RUNNER: process.env.PW_PROXY_RUNNER ?? 'local', PW_PROXY_WORKER_IDLE_MS: '500', PW_PROXY_DISCOVERY_CACHE_MS: '30000', PW_PROXY_DIAGNOSTICS: '1' }, stderr: 'pipe' });
let logs = '';
transport.stderr.on('data', chunk => { logs += chunk; });
const starts = () => (logs.match(/"event":"worker-started"/g) ?? []).length;
const client = new Client({ name: 'lifecycle-smoke', version: '1' });
try {
  await client.connect(transport, { timeout: 180000 });
  await client.listTools({}, { timeout: 180000 });
  assert.equal(starts(), 1);
  for (let i = 0; i < 100 && !logs.includes('worker-idle-expired'); i++) await sleep(100);
  assert.ok(logs.includes('worker-idle-expired'));
  await sleep(300);
  await client.listTools({}, { timeout: 180000 });
  assert.equal(starts(), 1, 'cached discovery restarted worker');
  const result = await client.callTool({ name: 'browser_instance_list', arguments: {} }, undefined, { timeout: 180000 });
  assert.ok(!result.isError, JSON.stringify(result));
  assert.equal(starts(), 2);
  console.log(JSON.stringify({ discoveryCacheWithoutWorker: 'passed', idleWorkerExit: 'passed', lazyRestart: 'passed' }));
} catch (error) { console.error(logs); throw error; }
finally { await client.close(); }
