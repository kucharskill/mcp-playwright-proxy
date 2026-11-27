import { readFileSync } from 'node:fs';
export const metadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
export const info = { name: metadata.name, version: metadata.version };
export function log(event) {
  if (process.env.PW_PROXY_DIAGNOSTICS === '1') console.error(JSON.stringify(event));
}
export function milliseconds(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a nonnegative integer`);
  return value;
}
