import { Instances } from './instances.js';
import { serve, textResult } from './server.js';
import { milliseconds, log } from './meta.js';
import { pathToFileURL } from 'node:url';
export async function startWorker({ createInstances = options => new Instances(options) } = {}) {
  let handle;
  let manifest;
  let loading;
  let timer;
  let active = 0;
  let closing = false;
  const retention = milliseconds('PW_PROXY_WORKER_IDLE_MS', 60000);
  const toolRetention = milliseconds('PW_PROXY_WORKER_TOOL_IDLE_MS', 1800000);
  let expiresAt = Date.now() + retention;
  const arm = () => {
    clearTimeout(timer);
    if (!closing && !active && !instances.hasLive() && retention) timer = setTimeout(() => {
      log({ event: 'worker-idle-expired' });
      void handle.shutdown();
    }, Math.max(0, expiresAt - Date.now()));
  };
  const changed = () => {
    manifest = undefined;
    void handle?.server.sendToolListChanged().catch(() => {});
  };
  const roots = async () => {
    if (!handle.server.getClientCapabilities()?.roots) return { roots: [{ uri: pathToFileURL(process.cwd()).href, name: 'workspace' }] };
    return handle.server.listRoots();
  };
  const instances = createInstances({ roots, changed, stateChanged: arm });
  const during = async (operation, keepMs = retention) => {
    active++; clearTimeout(timer);
    try { return await operation(); }
    finally { active--; expiresAt = Math.max(expiresAt, Date.now() + keepMs); arm(); }
  };
  handle = await serve({
    list: () => during(async () => {
      if (manifest) return manifest;
      loading ??= instances.manifest().then(value => manifest = value).finally(() => loading = undefined);
      return loading;
    }),
    call: params => during(async () => {
      const args = params.arguments ?? {};
      switch (params.name) {
        case 'browser_instance_start': return textResult(await instances.start(args));
        case 'browser_instance_list': return textResult(instances.list());
        case 'browser_instance_stop': return textResult(await instances.stop(args.instanceId, args.force ? 'forced-stop' : 'explicit-stop', args.force === true));
        default: return instances.call(params.name, args);
      }
    }, toolRetention),
    close: async () => { closing = true; clearTimeout(timer); await instances.close(); },
    rootsChanged: () => {
      for (const item of instances.items.values()) void item.connection?.client.sendRootsListChanged().catch(() => {});
    },
  });
  arm();
}
