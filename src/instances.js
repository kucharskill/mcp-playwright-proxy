import { randomUUID } from 'node:crypto';
import { optionsSchema, upstreamArgs, withInstance, controls } from './options.js';
import { connect } from './connection.js';
import { resolveLatest } from './resolve.js';
import { log } from './meta.js';

export class Instances {
  constructor({ resolve = () => resolveLatest('@playwright/mcp'), open = connect, cwd = process.cwd(), roots, changed, stateChanged = () => {} } = {}) {
    Object.assign(this, { resolve, open, cwd, roots, changed, stateChanged });
    this.items = new Map();
    this.closed = false;
    this.pending = 0;
  }
  async connection(options, disconnected) {
    const resolved = await this.resolve();
    if (this.closed) throw new Error('Worker is closing');
    const connection = await this.open([resolved.entry, ...upstreamArgs(options, this.cwd)], { cwd: this.cwd, protect: options.mode !== 'extension', roots: this.roots, changed: this.changed, disconnected });
    return { connection, version: resolved.version };
  }
  async manifest() {
    const { connection } = await this.connection({ mode: 'launch', headless: true, isolated: true });
    try {
      const result = await connection.list();
      return { tools: [...controls, ...result.tools.map(withInstance)] };
    } finally { await connection.close(); }
  }
  async start(input) {
    if (this.closed) throw new Error('Worker is closing');
    const options = optionsSchema.parse(input);
    const item = { instanceId: randomUUID(), state: 'starting', options, queue: Promise.resolve(), pending: 0 };
    this.items.set(item.instanceId, item);
    this.stateChanged();
    try {
      const { connection, version } = await this.connection(options, () => { if (item.state === 'open') void this.stop(item.instanceId, 'disconnected'); });
      item.connection = connection;
      item.version = version;
      if (this.closed || item.state !== 'starting') { await connection.close(); throw new Error('Instance closed during startup'); }
      item.state = 'open';
      this.arm(item);
      log({ event: 'instance-started', instanceId: item.instanceId, mode: options.mode, version });
      return this.describe(item);
    } catch (error) {
      item.state = 'closed'; item.reason = 'startup-failed'; this.stateChanged(); throw error;
    }
  }
  describe(item) {
    return { instanceId: item.instanceId, state: item.state, mode: item.options.mode, browser: item.options.browser ?? (item.options.executablePath ? 'custom' : item.options.mode === 'launch' ? 'msedge' : 'chrome'), version: item.version, pending: item.pending, expiresAt: item.expiresAt ?? null, reason: item.reason };
  }
  list() { return [...this.items.values()].map(item => this.describe(item)); }
  hasLive() { return [...this.items.values()].some(item => item.state !== 'closed'); }
  arm(item) {
    clearTimeout(item.timer);
    item.expiresAt = null;
    if (item.state !== 'open' || item.pending || !item.options.idleTimeoutMs) return;
    item.expiresAt = Date.now() + item.options.idleTimeoutMs;
    item.timer = setTimeout(() => { void this.stop(item.instanceId, 'idle-expired'); }, item.options.idleTimeoutMs);
    item.timer.unref();
  }
  call(name, args) {
    const { instanceId, ...arguments_ } = args;
    const item = this.items.get(instanceId);
    if (!item || item.state !== 'open') throw new Error(`Instance is unavailable (${item?.reason ?? item?.state ?? 'unknown'}). Start a new instance.`);
    item.pending++;
    if (name === 'browser_close') item.state = 'closing';
    this.arm(item);
    const execution = item.queue.then(async () => {
      // browser_close is interpreted as executor shutdown, including safe extension detach.
      if (name === 'browser_close') return { content: [{ type: 'text', text: 'Instance closed.' }] };
      return item.connection.call({ name, arguments: arguments_ });
    });
    item.queue = execution.catch(() => {});
    return execution.finally(() => {
      item.pending--;
      if (name === 'browser_close') queueMicrotask(() => { void this.stop(instanceId, 'browser-close'); });
      else this.arm(item);
    });
  }
  stop(id, reason = 'explicit-stop') {
    const item = this.items.get(id);
    if (!item) throw new Error('Unknown instanceId');
    if (item.stopPromise) return item.stopPromise;
    if (item.state === 'closed') return Promise.resolve(this.describe(item));
    item.state = 'closing'; clearTimeout(item.timer); item.expiresAt = null;
    item.stopPromise = (async () => {
      await item.queue;
      try { await item.connection?.close(); }
      finally {
        item.state = 'closed'; item.reason = reason;
        log({ event: 'instance-closed', instanceId: id, reason });
        // Bound tombstones. IDs are never reused.
        const dead = [...this.items.values()].filter(x => x.state === 'closed');
        for (const old of dead.slice(0, Math.max(0, dead.length - 100))) this.items.delete(old.instanceId);
        this.stateChanged();
      }
      return this.describe(item);
    })();
    return item.stopPromise;
  }
  async close() {
    this.closed = true;
    // On transport loss do not wait indefinitely for queued browser work.
    await Promise.allSettled([...this.items.values()].map(async item => {
      clearTimeout(item.timer); item.state = 'closing';
      await item.connection?.close(); item.state = 'closed';
    }));
  }
}
