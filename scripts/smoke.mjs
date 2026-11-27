import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const entry = resolve(process.argv[2] ?? 'src/cli.js');
const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env: { ...process.env, PW_PROXY_RUNNER: 'local' }, stderr: 'inherit' });
const client = new Client({ name: 'package-smoke', version: '1' });
try {
  await client.connect(transport, { timeout: 180000 });
  const { tools } = await client.listTools({}, { timeout: 180000 });
  assert.ok(tools.some(x => x.name === 'browser_instance_start'));
  assert.ok(tools.some(x => x.name === 'browser_navigate' && x.inputSchema.required.includes('instanceId')));
  const started = await client.callTool({ name: 'browser_instance_start', arguments: { browser: process.env.PW_SMOKE_BROWSER ?? 'msedge', headless: true, isolated: true } }, undefined, { timeout: 180000 });
  assert.ok(!started.isError, JSON.stringify(started));
  const { instanceId } = JSON.parse(started.content[0].text);
  const navigated = await client.callTool({ name: 'browser_navigate', arguments: { instanceId, url: 'data:text/html,<title>Proxy smoke</title><h1>Proxy smoke</h1><button>Test</button>' } }, undefined, { timeout: 180000 });
  assert.ok(!navigated.isError, JSON.stringify(navigated));
  const snapshot = await client.callTool({ name: 'browser_snapshot', arguments: { instanceId } });
  assert.ok(!snapshot.isError && JSON.stringify(snapshot).includes('Proxy smoke'), JSON.stringify(snapshot));
  const stop = await client.callTool({ name: 'browser_instance_stop', arguments: { instanceId } });
  assert.ok(!stop.isError, JSON.stringify(stop));
  const stale = await client.callTool({ name: 'browser_snapshot', arguments: { instanceId } });
  assert.equal(stale.isError, true);
  console.log(JSON.stringify({ tools: tools.length, navigate: 'passed', snapshot: 'passed', stop: 'passed', closedId: 'passed' }));
} finally { await client.close(); }
