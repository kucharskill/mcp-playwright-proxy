// Only fixed Node entry points reach this host. Arguments never pass through a shell.
import spawn from 'cross-spawn';
const launch = JSON.parse(process.env.PW_PROXY_HOST);
if (launch.originalHostEnv === undefined) delete process.env.PW_PROXY_HOST;
else process.env.PW_PROXY_HOST = launch.originalHostEnv;
let buffer = Buffer.alloc(0);
let child;
let ending = false;
let timer;
function end() {
  ending = true;
  if (!child) return process.exit(0);
  child.stdin.end();
  timer ??= setTimeout(() => {
    if (launch.protect && process.platform !== 'win32') { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
    else child.kill('SIGKILL');
  }, 3000);
}
process.stdin.on('data', chunk => {
  if (child) { if (!ending) child.stdin.write(chunk); return; }
  buffer = Buffer.concat([buffer, chunk]);
  const newline = buffer.indexOf(10);
  if (newline < 0) return;
  const gate = JSON.parse(buffer.subarray(0, newline).toString());
  if (gate.method !== 'proxy/gate') throw new Error('Missing process gate');
  child = spawn(launch.command ?? process.execPath, launch.args, {
    cwd: launch.cwd, env: process.env, stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true,
    detached: Boolean(launch.protect && process.platform !== 'win32'),
  });
  child.stdin.on('error', () => {});
  child.stdout.pipe(process.stdout);
  child.once('error', () => { console.error('Failed to start owned process'); process.exit(1); });
  child.once('exit', code => { clearTimeout(timer); process.exit(code ?? 1); });
  const rest = buffer.subarray(newline + 1);
  buffer = null;
  if (rest.length) child.stdin.write(rest);
});
process.stdin.once('end', end);
process.once('SIGTERM', end);
process.once('SIGINT', end);
