import { mkdirSync, writeFileSync } from 'node:fs';
import spawn from 'cross-spawn';
mkdirSync('.tmp/releases', { recursive: true });
const result = spawn.sync('npm', ['pack', '--json', '--pack-destination', '.tmp/releases'], { encoding: 'utf8' });
if (result.status) throw new Error(result.stderr);
const packed = JSON.parse(result.stdout);
const archive = Array.isArray(packed) ? packed[0] : Object.values(packed)[0];
for (const file of archive.files) {
  if (!/^(src\/[a-z-]+\.js|package\.json|README\.md|LICENSE)$/.test(file.path)) throw new Error(`Unexpected archive file: ${file.path}`);
}
writeFileSync('.tmp/releases/archive.json', JSON.stringify(archive, null, 2));
console.log(JSON.stringify({ filename: archive.filename, integrity: archive.integrity, files: archive.files.map(x => x.path) }, null, 2));
