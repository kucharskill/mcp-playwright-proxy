import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { fileURLToPath } from 'node:url';
import { createJob } from './job.js';
import { info, milliseconds } from './meta.js';
import { LosslessCatalogSchema } from './catalog.js';

class DiscoveryClient extends Client {
  request(request, schema, options) {
    return super.request(request, request.method === 'tools/list' ? LosslessCatalogSchema : schema, options);
  }
}

class OwnedTransport extends StdioClientTransport {
  async start() {
    this.job = this.protect ? await createJob() : undefined;
    try {
      await super.start();
      this.job?.assign(this.pid);
      await this.send({ jsonrpc: '2.0', method: 'proxy/gate' });
    } catch (error) { await this.close(); throw error; }
  }
  async close() {
    try { await super.close(); } finally { this.job?.close(); }
  }
}

export async function connect(args, { cwd = process.cwd(), protect = true, roots, changed, disconnected, env = process.env } = {}) {
  const transport = new OwnedTransport({
    command: process.execPath, args: [fileURLToPath(new URL('./host.js', import.meta.url))],
    cwd, env: { ...env, PW_PROXY_HOST: JSON.stringify({ args, cwd, protect, originalHostEnv: env.PW_PROXY_HOST }) }, stderr: 'inherit',
  });
  transport.protect = protect;
  let protocolVersion;
  transport.setProtocolVersion = version => { protocolVersion = version; };
  const client = new DiscoveryClient(info, { capabilities: { roots: { listChanged: true } } });
  client.setRequestHandler(ListRootsRequestSchema, () => roots?.() ?? { roots: [] });
  // Notifications are registered below using their protocol schemas.
  const { ToolListChangedNotificationSchema } = await import('@modelcontextprotocol/sdk/types.js');
  client.setNotificationHandler(ToolListChangedNotificationSchema, () => changed?.());
  client.onclose = () => disconnected?.();
  try { await client.connect(transport, { timeout: milliseconds('PW_PROXY_STARTUP_MS', 180000) }); }
  catch (error) { await transport.close(); throw error; }
  return {
    client, pid: transport.pid,
    identity: () => ({ protocolVersion, serverInfo: client.getServerVersion(), capabilities: client.getServerCapabilities(),
      ...(client.getInstructions() ? { instructions: client.getInstructions() } : {}) }),
    list: async () => {
      const tools = [];
      const seen = new Set();
      let result;
      let cursor;
      do {
        const page = await client.listTools(cursor ? { cursor } : {}, { timeout: milliseconds('PW_PROXY_REQUEST_MS', 180000) });
        result = { ...result, ...page };
        tools.push(...page.tools);
        cursor = page.nextCursor;
        if (cursor && seen.has(cursor)) throw new Error('Repeated discovery cursor');
        seen.add(cursor);
      } while (cursor);
      // Pagination is consumed here; the public result is the complete merged catalog.
      const { nextCursor, ...complete } = result;
      return { ...complete, tools };
    },
    // No protocol timeout here: a client timeout must not release active execution.
    call: params => client.callTool(params, undefined, { timeout: 2147483647, maxTotalTimeout: 2147483647 }),
    close: () => client.close(),
  };
}
