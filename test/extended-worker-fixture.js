import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const moduleUrl = name => process.env.PW_TEST_PACKAGE ? pathToFileURL(resolve(process.env.PW_TEST_PACKAGE, 'src', name)).href : new URL(`../src/${name}`, import.meta.url).href;
const { startWorker } = await import(moduleUrl('worker.js'));
const { Instances } = await import(moduleUrl('instances.js'));
await startWorker({ createInstances: options => new Instances({ ...options,
  resolve: async () => ({ entry: fileURLToPath(new URL('./worker-fixture.js', import.meta.url)), version: 'fixture-1' }),
}) });
