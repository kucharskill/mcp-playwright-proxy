import spawn from 'cross-spawn';
import { fileURLToPath } from 'node:url';
import { createJob } from './job.js';
import { milliseconds } from './meta.js';
export async function resolveLatest(name) {
  const job = await createJob();
  return new Promise((resolve, reject) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_config_(package|call)$/i.test(key)));
    const launch = { command: 'npx', protect: true, originalHostEnv: env.PW_PROXY_HOST, args: ['-y', '--prefer-online', `--package=${name}@latest`, '--', 'node', fileURLToPath(new URL('./resolve-entry.js', import.meta.url)), name] };
    const child = spawn(process.execPath, [fileURLToPath(new URL('./host.js', import.meta.url))], { env: { ...env, PW_PROXY_HOST: JSON.stringify(launch) }, windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'] });
    let output = '';
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      job.close();
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error(`Timed out resolving ${name}`)); }, milliseconds('PW_PROXY_STARTUP_MS', 180000));
    child.stdin.on('error', error => finish(error));
    child.once('spawn', () => { try { job.assign(child.pid); child.stdin.write(JSON.stringify({ method: 'proxy/gate' }) + '\n'); } catch (error) { child.kill(); finish(error); } });
    child.once('error', error => finish(error));
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 65536) { child.kill(); finish(new Error('Resolver output too large')); } });
    child.once('close', code => {
      if (code !== 0) return finish(new Error(`npm could not resolve ${name} (exit ${code})`));
      try { const value = JSON.parse(output); if (!value.entry || !value.version) throw new Error('Invalid resolver output'); finish(null, value); }
      catch (error) { finish(error); }
    });
  });
}
