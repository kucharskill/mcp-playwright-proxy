# Playwright MCP Proxy

One MCP endpoint for independently configured Playwright browser executors. Each browser tool takes an `instanceId`; the proxy routes it to the official Playwright MCP without that extra argument.

## Requirements and startup

Node.js 22+, npm/npx, registry connectivity when resolving current packages, and a supported browser. Edge is the default launch channel; no browser binaries are bundled. Install the Playwright Extension in a Chromium browser for extension mode.

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "--prefer-online", "mcp-playwright-proxy@latest"]
    }
  }
}
```

The stdio adapter stays connected. It resolves the current worker through npx on demand. The worker resolves `@playwright/mcp@latest` when creating each executor. Package resolution finishes before the executor starts. Existing executors keep their version and browser state until closed. Updating the adapter itself still requires reconnecting the MCP client. An open executor intentionally delays worker updates.

## Instances

```js
browser_instance_start({ mode: "launch", browser: "msedge", headless: false, isolated: true })
// Read instanceId from the result, then reuse it:
browser_navigate({ instanceId: "returned-id", url: "https://example.com" })
browser_tabs({ instanceId: "returned-id", action: "list" })
browser_instance_list({})
browser_instance_stop({ instanceId: "returned-id" })
```

Start options:

| Option | Meaning |
| --- | --- |
| `mode` | `launch` (default) or `extension` |
| `browser` | `msedge`, `chrome`, `firefox`, `webkit`; launch defaults to Edge, extension follows upstream defaults |
| `headless`, `isolated` | Launch-only settings; upstream defaults apply when omitted |
| `executablePath` | Custom browser executable, including portable Chromium browsers |
| `userDataDir` | Browser data directory; incompatible with `isolated: true` |
| `profileDirName` | Extension-only profile directory name |
| `allowUnrestrictedFileAccess` | Explicit upstream file-access relaxation; default false |
| `idleTimeoutMs` | Inactivity after completed work; default 1800000 (30 minutes), 0 disables |

For extension mode, omit `headless` and `isolated`. Supply credentials such as `PLAYWRIGHT_MCP_EXTENSION_TOKEN` through the MCP process environment, never tool arguments. The proxy contains no machine-specific browser paths or tokens.

Tabs retain upstream numeric indexes and contexts retain upstream names. Operations in one executor run serially; different executors run concurrently. A sequence of selecting a tab and then clicking is not an atomic transaction: clients sharing an executor must coordinate such sequences.

The proxy forwards upstream tool schemas and results, adding required `instanceId`. The deliberate exception is `browser_close`: it stops the executor, so extension mode never forwards a browser-wide close command. Devtools, vision and PDF capabilities are enabled. Page-provided experimental WebMCP tools are disabled to keep discovery consistent across instances. Unsafe server-side JavaScript is upstream functionality, not a sandbox. Workspace restrictions are guardrails, not a security boundary.

## Lifecycle and updates

- Discovery is cached for ten minutes in a shared JSON file under the user's temporary directory (`mcp-playwright-proxy/discovery/`). A fresh file serves every adapter replica without starting a worker, CLI or npx. Cache hits and legacy MCP pings neither renew the file expiry nor retain the worker. Initialization and legacy ping remain local SDK operations; protocol negotiation uses the SDK's supported versions and advertises only the tools facade.
- Cache filenames use SHA-256 of the requested worker command, ordered arguments, absolute working directory and full environment sorted by variable name. Only `CODEX_TOOL_CALL_ID` is excluded by default; Windows variable names are case-insensitive. Exclusions affect hashing only: the unchanged environment still reaches the worker. No time bucket, host/gate identifier or session ID is included. The file holds tool descriptions, schemas, annotations and backend identity/protocol/capability metadata, never environment values or tool results. Atomic replacement and a short per-key write lock protect concurrent writers. Expired, old or malformed records are misses; list-change notifications and observed identity changes invalidate the shared record.
- Backend discovery retains an otherwise idle worker for one minute; real tool calls retain it for thirty minutes after completion. A shorter operation cannot shorten an existing deadline. A future request starts a current worker after expiry.
- Each executor has one queue and one inactivity timer. Running and queued operations prevent idle shutdown.
- Closed IDs never silently recreate browser state. Start a new instance after expiry.
- Use `browser_instance_stop({instanceId, force: true})` to interrupt stuck work instead of waiting for the queue to drain.
- Client response timeout does not prove execution ended. The proxy does not replay operations.
- Disconnecting the client closes owned executors. Windows launch executors use parent-owned, kill-on-close Job Objects and a startup gate. Extension executors are deliberately outside those Jobs to preserve the user's browser; the owned Node executor is stopped directly.
- Graceful shutdown is bounded by the stdio transport's termination sequence. Browser work can be interrupted on client disconnect or process failure. Idle and explicit stop normally drain queued work.
- Tool-list change notifications invalidate discovery. Cache is refreshed from the real upstream; no hardcoded browser tool catalog is shipped. Client support for live tool-list changes varies.

## Development

Each MCP adapter startup appends one local JSONL record `{pid, startedAt, env}` to `env-startup.jsonl` beside the shared discovery cache. This is the original wrapper environment, including values and potentially credentials, for comparing replica startup environments. Discovery, pings, tool calls and worker restarts do not append records. The write is best-effort; a diagnostic failure does not prevent MCP startup. New directories/files use modes 0700/0600 where supported (Windows inherits user TEMP ACLs). The dump is local only: do not commit, publish or share its contents. There are no fingerprint files, event logs or rotation mechanisms.

```sh
npm ci
node src/cli.js
npm run check
npm run release:prepare
```

Direct source execution uses the local worker. npx execution from the npm cache uses the current published worker. Set `PW_PROXY_RUNNER=local` or `latest` explicitly to override. No source edit affects an already running worker; reconnect or let it expire first.

Environment: `PW_PROXY_DIAGNOSTICS=1` enables stderr lifecycle logs without tool arguments or credentials. `PW_PROXY_STARTUP_MS` and `PW_PROXY_REQUEST_MS` default to 180000; the latter applies to discovery, not the lifetime of running browser work. `PW_PROXY_DISCOVERY_CACHE_MS` defaults to 600000; 0 disables cache writes and hits. `PW_PROXY_DISCOVERY_CACHE_DIR` overrides the shared discovery directory. `PW_PROXY_CACHE_IGNORE_ENV` adds comma-separated environment names to the hash exclusions. `PW_PROXY_WORKER_IDLE_MS` defaults to 60000; 0 disables worker expiry. `PW_PROXY_WORKER_TOOL_IDLE_MS` defaults to 1800000. Browser output defaults to `.tmp/playwright/` under the working directory. Explicit upstream file names follow upstream workspace rules.

MIT licensed. Uses the official [Playwright MCP](https://github.com/microsoft/playwright-mcp).
