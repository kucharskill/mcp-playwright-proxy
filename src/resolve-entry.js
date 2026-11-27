import { existsSync, readFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
const name = process.argv[2];
if (!['@playwright/mcp', 'mcp-playwright-proxy'].includes(name)) throw new Error('Unsupported package');
for (const bin of (process.env.PATH ?? process.env.Path ?? '').split(delimiter)) {
  if (!bin || !/[\\/]node_modules[\\/]\.bin[\\/]?$/.test(bin)) continue;
  const root = resolve(dirname(bin), name);
  const file = join(root, 'package.json');
  if (!existsSync(file)) continue;
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  if (pkg.name !== name) continue;
  const entry = typeof pkg.bin === 'string' ? pkg.bin : Object.values(pkg.bin ?? {})[0];
  if (!entry) continue;
  console.log(JSON.stringify({ entry: resolve(root, entry), version: pkg.version }));
  process.exit(0);
}
throw new Error('npm did not expose the requested package entry point');
