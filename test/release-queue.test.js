import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { nextVersion, releaseInstruction, sourceQueue, run } from '../scripts/release-queue.mjs';

test('release versions include reserved assignments and explicit increments', () => {
  assert.equal(nextVersion(['0.1.7','0.1.8']), '0.1.9');
  assert.equal(nextVersion(['0.9.9','0.10.0']), '0.10.1');
  assert.equal(nextVersion(['0.1.7'], 'minor'), '0.2.0');
  assert.equal(nextVersion(['0.1.7'], 'major'), '1.0.0');
  assert.equal(releaseInstruction('Update documentation'), 'patch');
  assert.equal(releaseInstruction('New feature\n\nRelease-As: minor'), 'minor');
  assert.throws(() => releaseInstruction('Release-As: banana'));
});

test('release queue keeps every source commit including documentation and retries pending sources', () => {
  mkdirSync('.tmp', { recursive: true });
  const directory = mkdtempSync(resolve('.tmp/release-queue-test-'));
  const git = args => run('git',args,directory);
  try {
    git(['init','-b','main']);
    git(['config','user.name','Fixture']); git(['config','user.email','fixture@example.test']);
    git(['config','core.hooksPath',resolve(directory,'no-hooks')]);
    const commit = (file,text) => { writeFileSync(resolve(directory,file),text); git(['add',file]);git(['commit','-m',text]);return git(['rev-parse','HEAD']); };
    const baseline = commit('package.json','{"version":"0.1.7"}');
    const docs = commit('README.md','Documentation only');
    const outside = commit('workflow.yml','Outside package allowlist');
    const latest = commit('code.js','Runtime change');
    assert.deepEqual(sourceQueue(git,baseline,'main'),[docs,outside,latest]);
    git(['tag',`release-source/${docs}`,docs]);
    // An assignment is not completion: the same queue is revisited after failure.
    assert.deepEqual(sourceQueue(git,baseline,'main'),[docs,outside,latest]);
    assert.throws(() => sourceQueue(git,latest,baseline));
  } finally { rmSync(directory,{recursive:true,force:true}); }
});
