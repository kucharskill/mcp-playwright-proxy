import { fileURLToPath } from 'node:url';
import { serve } from './server.js';
import { connect } from './connection.js';
import { resolveLatest } from './resolve.js';
import { metadata, milliseconds, log } from './meta.js';
import { DiscoveryCache } from './discovery-cache.js';
import { dumpStartupEnvironment } from './env-startup.js';

export function runnerMode(env = process.env) {
  const explicit = env.PW_PROXY_RUNNER;
  if (explicit && !['local', 'latest'].includes(explicit)) throw new Error('PW_PROXY_RUNNER must be local or latest');
  if (explicit) return explicit;
  return /[\\/]_npx[\\/]/.test(fileURLToPath(import.meta.url)) && env.npm_command === 'exec' ? 'latest' : 'local';
}
export function workerTarget(mode, env = process.env, cwd = process.cwd()) {
  return { command: mode === 'latest' ? 'npx' : process.execPath,
    args: mode === 'latest' ? ['-y', '--prefer-online', `${metadata.name}@latest`, '--worker'] : [fileURLToPath(new URL('./cli.js', import.meta.url)), '--worker'], cwd, env };
}
export async function startAdapter({ mode = runnerMode(), target = workerTarget(mode), open = connect } = {}) {
  await dumpStartupEnvironment();
  let handle;
  let current;
  let starting;
  let closed = false;
  let invalidation = Promise.resolve();
  const invalidate = () => {
    invalidation = invalidation.then(() => cache.invalidate());
    void invalidation.then(() => handle?.server.sendToolListChanged()).catch(() => {});
  };
  const cache = new DiscoveryCache({ target,
    ttlMs: milliseconds('PW_PROXY_DISCOVERY_CACHE_MS', 600000),
    directory: process.env.PW_PROXY_DISCOVERY_CACHE_DIR,
    ignoredEnv: ['CODEX_TOOL_CALL_ID', ...(process.env.PW_PROXY_CACHE_IGNORE_ENV ?? '').split(',').map(x => x.trim()).filter(Boolean)],
    load: async () => { const connection = await worker(); return { identity: connection.identity(), manifest: await connection.list() }; },
  });
  async function worker() {
    if (closed) throw new Error('Adapter is closing');
    if (current) return current;
    if (!starting) starting = (async () => {
      const args = mode === 'latest' ? [(await resolveLatest(metadata.name)).entry, '--worker'] : target.args;
      if (closed) throw new Error('Adapter is closing');
      let connection;
      connection = await open(args, {
        cwd: target.cwd, env: target.env,
        protect: false, // A worker may attach to a user-owned browser. Its launch executors own Jobs.
        roots: () => handle.server.getClientCapabilities()?.roots ? handle.server.listRoots() : { roots: [] },
        changed: invalidate,
        disconnected: () => { if (current === connection) current = undefined; },
      });
      if (closed) { await connection.close(); throw new Error('Adapter is closing'); }
      current = connection;
      await cache.observeIdentity(connection.identity());
      log({ event: 'worker-started', mode, version: connection.client.getServerVersion().version });
      return connection;
    })().finally(() => { starting = undefined; });
    return starting;
  }
  handle = await serve({
    list: async () => { await invalidation; return cache.get(); },
    call: async params => (await worker()).call(params),
    close: async () => { closed = true; await current?.close(); await starting?.catch(() => {}); },
    rootsChanged: () => { void current?.client.sendRootsListChanged().catch(() => {}); },
  });
}
