#!/usr/bin/env node
/* Задание 0021: обновление движка из панели (спека 2.6.5, панель 0.8.0).
 * 1) updateWorkflow обновляет развёрнутую копию до версии вложенной спеки;
 * 2) ключи проекта не меняются (acceptors.json и .wf-keys байт в байт);
 * 3) незавершённые задания блокируют обновление, allowInProgress — разрешает;
 * 4) повторное обновление — up-to-date; журнал развёртывания пишется;
 * 5) POST /api/update: confirm обязателен, 415/403 как у остальных POST;
 * 6) плагин 0.8.0, LICENSE в files. */
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

function run(cmd, args, cwd) { const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' }); return r.status; }
function git(cwd, args) { return run('git', ['-C', cwd, ...args], cwd); }
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name), t = path.join(to, e.name);
    if (e.isDirectory()) copyTree(s, t); else if (e.isFile()) fs.copyFileSync(s, t);
  }
}
function newRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-upd-'));
  git(dir, ['init', '-q']); git(dir, ['config', 'user.email', 'p@l']); git(dir, ['config', 'user.name', 'p']);
  return dir;
}
function sha(file) { return fs.existsSync(file) ? fs.readFileSync(file).length + ':' + fs.readFileSync(file).toString('base64').slice(0, 64) : 'none'; }

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-upd-home-'));
process.env.HOME = home; process.env.USERPROFILE = home;
const globalKey = path.join(home, '.wf-keys', 'agent-judge.key.pem');

let mod = null;
try { mod = await import(pathToFileURL(path.join(PKG, 'plugin', 'lib', 'deploy.js')).href); }
catch { fail('deploy: модуль plugin/lib/deploy.js'); }
if (!mod) { console.log(''); console.log('UPDATE FLOW FAIL: ' + failed); process.exit(1); }

const specVersion = fs.readFileSync(path.join(PKG, 'VERSION'), 'utf8').trim();
const specRoot = path.join(PKG, 'spec');

if (typeof mod.updateWorkflow !== 'function') fail('deploy: экспорт updateWorkflow');
else pass('deploy: экспорт updateWorkflow');
if (typeof mod.tasksInProgress !== 'function') fail('deploy: экспорт tasksInProgress');
else pass('deploy: экспорт tasksInProgress');
const upd = typeof mod.updateWorkflow === 'function' ? mod.updateWorkflow : () => ({ ok: false, code: 'missing' });

/* Старая развёрнутая копия: спека-копия с VERSION 2.6.0. */
const old = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-oldspec-'));
copyTree(path.join(PKG, 'spec'), path.join(old, 'spec'));
fs.writeFileSync(path.join(old, 'VERSION'), '2.6.0\n');
const repoA = newRepo();
const first = mod.deployWorkflow ? mod.deployWorkflow(repoA, { specRoot: path.join(old, 'spec') }) : { ok: false };
if (first.ok && first.version === '2.6.0') pass('deploy старой версии 2.6.0');
else fail('deploy старой версии 2.6.0', JSON.stringify(first).slice(0, 160));
const acceptors = path.join(repoA, 'docs', 'subagent-workflow', 'acceptors.json');
const keyFile = path.join(repoA, '.wf-keys', 'agent-judge.key.pem');
const aAcceptors = sha(acceptors), aKey = sha(keyFile);

/* Незавершённое задание блокирует обновление. */
const taskDir = path.join(repoA, 'docs', 'tasks', '0001');
fs.mkdirSync(taskDir, { recursive: true });
fs.writeFileSync(path.join(taskDir, 'task.md'), '# T\n');
fs.writeFileSync(path.join(taskDir, 'criteria.lock'), '{}\n');
const guarded = upd(repoA, { specRoot });
if (guarded.ok === false && guarded.code === 'tasks-in-progress' && Array.isArray(guarded.tasks) && guarded.tasks.includes('0001')) pass('update: незавершённое задание блокирует');
else fail('update: незавершённое задание блокирует', JSON.stringify(guarded).slice(0, 200));
const forced = upd(repoA, { specRoot, allowInProgress: true });
if (forced.ok && forced.version === specVersion) pass('update: allowInProgress обновляет до ' + specVersion);
else fail('update: allowInProgress обновляет до ' + specVersion, JSON.stringify(forced).slice(0, 200));
if (sha(acceptors) === aAcceptors && sha(keyFile) === aKey) pass('update: ключи проекта не изменились');
else fail('update: ключи проекта не изменились');
if (!fs.existsSync(globalKey)) pass('update: глобальный ключ не создан'); else fail('update: глобальный ключ не создан');
const again = upd(repoA, { specRoot });
if (again.ok === false && again.code === 'up-to-date') pass('update: повтор — up-to-date');
else fail('update: повтор — up-to-date', JSON.stringify(again).slice(0, 160));
const journal = path.join(repoA, 'docs', 'subagent-workflow', 'deploy.log');
if (fs.existsSync(journal) && /2\.6\.0/.test(fs.readFileSync(journal, 'utf8')) && new RegExp(specVersion.replace(/\./g, '\\.')).test(fs.readFileSync(journal, 'utf8'))) pass('update: журнал развёртывания');
else fail('update: журнал развёртывания');

/* POST /api/update. */
try {
  const { createWorkflowRuntime, createWebHandler } = await import(pathToFileURL(path.join(PKG, 'plugin', 'lib', 'api.js')).href);
  const handler = createWebHandler(createWorkflowRuntime({ roots: [repoA] }));
  const call = async (opts = {}) => {
    const res = { statusCode: 200, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b === undefined ? '' : String(b); } };
    const listeners = { data: [], end: [], error: [] };
    const req = { method: opts.method || 'POST', url: '/workflow/api/update', socket: { remoteAddress: '127.0.0.1' },
      headers: { 'content-type': opts.type || 'application/json', ...(opts.origin ? { origin: opts.origin } : {}) },
      on(ev, fn) { (listeners[ev] || listeners.data).push(fn); return req; } };
    queueMicrotask(() => { for (const fn of listeners.data) fn(Buffer.from(JSON.stringify(opts.body || {}), 'utf8')); for (const fn of listeners.end) fn(); });
    await handler(req, res);
    return res.statusCode;
  };
  const noConfirm = await call({ body: { root: repoA } });
  if (noConfirm === 400) pass('api update: без confirm — 400'); else fail('api update: без confirm — 400', 'status=' + noConfirm);
  const plain = await call({ type: 'text/plain', body: { root: repoA, confirm: true } });
  if (plain === 415) pass('api update: text/plain — 415'); else fail('api update: text/plain — 415', 'status=' + plain);
  const evil = await call({ origin: 'http://evil.example', body: { root: repoA, confirm: true } });
  if (evil === 403) pass('api update: чужой Origin — 403'); else fail('api update: чужой Origin — 403', 'status=' + evil);
} catch (error) { fail('api update: маршрут', String(error.message).slice(0, 160)); }

/* Манифест и LICENSE. */
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(PKG, 'plugin', 'package.json'), 'utf8'));
  const compatMod = await import(pathToFileURL(path.join(PKG, 'plugin', 'lib', 'compat.js')).href);
  if (/^\d+\.\d+\.\d+$/.test(pkg.version) && pkg.version === compatMod.PLUGIN_VERSION) pass('плагин: версия совпадает с compat.PLUGIN_VERSION');
  else fail('плагин: версия совпадает с compat.PLUGIN_VERSION', pkg.version + ' vs ' + compatMod.PLUGIN_VERSION);
  if (Array.isArray(pkg.files) && pkg.files.includes('LICENSE')) pass('LICENSE в files'); else fail('LICENSE в files');
  if (fs.existsSync(path.join(PKG, 'plugin', 'LICENSE'))) pass('LICENSE существует'); else fail('LICENSE существует');
} catch (error) { fail('манифест плагина', String(error.message).slice(0, 120)); }

try { fs.rmSync(repoA, { recursive: true, force: true }); fs.rmSync(old, { recursive: true, force: true }); } catch {}
if (failed > 0) { console.log(''); console.log('UPDATE FLOW FAIL: ' + failed); process.exit(1); }
console.log(''); console.log('UPDATE FLOW OK');