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
test('Windows Job cleans descendants when its owner is forcibly killed', { skip: process.platform !== 'win32' }, async () => {
  const moduleUrl = new URL('../src/job.js', import.meta.url).href;
  const code = `import {createJob} from ${JSON.stringify(moduleUrl)};import {spawn} from 'node:child_process';const job=await createJob();const c=spawn(process.execPath,['-e',"process.stdin.once('data',()=>{const g=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});console.log(g.pid);setInterval(()=>{},1000)})"],{stdio:['pipe','pipe','inherit'],windowsHide:true});c.once('spawn',()=>{job.assign(c.pid);c.stdin.write('go\\n')});c.stdout.once('data',data=>console.log(JSON.stringify([c.pid,Number(String(data).trim())])));setInterval(()=>{},1000);`;
  const owner = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
  let pids = [];
  try {
    const [data] = await once(owner.stdout, 'data'); pids = JSON.parse(String(data));
    const exit = once(owner, 'exit'); owner.kill('SIGKILL'); await exit;
    for (const pid of pids) {
      let alive = true;
      for (let i = 0; i < 40; i++) { try { process.kill(pid, 0); } catch { alive = false; break; } await sleep(50); }
      assert.equal(alive, false, 'Descendant survived owner crash');
    }
  } finally { owner.kill(); for (const pid of pids) { try { process.kill(pid); } catch {} } }
});
