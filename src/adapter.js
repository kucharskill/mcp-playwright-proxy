import { fileURLToPath } from 'node:url';
import { serve } from './server.js';
import { connect } from './connection.js';
import { resolveLatest } from './resolve.js';
import { metadata, milliseconds, log } from './meta.js';

export function runnerMode(env = process.env) {
  const explicit = env.PW_PROXY_RUNNER;
  if (explicit && !['local', 'latest'].includes(explicit)) throw new Error('PW_PROXY_RUNNER must be local or latest');
  if (explicit) return explicit;
  return /[\\/]_npx[\\/]/.test(fileURLToPath(import.meta.url)) && env.npm_command === 'exec' ? 'latest' : 'local';
}
export async function startAdapter() {
  const mode = runnerMode();
  let handle;
  let current;
  let starting;
  let cached;
  let loading;
  let closed = false;
  const invalidate = () => { cached = undefined; void handle?.server.sendToolListChanged().catch(() => {}); };
  async function worker() {
    if (closed) throw new Error('Adapter is closing');
    if (current) return current;
    if (!starting) starting = (async () => {
      const resolved = mode === 'latest' ? await resolveLatest(metadata.name) : { entry: fileURLToPath(new URL('./cli.js', import.meta.url)), version: metadata.version };
      if (closed) throw new Error('Adapter is closing');
      let connection;
      connection = await connect([resolved.entry, '--worker'], {
        protect: false, // A worker may attach to a user-owned browser. Its launch executors own Jobs.
        roots: () => handle.server.getClientCapabilities()?.roots ? handle.server.listRoots() : { roots: [] },
        changed: invalidate,
        disconnected: () => { if (current === connection) current = undefined; },
      });
      if (closed) { await connection.close(); throw new Error('Adapter is closing'); }
      current = connection;
      if (cached && cached.version !== resolved.version) invalidate();
      log({ event: 'worker-started', mode, version: resolved.version });
      return connection;
    })().finally(() => { starting = undefined; });
    return starting;
  }
  handle = await serve({
    list: async () => {
      if (cached && Date.now() < cached.expires) return cached.value;
      loading ??= (async () => {
        const connection = await worker();
        const value = await connection.list();
        cached = { value, version: connection.client.getServerVersion().version, expires: Date.now() + milliseconds('PW_PROXY_DISCOVERY_CACHE_MS', 300000) };
        return value;
      })().finally(() => { loading = undefined; });
      return loading;
    },
    call: async params => (await worker()).call(params),
    close: async () => { closed = true; await current?.close(); await starting?.catch(() => {}); },
    rootsChanged: () => { void current?.client.sendRootsListChanged().catch(() => {}); },
  });
}
