import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { info } from './meta.js';
export const textResult = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
export async function serve({ list, call, close, rootsChanged }) {
  // SDK 1.x handles initialize and legacy ping locally. Neither touches the worker.
  // Advertise only this tools facade, not unsupported cached upstream capabilities.
  const server = new Server(info, { capabilities: { tools: { listChanged: true } } });
  server.setRequestHandler(ListToolsRequestSchema, list);
  server.setRequestHandler(CallToolRequestSchema, async request => {
    try { return await call(request.params); }
    catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });
  if (rootsChanged) {
    const { RootsListChangedNotificationSchema } = await import('@modelcontextprotocol/sdk/types.js');
    server.setNotificationHandler(RootsListChangedNotificationSchema, rootsChanged);
  }
  let closing;
  const shutdown = () => closing ??= (async () => { await close(); await server.close(); })();
  const transport = new StdioServerTransport();
  transport.onclose = () => { void shutdown(); };
  process.stdin.once('end', () => { void shutdown(); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void shutdown(); });
  await server.connect(transport);
  return { server, shutdown };
}
