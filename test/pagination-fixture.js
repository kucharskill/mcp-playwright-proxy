import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const server = new Server({ name: 'pagination-fixture', version: '1' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, request => ({
  tools: [{ name: request.params?.cursor ? 'second_page' : 'first_page', inputSchema: { type: 'object' } }],
  ...(request.params?.cursor ? {} : { nextCursor: 'next' }),
}));
process.stdin.once('end', () => { void server.close(); });
await server.connect(new StdioServerTransport());
