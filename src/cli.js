#!/usr/bin/env node
import { metadata } from './meta.js';
const args = process.argv.slice(2);
try {
  if (args.length === 1 && ['--version', '-v'].includes(args[0])) console.log(metadata.version);
  else if (args.length === 1 && ['--help', '-h'].includes(args[0])) console.log(`Usage: ${metadata.name} [mcp | --worker | --version | --help]\n\nMulti-instance Playwright MCP over stdio. Node.js 22+ and npm/npx are required.\nPW_PROXY_RUNNER=local|latest overrides worker selection.\nPW_PROXY_DIAGNOSTICS=1 enables metadata-only stderr logs.\nPLAYWRIGHT_MCP_EXTENSION_TOKEN is forwarded from the environment.\nSee README.md for instance options and lifecycle limits.`);
  else if (args.length === 1 && args[0] === '--worker') await (await import('./worker.js')).startWorker();
  else if (!args.length || (args.length === 1 && args[0] === 'mcp')) await (await import('./adapter.js')).startAdapter();
  else throw new Error('Unknown arguments. Use --help.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
