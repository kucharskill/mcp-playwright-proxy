import { DiscoveryCache } from '../src/discovery-cache.js';
const cache = new DiscoveryCache({ target: { command: 'node', args: ['fixture-worker'], cwd: process.cwd(), env: { API_KEY: 'fixture-secret' } }, directory: process.argv[2], load: async () => ({ identity: { protocolVersion: '2025-11-25', serverInfo: { name: 'fixture', version: '1' }, capabilities: { tools: {} } }, manifest: { tools: [{ name: 'fixture_tool', inputSchema: { type: 'object' } }] } }) });
await cache.get();
