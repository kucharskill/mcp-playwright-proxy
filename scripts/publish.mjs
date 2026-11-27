import { readFileSync } from 'node:fs';
import spawn from 'cross-spawn';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const archive = JSON.parse(readFileSync('.tmp/releases/archive.json', 'utf8'));
if (process.env.GITHUB_REF_NAME !== `v${pkg.version}`) throw new Error('Tag does not match package version');
if (process.env.GITHUB_REPOSITORY !== 'kucharskill/mcp-playwright-proxy') throw new Error('Unexpected publishing repository');
const response = await fetch(`https://registry.npmjs.org/${pkg.name}/${pkg.version}`);
if (response.ok) {
  const existing = await response.json();
  if (existing.dist?.integrity !== archive.integrity) throw new Error('Published version has different integrity');
  console.log('Matching version already published');
} else {
  if (response.status !== 404) throw new Error(`Registry check failed: ${response.status}`);
  const result = spawn.sync('npm', ['publish', `.tmp/releases/${archive.filename}`, '--ignore-scripts', '--access', 'public', '--tag', pkg.version.includes('-') ? 'next' : 'latest', '--provenance'], { stdio: 'inherit' });
  if (result.status) process.exit(result.status);
}
