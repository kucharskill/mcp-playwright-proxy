import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
for (const dir of ['src', 'scripts']) for (const name of readdirSync(dir).filter(x => /\.(m?js)$/.test(x))) {
  const result = spawnSync(process.execPath, ['--check', `${dir}/${name}`], { stdio: 'inherit' });
  if (result.status) process.exit(result.status);
}
const result = spawnSync(process.execPath, ['--test', ...readdirSync('test').filter(x => x.endsWith('.test.js')).map(x => `test/${x}`)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
