import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import spawn from 'cross-spawn';

export function nextVersion(versions, increment = 'patch') {
  if (!['patch', 'minor', 'major'].includes(increment)) throw new Error('Invalid Release-As instruction');
  const sorted = versions.filter(v => /^\d+\.\d+\.\d+$/.test(v)).map(v => v.split('.').map(Number)).sort((a,b) => a[0]-b[0] || a[1]-b[1] || a[2]-b[2]);
  const [major, minor, patch] = sorted.at(-1) ?? [0,0,0];
  return increment === 'major' ? `${major+1}.0.0` : increment === 'minor' ? `${major}.${minor+1}.0` : `${major}.${minor}.${patch+1}`;
}
export function releaseInstruction(message) {
  const instruction = message.match(/^Release-As:\s*(\S+)\s*$/mi)?.[1] ?? 'patch';
  if (!['patch','minor','major'].includes(instruction)) throw new Error('Invalid Release-As instruction');
  return instruction;
}
export function run(command, args, cwd = process.cwd(), env = {}) {
  const result = spawn.sync(command, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}
export function sourceQueue(git, baseline, target) {
  git(['merge-base', '--is-ancestor', baseline, target]);
  return git(['rev-list', '--reverse', '--topo-order', `${baseline}..${target}`]).split('\n').filter(Boolean);
}
async function main() {
  if (process.env.GITHUB_REPOSITORY !== 'kucharskill/mcp-playwright-proxy') throw new Error('Unexpected repository');
  const git = args => run('git', args);
  git(['fetch', 'origin', 'main', '--tags']);
  git(['config', 'user.name', 'github-actions[bot]']);
  git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
  if (!/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? '')) throw new Error('Missing workflow source commit');
  const baseline = git(['rev-parse','v0.1.7^{commit}']);
  const sources = sourceQueue(git, baseline, process.env.GITHUB_SHA);
  const root = process.cwd();
  mkdirSync('.tmp', { recursive: true });
  for (const source of sources) {
    const assignment = `release-source/${source}`;
    let assigned;
    try { assigned = git(['rev-parse', '--verify', `refs/tags/${assignment}^{commit}`]); } catch {}
    const directory = resolve('.tmp', `release-${source}`);
    git(['worktree', 'add', '--detach', directory, assigned ?? source]);
    const work = args => run('git', args, directory);
    try {
      let version;
      if (assigned) {
        if (work(['rev-parse', 'HEAD^']) !== source) throw new Error('Assignment source mismatch');
        version = JSON.parse(readFileSync(resolve(directory,'package.json'))).version;
      } else {
        const versions = git(['tag', '--list', 'v*']).split('\n').map(x=>x.slice(1));
        for (const tag of git(['tag','--list','release-source/*']).split('\n').filter(Boolean)) {
          versions.push(JSON.parse(git(['show',`${tag}:package.json`])).version);
        }
        version = nextVersion(versions, releaseInstruction(git(['show','-s','--format=%B',source])));
        run('npm', ['version',version,'--no-git-tag-version','--ignore-scripts'], directory);
        work(['add','package.json','package-lock.json']);
        work(['-c','core.hooksPath=/dev/null','commit','-m',`Release ${version}\n\nSource-Commit: ${source}`]);
        assigned = work(['rev-parse','HEAD']);
        git(['tag',assignment,assigned]);
        git(['push','origin',`refs/tags/${assignment}`]);
      }
      const tag = `v${version}`;
      let existingTag;
      try { existingTag = git(['rev-parse','--verify',`refs/tags/${tag}^{commit}`]); } catch {}
      if (existingTag && existingTag !== assigned) throw new Error('Version tag source mismatch');
      // A completed release is an immutable checkpoint, including on workflow retries.
      if (existingTag) {
        try { run('gh',['release','view',tag,'--json','id'],root); continue; } catch {}
      }
      console.log(`Releasing ${source} as ${version}`);
      run('npm',['ci','--ignore-scripts'],directory);
      console.log(run('npm',['run','release:prepare'],directory));
      const archive = JSON.parse(readFileSync(resolve(directory,'.tmp/releases/archive.json')));
      const smoke = resolve(directory,'.tmp/packed');
      run('npm',['install','--prefix',smoke,'--ignore-scripts',resolve(directory,'.tmp/releases',archive.filename)],directory);
      console.log(run(process.execPath,['--test','test/adapter-cache.test.js'],directory,{ PW_TEST_PACKAGE: resolve(smoke,'node_modules/mcp-playwright-proxy') }));
      console.log(run(process.execPath,['scripts/publish.mjs'],directory,{GITHUB_REF_NAME:tag}));
      if (!existingTag) { git(['tag',tag,assigned]); git(['push','origin',`refs/tags/${tag}`]); }
      run('gh',['release','create',tag,'--verify-tag','--title',tag,'--notes',`Source commit: ${source}\n\nhttps://github.com/kucharskill/mcp-playwright-proxy/commit/${source}`],root);
    } finally { git(['worktree','remove','--force',directory]); }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
