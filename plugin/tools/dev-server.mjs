#!/usr/bin/env node
/*
 * Local stand-in for the DSH web host: mounts the same handler on 127.0.0.1 so
 * the GET routes can be checked with curl without installing the plugin.
 *
 *   node tools/dev-server.mjs --root <repository> [--port 17872]
 */
import http from 'node:http';
import path from 'node:path';
import { createWorkflowRuntime, createWebHandler } from '../lib/api.js';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log('Usage: node tools/dev-server.mjs --root <repository> [--port 17872]');
  process.exit(0);
}

const root = path.resolve(String(args.root || process.cwd()));
const port = Number(args.port || 17872);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error('dev-server: --port должен быть 0..65535');
  process.exit(2);
}

const runtime = createWorkflowRuntime({ roots: [root] });
const handler = createWebHandler(runtime);
const server = http.createServer((req, res) => {
  handler(req, res).catch((error) => {
    if (!res.writableEnded) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: String(error && error.message ? error.message : error) }));
    }
  });
});

server.on('error', (error) => {
  console.error('dev-server: ' + error.message);
  process.exit(1);
});

server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  const actual = address && typeof address === 'object' ? address.port : port;
  console.log('workflow console: http://127.0.0.1:' + actual + '/workflow/api/status');
  console.log('root: ' + root);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
