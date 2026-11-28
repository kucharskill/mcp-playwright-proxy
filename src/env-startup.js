import { appendFile, chmod, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Local, explicitly requested startup evidence. Never print or propagate the dump. */
export async function dumpStartupEnvironment({ env = process.env, pid = process.pid,
  startedAt = new Date().toISOString(), directory = env.PW_PROXY_DISCOVERY_CACHE_DIR ?? join(tmpdir(), 'playwright', 'discovery') } = {}) {
  try {
    const line = JSON.stringify({ pid, startedAt, env }) + '\n';
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, 'env-startup.jsonl');
    await appendFile(path, line, { mode: 0o600 });
    if (process.platform !== 'win32') await chmod(path, 0o600);
  } catch { /* Diagnostic failure must not prevent MCP startup. */ }
}
