# Playwright MCP Proxy

Run several browser instances through one MCP connection. Choose Edge, Chrome, Firefox or WebKit, work with a visible window or headless, or connect to your browser through the Playwright extension.

Each instance has its own settings and an `instanceId`. Use that ID to choose which browser receives an action.

## Why use it?

- Configure one MCP server for all your browser workflows, with the browser and mode selected when you start an instance.
- Start new instances with the latest official Playwright MCP release, while ongoing work keeps its current browser session.
- Keep several instances open with different settings and route actions using their instance IDs.
- Let idle instances close automatically, or keep them open for longer tasks.

## Setup

Requires Node.js 22+, npm and a browser supported by Playwright. Edge is the default. For extension mode, install the [Playwright MCP extension](https://github.com/microsoft/playwright-mcp).

Add this entry to your MCP client:

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

## Start a browser

```js
browser_instance_start({
  mode: "launch",
  browser: "msedge",
  headless: false,
  isolated: true
})
```

Use the returned `instanceId` with browser tools:

```js
browser_navigate({ instanceId: "returned-id", url: "https://example.com" })
browser_tabs({ instanceId: "returned-id", action: "list" })
browser_instance_list({})
browser_instance_stop({ instanceId: "returned-id" })
```

The browser tools come from the official [Playwright MCP](https://github.com/microsoft/playwright-mcp), including navigation, clicks, screenshots, JavaScript evaluation and PDF export.

### Start options

| Option | Purpose |
| --- | --- |
| `mode` | `launch` starts a browser; `extension` connects to your browser |
| `browser` | `msedge`, `chrome`, `firefox` or `webkit` |
| `headless` | Run in the background; launch mode |
| `isolated` | Use a fresh, temporary browser profile; launch mode |
| `args` | Additional browser arguments, one string per argument; launch mode |
| `executablePath` | Path to a custom browser executable |
| `userDataDir` | Use a specific browser data directory; choose this or `isolated` |
| `profileDirName` | Select a browser profile in extension mode |
| `allowUnrestrictedFileAccess` | Allow access to files outside the workspace |
| `idleTimeoutMs` | Close after inactivity; default 30 minutes, `0` keeps the instance open |

For example, pass a hostname mapping as a browser argument:

```js
browser_instance_start({
  mode: "launch",
  browser: "msedge",
  args: ["--host-resolver-rules=MAP example.test 127.0.0.1"]
})
```

Keep an argument containing spaces in a single array item. Available flags depend on the selected browser.

### Connect through the extension

```js
browser_instance_start({ mode: "extension" })
```

Follow the extension's connection prompt. Set `PLAYWRIGHT_MCP_EXTENSION_TOKEN` in your MCP client's environment if using token authentication. Stopping the instance disconnects automation and leaves your browser open.

## Working with instances

Reuse an instance while its settings suit the task. Actions within an instance run in order; separate instances can work concurrently. Coordinate tab selection when sharing an instance across tasks.

Instances close after 30 minutes of inactivity by default. Start a new instance if one has expired. To interrupt a stuck instance, call `browser_instance_stop` with `force: true`.

Generated temporary files and browser output use the system temporary directory: `%TEMP%\playwright` on Windows.

## Updates

New instances use the latest official Playwright MCP. Existing instances keep their browser state and version until closed. Reconnect your MCP client to load an updated proxy.

## Development

```sh
npm ci
node src/cli.js
npm run check
npm run release:prepare
```

Direct source execution uses the local worker. Set `PW_PROXY_RUNNER=local` or `latest` to choose explicitly.

MIT licensed.
