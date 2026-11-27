import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { InitializeResultSchema, ListToolsResultSchema, SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/sdk/types.js';

const digest = text => createHash('sha256').update(text).digest('hex');
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
export const sameIdentity = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));

/** Hash only the requested target invocation, never host/gate or replica identifiers. */
export function invocationKey({ command, args = [], cwd = process.cwd(), env = process.env }, {
  ignoredEnv = ['CODEX_TOOL_CALL_ID'], platform = process.platform,
} = {}) {
  const name = key => platform === 'win32' ? key.toUpperCase() : key;
  const ignored = new Set(ignoredEnv.map(name));
  const environment = new Map();
  // Node selects the first lexically sorted spelling of duplicate Windows names.
  for (const key of Object.keys(env).sort()) {
    const upper = key.toUpperCase();
    if (upper === 'PATH' || upper.startsWith('INIT_') || upper.startsWith('NPM_')) continue;
    const normalized = name(key);
    if (env[key] !== undefined && !ignored.has(normalized) && !environment.has(normalized)) environment.set(normalized, String(env[key]));
  }
  return digest(JSON.stringify([String(command), args.map(String), resolve(cwd), [...environment].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)]));
}

function validPayload(value) {
  return InitializeResultSchema.safeParse(value?.identity).success
    && SUPPORTED_PROTOCOL_VERSIONS.includes(value.identity.protocolVersion)
    && ListToolsResultSchema.safeParse(value?.manifest).success
    && !value.manifest.nextCursor;
}

/** One atomic JSON record per invocation. Only short file writes hold a lock. */
export class DiscoveryCache {
  constructor({ target, load, ttlMs = 600000, directory = join(tmpdir(), 'mcp-playwright-proxy', 'discovery'), ignoredEnv = ['CODEX_TOOL_CALL_ID'], now = Date.now }) {
    this.key = invocationKey(target, { ignoredEnv });
    Object.assign(this, { load, ttlMs, directory, now });
    this.path = join(directory, `${this.key}.json`);
    this.lockPath = `${this.path}.lock`;
  }
  async record() {
    try {
      const raw = await readFile(this.path, 'utf8');
      let value;
      try { value = JSON.parse(raw); } catch {}
      return { revision: digest(raw), value };
    } catch (error) {
      if (!['ENOENT', 'EACCES', 'EPERM'].includes(error.code)) throw error;
      return { revision: null };
    }
  }
  fresh(record) {
    const value = record.value;
    const now = this.now();
    return this.ttlMs > 0 && value?.format === 1 && value.key === this.key
      && Number.isSafeInteger(value.writtenAt) && Number.isSafeInteger(value.expiresAt)
      && value.writtenAt <= now && value.expiresAt > now
      && value.expiresAt > value.writtenAt && value.expiresAt - value.writtenAt <= this.ttlMs
      && validPayload(value);
  }
  async locked(operation) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    let handle;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        handle = await open(this.lockPath, 'wx', 0o600);
        try { await handle.writeFile(JSON.stringify({ pid: process.pid })); }
        catch (error) { await handle.close(); await unlink(this.lockPath).catch(() => {}); throw error; }
        break;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        // Recover a lock left by a dead writer. Never steal from a live process.
        try {
          const age = this.now() - (await stat(this.lockPath)).mtimeMs;
          if (age > 10000) {
            const owner = JSON.parse(await readFile(this.lockPath, 'utf8'));
            try { process.kill(owner.pid, 0); }
            catch (failure) { if (failure.code === 'ESRCH') await unlink(this.lockPath); }
          }
        } catch {}
        await sleep(20);
      }
    }
    if (!handle) throw new Error('Discovery cache write lock timed out');
    try { return await operation(); }
    finally { await handle.close(); await unlink(this.lockPath).catch(() => {}); }
  }
  async write(value) {
    const temporary = join(this.directory, `${this.key}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
      await rename(temporary, this.path);
    } finally { await unlink(temporary).catch(() => {}); }
  }
  async invalidate() {
    // A persistent tombstone also stops a discovery already in flight from publishing stale data.
    await this.locked(() => this.write({ format: 1, key: this.key, invalidated: randomUUID() }));
  }
  async observeIdentity(identity) {
    const { value } = await this.record();
    if (value?.key === this.key && value.identity && !sameIdentity(value.identity, identity)) await this.invalidate();
  }
  async get() {
    const initial = await this.record();
    if (this.fresh(initial)) return initial.value.manifest;
    if (!this.loading) this.loading = (async () => {
      const loaded = await this.load();
      if (!validPayload(loaded)) throw new Error('Invalid discovery metadata from backend');
      if (this.ttlMs > 0) await this.locked(async () => {
        const current = await this.record();
        if (current.revision !== initial.revision) return; // Another writer or invalidation won.
        const writtenAt = this.now();
        await this.write({ format: 1, key: this.key, writtenAt, expiresAt: writtenAt + this.ttlMs,
          identity: loaded.identity, manifest: { tools: loaded.manifest.tools } });
      });
      return loaded.manifest;
    })().finally(() => { this.loading = undefined; });
    return this.loading;
  }
}
