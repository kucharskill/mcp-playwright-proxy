import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { connect } from '../src/connection.js';
import { runnerMode } from '../src/adapter.js';
test('local development stays local with explicit latest override', () => {
  assert.equal(runnerMode({}), 'local');
  assert.equal(runnerMode({ PW_PROXY_RUNNER: 'latest' }), 'latest');
  assert.throws(() => runnerMode({ PW_PROXY_RUNNER: 'other' }));
});
test('discovery collects every page before caching a catalog', async () => {
  const c = await connect([fileURLToPath(new URL('./pagination-fixture.js', import.meta.url))]);
  try { assert.deepEqual((await c.list()).tools.map(x => x.name), ['first_page', 'second_page']); }
  finally { await c.close(); }
});
test('gated owned transport starts, discovers, executes and closes', async () => {
  const c = await connect([fileURLToPath(new URL('./fixture.js', import.meta.url))]);
  try {
    assert.equal((await c.list()).tools[0].name, 'ping');
    const result = await c.call({ name: 'ping', arguments: {} });
    assert.equal(result.content[0].text, 'pong');
  } finally { await c.close(); }
});
