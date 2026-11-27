import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { createJob } from '../src/job.js';
test('Windows Job closes the owned process and its descendant', { skip: process.platform !== 'win32' }, async () => {
  const job = await createJob();
  const child = spawn(process.execPath, ['-e', `process.stdin.once('data',()=>{const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});console.log(c.pid);setInterval(()=>{},1000)})`], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
  let pid;
  try {
    await once(child, 'spawn'); job.assign(child.pid);
    const output = once(child.stdout, 'data'); child.stdin.write('go\n');
    pid = Number(String((await output)[0]).trim());
    assert.ok(pid > 0);
    const exit = once(child, 'exit'); job.close(); await exit;
    for (let i = 0; i < 20; i++) {
      try { process.kill(pid, 0); } catch { return; }
      await sleep(50);
    }
    assert.fail('Owned descendant survived Job close');
  } finally { job.close(); child.kill(); if (pid) { try { process.kill(pid); } catch {} } }
});
