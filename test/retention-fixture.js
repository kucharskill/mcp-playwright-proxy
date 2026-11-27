import { appendFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { startWorker } from '../src/worker.js';
const record = event => appendFileSync(process.env.PW_FIXTURE_EVENTS, JSON.stringify({ event, time: Date.now() }) + '\n');
await startWorker({ createInstances: () => ({
  items: new Map(), hasLive: () => false,
  manifest: async () => ({ tools: [{ name: 'fixture_tool', inputSchema: { type: 'object', properties: { delay: { type: 'number' } } } }] }),
  call: async (_name, args) => { record('started'); await sleep(args.delay ?? 0); record('finished'); return { content: [{ type: 'text', text: 'done' }] }; },
  close: async () => record('closed'),
}) });
