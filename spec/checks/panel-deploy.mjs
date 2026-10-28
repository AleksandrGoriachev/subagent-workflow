#!/usr/bin/env node
/*
 * Приёмочные проверки задания 0014 (панель 0.7.0):
 * 1) модуль развёртывания есть и работает: успех в чистом git-репозитории, повтор — already-deployed,
 *    не-git — not-a-repo;
 * 2) POST /workflow/api/deploy требует confirm и разворачивает движок в корень workspace;
 * 3) кнопка в клиенте и сборка tarball: спека вкладывается (vendor), версия плагина 0.7.0.
 */
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

function git(cwd, args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}
function tempRepo(withGit) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-deploy-'));
  if (withGit) {
    git(dir, ['init', '-q']);
    git(dir, ['config', 'user.email', 'p@l']);
    git(dir, ['config', 'user.name', 'p']);
  }
  return dir;
}

const deployMod = await import(pathToFileURLSafe(path.join(PKG, 'plugin', 'lib', 'deploy.js')));
function pathToFileURLSafe(p) { return 'file:///' + p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1:'); }

const specVersion = fs.readFileSync(path.join(PKG, 'VERSION'), 'utf8').trim();
const specRoot = path.join(PKG, 'spec');

/* 1. Развёртывание в чистый репозиторий. */
if (!deployMod) { console.log(''); console.log('PANEL DEPLOY FAIL: ' + failed); process.exit(1); }
const repoOk = tempRepo(true);
try {
  const first = deployMod.deployWorkflow(repoOk, { specRoot });
  const versionFile = path.join(repoOk, 'docs', 'subagent-workflow', 'VERSION');
  if (!first.ok) fail('deploy: успех в чистом репозитории', JSON.stringify(first).slice(0, 200));
  else if (!fs.existsSync(versionFile)) fail('deploy: появился VERSION движка');
  else {
    const deployed = fs.readFileSync(versionFile, 'utf8').trim();
    if (deployed === specVersion) pass('deploy: успех, версия ' + deployed);
    else fail('deploy: версия движка', 'ожидалась ' + specVersion + ', получена ' + deployed);
  }
  const hooksPath = git(repoOk, ['config', '--get', 'core.hooksPath']).out.trim();
  if (hooksPath === 'docs/subagent-workflow/hooks') pass('deploy: выставлен core.hooksPath');
  else fail('deploy: выставлен core.hooksPath', 'получено: ' + (hooksPath || '(пусто)'));
  if (fs.existsSync(path.join(repoOk, 'docs', 'tasks'))) pass('deploy: создан docs/tasks');
  else fail('deploy: создан docs/tasks');
  const second = deployMod.deployWorkflow(repoOk, { specRoot });
  if (second.ok === false && second.code === 'already-deployed') pass('deploy: повтор даёт already-deployed');
  else fail('deploy: повтор даёт already-deployed', JSON.stringify(second).slice(0, 200));
} finally { try { fs.rmSync(repoOk, { recursive: true, force: true }); } catch {} }

/* 2. Не git-репозиторий. */
const plain = tempRepo(false);
try {
  const res = deployMod.deployWorkflow(plain, { specRoot });
  if (res.ok === false && res.code === 'not-a-repo') pass('deploy: не-git даёт not-a-repo');
  else fail('deploy: не-git даёт not-a-repo', JSON.stringify(res).slice(0, 200));
} finally { try { fs.rmSync(plain, { recursive: true, force: true }); } catch {} }

/* 3. API: подтверждение и развёртывание в корень workspace. */
try {
  const { createWorkflowRuntime, createWebHandler } = await import(pathToFileURL(path.join(PKG, 'plugin', 'lib', 'api.js')).href);
  const repo = tempRepo(true);
  const runtime = createWorkflowRuntime({ roots: [repo] });
  const handler = createWebHandler(runtime);
  const call = async (body) => {
    const res = { statusCode: 200, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b === undefined ? '' : String(b); } };
    const listeners = { data: [], end: [], error: [] };
    const req = { method: 'POST', url: '/workflow/api/deploy', socket: { remoteAddress: '127.0.0.1' }, on(ev, fn) { (listeners[ev] || listeners.data).push(fn); return req; } };
    queueMicrotask(() => { for (const fn of listeners.data) fn(Buffer.from(JSON.stringify(body), 'utf8')); for (const fn of listeners.end) fn(); });
    await handler(req, res);
    return { status: res.statusCode, json: (() => { try { return JSON.parse(res.body); } catch { return null; } })() };
  };
  const noConfirm = await call({ root: repo });
  if (noConfirm.status === 400) pass('api: без confirm — 400');
  else fail('api: без confirm — 400', 'status=' + noConfirm.status + ' ' + JSON.stringify(noConfirm.json).slice(0, 160));
  const ok = await call({ root: repo, confirm: true });
  if (ok.status === 200 && ok.json && ok.json.ok === true) pass('api: confirm разворачивает движок');
  else fail('api: confirm разворачивает движок', 'status=' + ok.status + ' ' + JSON.stringify(ok.json).slice(0, 200));
  fs.rmSync(repo, { recursive: true, force: true });
} catch (error) { fail('api: маршрут /api/deploy', String(error.message).slice(0, 200)); }

/* 4. Клиент и сборка. */
try {
  const client = fs.readFileSync(path.join(PKG, 'plugin', 'lib', 'client.js'), 'utf8');
  if (/Развернуть workflow здесь/.test(client) && /api\/deploy/.test(client)) pass('клиент: кнопка и вызов /api/deploy');
  else fail('клиент: кнопка и вызов /api/deploy');
  const pkg = JSON.parse(fs.readFileSync(path.join(PKG, 'plugin', 'package.json'), 'utf8'));
  if (pkg.version === '0.7.0') pass('плагин: версия 0.7.0');
  else fail('плагин: версия 0.7.0', 'сейчас ' + pkg.version);
  if (Array.isArray(pkg.files) && pkg.files.includes('vendor')) pass('сборка: vendor в files');
  else fail('сборка: vendor в files');
  const pack = fs.readFileSync(path.join(PKG, 'tools', 'pack-plugin.mjs'), 'utf8');
  if (/vendor/.test(pack)) pass('сборка: pack-plugin готовит vendor');
  else fail('сборка: pack-plugin готовит vendor');
} catch (error) { fail('клиент и сборка', String(error.message).slice(0, 200)); }

if (failed > 0) { console.log(''); console.log('PANEL DEPLOY FAIL: ' + failed); process.exit(1); }
console.log(''); console.log('PANEL DEPLOY OK');
