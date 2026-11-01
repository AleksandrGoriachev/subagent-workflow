#!/usr/bin/env node
/* Задание 0032: внешний движок для воркспейса без спеки (2.6.9, панель 0.9.0).
 * Карта воркспейс → движок в ~/.dsh/workflow/engine-roots.json (env WF_ENGINE_ROOTS).
 * Чтение идёт из внешнего движка; запись (guard/deploy/update) в воркспейс без спеки запрещена. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');
let failed = 0;
const pass = (n) => console.log('PASS ' + n);
const fail = (n, d) => { failed += 1; console.log('FAIL ' + n + (d ? ' — ' + d : '')); };
function run(cmd, args, cwd) { const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' }); return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') }; }
function git(cwd, args) { return run('git', ['-C', cwd, ...args], cwd); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-engine-'));
const home = path.join(tmp, 'home'); fs.mkdirSync(home, { recursive: true });
process.env.HOME = home; process.env.USERPROFILE = home;
const ws = path.join(tmp, 'ws'); fs.mkdirSync(ws, { recursive: true });
const engine = path.join(tmp, 'engine'); fs.mkdirSync(engine, { recursive: true });
git(engine, ['init', '-q']); git(engine, ['config', 'user.email', 'p@l']); git(engine, ['config', 'user.name', 'p']);
const init = run(process.execPath, [path.join(PKG, 'spec', 'scripts', 'init.mjs'), '--repo', engine, '--force', '--key-out', path.join(engine, '.wf-keys'), '--key-id', 'agent-judge'], PKG);
if (init.code !== 0) { console.log('SKIP: init внешнего движка не удался'); process.exit(0); }
const rootsFile = path.join(tmp, 'engine-roots.json');
const mapping = {}; mapping[ws] = engine;
fs.writeFileSync(rootsFile, JSON.stringify(mapping));
process.env.WF_ENGINE_ROOTS = rootsFile;

const { createWorkflowRuntime, createWebHandler } = await import(pathToFileURL(path.join(PKG, 'plugin', 'lib', 'api.js')).href);
function makeRes() { return { statusCode: 200, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b === undefined ? '' : String(b); } }; }
function call(handler, opts) {
  const res = makeRes();
  const listeners = { data: [], end: [] };
  const req = { method: opts.method || 'GET', url: opts.url, socket: { remoteAddress: '127.0.0.1' }, headers: { 'content-type': opts.type || 'application/json', ...(opts.origin ? { origin: opts.origin } : {}) },
    on(ev, fn) { (listeners[ev] || listeners.data).push(fn); return req; } };
  return new Promise((resolve) => {
    Promise.resolve(handler(req, res)).then(() => resolve(res), () => resolve(res));
    queueMicrotask(() => { if (opts.body) for (const fn of listeners.data) fn(Buffer.from(JSON.stringify(opts.body))); for (const fn of listeners.end) fn(); });
  });
}
const handler = createWebHandler(createWorkflowRuntime({ roots: [ws] }));
const status = await call(handler, { url: '/workflow/api/status?root=' + encodeURIComponent(ws) });
let json = {}; try { json = JSON.parse(status.body); } catch {}
if (status.statusCode === 200 && json.engine && json.engine.installed === true && json.engine.source === 'mapping') pass('A: статус видит внешний движок');
else fail('A: статус видит внешний движок', 'status=' + status.statusCode + ' ' + status.body.slice(0, 160));
const guard = await call(handler, { method: 'POST', url: '/workflow/api/guard', body: { root: ws, enabled: true, confirm: true } });
if (guard.statusCode === 409) pass('B: запись в воркспейс без спеки запрещена');
else fail('B: запись в воркспейс без спеки запрещена', 'status=' + guard.statusCode);
if (!fs.existsSync(path.join(ws, 'docs'))) pass('C: воркспейс не изменён'); else fail('C: воркспейс не изменён');
if (fs.existsSync(path.join(engine, 'docs', 'subagent-workflow', 'VERSION'))) pass('D: внешний движок на месте'); else fail('D: внешний движок на месте');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
if (failed > 0) { console.log(''); console.log('ENGINE ROOT FAIL: ' + failed); process.exit(1); }
console.log(''); console.log('ENGINE ROOT OK');