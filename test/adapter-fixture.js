import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const { startAdapter } = await import(process.env.PW_TEST_PACKAGE ? pathToFileURL(resolve(process.env.PW_TEST_PACKAGE, 'src/adapter.js')).href : '../src/adapter.js');
await startAdapter({ mode: 'local', target: { command: process.execPath, args: [fileURLToPath(new URL(process.env.PW_TEST_EXTENDED_WORKER ? './extended-worker-fixture.js' : './worker-fixture.js', import.meta.url))], cwd: process.cwd(), env: process.env } });
