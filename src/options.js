import { z } from 'zod';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export const optionsSchema = z.object({
  mode: z.enum(['launch', 'extension']).default('launch'),
  browser: z.enum(['msedge', 'chrome', 'firefox', 'webkit']).optional(),
  headless: z.boolean().optional(),
  isolated: z.boolean().optional(),
  args: z.array(z.string().min(1)).optional().describe('Additional command-line arguments passed to the browser process. Each array item is a single argument, even if it contains spaces. Available only in launch mode. Example: ["--host-resolver-rules=MAP xxx 127.0.0.1"]. Supported flags depend on the selected browser.'),
  executablePath: z.string().min(1).optional(),
  userDataDir: z.string().min(1).optional(),
  profileDirName: z.string().min(1).optional(),
  allowUnrestrictedFileAccess: z.boolean().default(false),
  idleTimeoutMs: z.number().int().min(0).max(2147483647).default(1800000),
}).strict().superRefine((o, ctx) => {
  if (o.mode === 'extension' && o.args !== undefined) ctx.addIssue({ code: 'custom', message: 'args applies only to launch mode' });
  if (o.mode === 'extension' && (o.headless !== undefined || o.isolated !== undefined)) ctx.addIssue({ code: 'custom', message: 'headless and isolated apply only to launch mode' });
  if (o.mode === 'extension' && o.browser && !['chrome', 'msedge'].includes(o.browser)) ctx.addIssue({ code: 'custom', message: 'Extension requires a Chromium browser' });
  if (o.isolated && o.userDataDir) ctx.addIssue({ code: 'custom', message: 'isolated and userDataDir are mutually exclusive' });
  if (o.mode === 'launch' && o.profileDirName) ctx.addIssue({ code: 'custom', message: 'profileDirName applies only to extension mode' });
});
export function upstreamArgs(input) {
  const o = optionsSchema.parse(input);
  const args = ['--caps', 'devtools,vision,pdf', '--idle-timeout', '0', '--no-webmcp', '--output-dir', join(tmpdir(), 'playwright', 'output')];
  if (o.browser) args.push('--browser', o.browser);
  else if (o.mode === 'launch' && !o.executablePath) args.push('--browser', 'msedge');
  if (o.mode === 'extension') args.push('--extension');
  if (o.headless) args.push('--headless');
  if (o.isolated) args.push('--isolated');
  for (const [key, flag] of [['executablePath', '--executable-path'], ['userDataDir', '--user-data-dir'], ['profileDirName', '--profile-dir-name']]) if (o[key]) args.push(flag, o[key]);
  if (o.allowUnrestrictedFileAccess) args.push('--allow-unrestricted-file-access');
  return args;
}
export const controls = [
  { name: 'browser_instance_start', description: 'Start an independently configured Playwright MCP executor. Returns instanceId. Reuse that ID for browser operations. Extension mode attaches to an existing user browser.', inputSchema: z.toJSONSchema(optionsSchema, { unrepresentable: 'any', io: 'input' }) },
  { name: 'browser_instance_list', description: 'List live and recently closed browser instances without extending their lifetime.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'browser_instance_stop', description: 'Close an instance after queued operations finish. Use force:true to interrupt stuck work. Extension mode disconnects without closing the user browser.', inputSchema: { type: 'object', properties: { instanceId: { type: 'string' }, force: { type: 'boolean', default: false } }, required: ['instanceId'], additionalProperties: false } },
];
export function withInstance(tool) {
  const schema = tool.inputSchema;
  if (schema.type !== 'object' || schema.properties?.instanceId) throw new Error(`Unsupported upstream schema: ${tool.name}`);
  return { ...tool, inputSchema: { ...schema, properties: { ...schema.properties, instanceId: { type: 'string', description: 'ID returned by browser_instance_start.' } }, required: [...new Set([...(schema.required ?? []), 'instanceId'])] } };
}
