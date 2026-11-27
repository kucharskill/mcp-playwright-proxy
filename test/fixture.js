import { serve, textResult } from '../src/server.js';
await serve({ list: () => ({ tools: [{ name: 'ping', inputSchema: { type: 'object' } }] }), call: () => ({ content: [{ type: 'text', text: 'pong' }] }), close: async () => {} });
