#!/usr/bin/env node
/* Задание 0016: безопасность развёртывания из панели.
 * 1) deploy не трогает глобальный ключ: ключ проекта — в корне проекта;
 * 2) повторное развёртывание другого проекта не уничтожает ключ первого;
 * 3) init не оставляет VERSION при падении (нет ложного already-deployed);
 * 4) POST /api/guard и /api/deploy: только application/json и только свой Origin;
 * 5) версии читаются из VERSION, package.json спеки, plugin/package.json и
 *    compat.PLUGIN_VERSION; SPEC обязан содержать абзац «Версия <VERSION>:».
 *    Конкретные номера не утверждаются: их сверяет tools/check-version.mjs. */
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

function git(cwd, args) { const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }); return r.status; }
function repoNew() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-safe-'));
  git(dir, ['init', '-q']); git(dir, ['config', 'user.email', 'p@l']); git(dir, ['config', 'user.name', 'p']);
  return dir;
}
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-home-'));
process.env.HOME = home; process.env.USERPROFILE = home;
const globalKey = path.join(home, '.wf-keys', 'agent-judge.key.pem');

let deployMod = null;
try { deployMod = await import(pathToFileURL(path.join(PKG, 'plugin', 'lib', 'deploy.js')).href); }
catch { fail('deploy: модуль plugin/lib/deploy.js'); }
if (!deployMod) { console.log(''); console.log('DEPLOY SAFETY FAIL: ' + failed); process.exit(1); }
const specRoot = path.join(PKG, 'spec');

/* 1–2. Ключи проектов. */
const a = repoNew();
const ra = deployMod.deployWorkflow(a, { specRoot });
if (!ra.ok) fail('deploy A: успех', JSON.stringify(ra).slice(0, 180));
else if (fs.existsSync(globalKey)) fail('deploy A: глобальный ключ не тронут', globalKey + ' создан');
else pass('deploy A: глобальный ключ не тронут');
const keyA = path.join(a, '.wf-keys', 'agent-judge.key.pem');
const keyA2 = path.join(a, 'docs', 'subagent-workflow', 'keys', 'agent-judge.key.pem');
const aKey = fs.existsSync(keyA) ? keyA : (fs.existsSync(keyA2) ? keyA2 : null);
if (aKey) pass('deploy A: ключ проекта в корне проекта');
else fail('deploy A: ключ проекта в корне проекта', 'нет ни ' + keyA + ', ни ' + keyA2);
const b = repoNew();
const rb = deployMod.deployWorkflow(b, { specRoot });
if (!rb.ok) fail('deploy B: успех', JSON.stringify(rb).slice(0, 180));
if (aKey && fs.existsSync(aKey) && fs.existsSync(globalKey) === false) pass('deploy B: ключ A сохранился');
else if (aKey && !fs.existsSync(aKey)) fail('deploy B: ключ A сохранился', 'ключ A исчез');

/* 3. Порядок: сломанный конфиг не оставляет VERSION. */
const c = repoNew();
fs.mkdirSync(path.join(c, 'docs', 'subagent-workflow'), { recursive: true });
fs.writeFileSync(path.join(c, 'docs', 'subagent-workflow', 'workflow.config.json'), '{ не json', 'utf8');
const rc = deployMod.deployWorkflow(c, { specRoot });
const cVer = path.join(c, 'docs', 'subagent-workflow', 'VERSION');
if (rc.ok === false && !fs.existsSync(cVer)) pass('init: сломанный конфиг не оставляет VERSION');
else fail('init: сломанный конфиг не оставляет VERSION', 'ok=' + rc.ok + ' VERSION=' + fs.existsSync(cVer));

/* 4. API: content-type и Origin. */
try {
  const { createWorkflowRuntime, createWebHandler } = await import(pathToFileURL(path.join(PKG, 'plugin', 'lib', 'api.js')).href);
  const apiRepo = repoNew();
  const handler = createWebHandler(createWorkflowRuntime({ roots: [apiRepo] }));
  const call = async (urlPath, { method = 'POST', type = 'application/json', origin, body } = {}) => {
    const res = { statusCode: 200, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b === undefined ? '' : String(b); } };
    const listeners = { data: [], end: [], error: [] };
    const req = { method, url: urlPath, socket: { remoteAddress: '127.0.0.1' },
      headers: { 'content-type': type, ...(origin ? { origin } : {}) },
      on(ev, fn) { (listeners[ev] || listeners.data).push(fn); return req; } };
    queueMicrotask(() => { for (const fn of listeners.data) fn(Buffer.from(JSON.stringify(body), 'utf8')); for (const fn of listeners.end) fn(); });
    await handler(req, res);
    return res.statusCode;
  };
  const bodies = { '/workflow/api/guard': { enabled: false }, '/workflow/api/deploy': { confirm: false } };
  for (const urlPath of ['/workflow/api/guard', '/workflow/api/deploy']) {
    const plain = await call(urlPath, { type: 'text/plain', body: bodies[urlPath] });
    if (plain === 415) pass('api ' + urlPath + ': text/plain отклонён');
    else fail('api ' + urlPath + ': text/plain отклонён', 'status=' + plain);
    const evil = await call(urlPath, { origin: 'http://evil.example', body: bodies[urlPath] });
    if (evil === 403) pass('api ' + urlPath + ': чужой Origin отклонён');
    else fail('api ' + urlPath + ': чужой Origin отклонён', 'status=' + evil);
  }
} catch (error) { fail('api: маршруты guard/deploy', String(error.message).slice(0, 160)); }

/* 5. Версии и документы. Номера не утверждаются: их знает только check-version. */
try {
  const version = fs.readFileSync(path.join(PKG, 'VERSION'), 'utf8').trim();
  if (version !== '') pass('VERSION: версия читается');
  else fail('VERSION: версия читается', 'файл пуст');
  const specPkg = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8')).version;
  if (version !== '' && version === specPkg) pass('VERSION совпадает с package.json спеки');
  else fail('VERSION совпадает с package.json спеки', 'VERSION=' + version + ', package.json=' + specPkg);
  const plugin = JSON.parse(fs.readFileSync(path.join(PKG, 'plugin', 'package.json'), 'utf8')).version;
  const { PLUGIN_VERSION } = await import(pathToFileURL(path.join(PKG, 'plugin', 'lib', 'compat.js')).href);
  if (plugin === PLUGIN_VERSION) pass('плагин: package.json совпадает с compat.PLUGIN_VERSION');
  else fail('плагин: package.json совпадает с compat.PLUGIN_VERSION', 'package.json=' + plugin + ', compat=' + PLUGIN_VERSION);
  const specMd = fs.readFileSync(path.join(PKG, 'spec', 'SPEC.md'), 'utf8');
  if (version !== '' && specMd.includes('Версия ' + version + ':')) pass('SPEC: абзац «Версия ' + version + ':»');
  else fail('SPEC: абзац «Версия ' + version + ':»');
} catch (error) { fail('версии и документы', String(error.message).slice(0, 160)); }

try { fs.rmSync(a, { recursive: true, force: true }); fs.rmSync(b, { recursive: true, force: true }); fs.rmSync(c, { recursive: true, force: true }); } catch {}
if (failed > 0) { console.log(''); console.log('DEPLOY SAFETY FAIL: ' + failed); process.exit(1); }
console.log(''); console.log('DEPLOY SAFETY OK');