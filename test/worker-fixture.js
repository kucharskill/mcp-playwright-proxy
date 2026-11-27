import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const configPath = process.env.PW_FIXTURE_CONFIG;
const config = () => JSON.parse(readFileSync(configPath, 'utf8'));
const initial = config();
const record = event => appendFileSync(initial.events, JSON.stringify({ event }) + '\n');
record('start');
const server = new Server({ name: 'fixture-worker', version: initial.version }, { capabilities: { tools: { listChanged: true } }, instructions: 'Fixture instructions' });
let timer;
function idle() { clearTimeout(timer); timer = setTimeout(() => { record('idle'); void server.close(); }, 1000); }
server.setRequestHandler(ListToolsRequestSchema, async () => {
  record('list'); idle();
  return { tools: [{ name: config().tool, description: 'Fixture discovery metadata', inputSchema: { type: 'object', properties: { delay: { type: 'number' } } }, annotations: { readOnlyHint: true } }] };
});
server.setRequestHandler(CallToolRequestSchema, async request => {
  record('call'); clearTimeout(timer);
  if (request.params.arguments?.delay) await sleep(request.params.arguments.delay);
  if (request.params.name === 'update') {
    writeFileSync(configPath, JSON.stringify({ ...config(), tool: 'updated_tool' }));
    await server.sendToolListChanged();
  }
  idle();
  record('finished');
  return { content: [{ type: 'text', text: JSON.stringify({ callId: process.env.CODEX_TOOL_CALL_ID, hostEnv: process.env.PW_PROXY_HOST,
    path: process.env.PATH, initCwd: process.env.INIT_CWD, npmPrefix: process.env.npm_config_local_prefix, npmPackage: process.env.npm_package_json }) }] };
});
process.stdin.once('end', () => { clearTimeout(timer); void server.close(); });
await server.connect(new StdioServerTransport()); idle();
