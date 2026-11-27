import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { dumpStartupEnvironment } from '../src/env-startup.js';

test('startup evidence appends original env records without overwriting earlier replicas', async t => {
  const directory = resolve('.tmp', `env-startup-${randomUUID()}`);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const first = { TOKEN: 'synthetic-secret', CODEX_TOOL_CALL_ID: 'first', PATH: 'fixture-path' };
  const second = { ...first, CODEX_TOOL_CALL_ID: 'second' };
  const startedAt = '2026-11-27T00:00:00.000Z';
  await dumpStartupEnvironment({ directory, pid: 1, startedAt, env: first });
  await dumpStartupEnvironment({ directory, pid: 2, startedAt, env: second });
  const file = resolve(directory, 'env-startup.jsonl');
  const records = (await readFile(file, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(records, [{ pid: 1, startedAt, env: first }, { pid: 2, startedAt, env: second }]);
  if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
});
test('startup evidence failure is best-effort', async t => {
  const directory = resolve('.tmp', `env-error-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  t.after(() => rm(directory, { recursive: true, force: true }));
  const blocked = resolve(directory, 'file'); await writeFile(blocked, 'fixture');
  await assert.doesNotReject(dumpStartupEnvironment({ directory: blocked, env: {} }));
});
