#!/usr/bin/env node
/*
 * 2.6.16 (0042): внешний движок обновляется в СВОЁМ репозитории.
 *
 * Панель показывала «Доступно в этой сборке панели: vX» для воркспейса, который
 * читает движок по карте, а обновить отказывалась (409 engine-external) — обещание,
 * которое она не может выполнить. Теперь явный запрос target: 'engine-repo'
 * обновляет репозиторий движка, не трогая воркспейс; текст панели говорит, где
 * именно обновляется движок.
 *
 * Вне пакета — SKIP (конвенция deployed-copy).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');

if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-external-engine-'));

const ENGINE_ROOTS_ENV = 'WF_ENGINE_ROOTS';
/* Слова панели: обновление внешнего движка происходит в его репозитории. */
const CLIENT_WORDS = ['обновляется в репозитории движка'];
/* Старое обещание, которого панель выполнить не может. */
const CLIENT_FORBIDDEN = ['Доступно в этой сборке панели'];
const CLIENT_TEST = 'карточка external: обновление в репозитории движка';

function eq(actual, expected, label) {
  if (actual !== expected) throw new Error(label + ': ожидалось ' + JSON.stringify(expected) + ', получено ' + JSON.stringify(actual));
}
function truthy(value, label) { if (!value) throw new Error(label); }

function engineRepo(version) {
  const dir = fs.mkdtempSync(path.join(ROOT, 'engine-'));
  const engineDir = path.join(dir, 'docs', 'subagent-workflow');
  fs.mkdirSync(engineDir, { recursive: true });
  fs.writeFileSync(path.join(engineDir, 'VERSION'), version + '\n');
  fs.writeFileSync(path.join(engineDir, 'workflow.config.json'), JSON.stringify({ version: 1, tasksDir: 'docs/tasks', logs: 'local' }));
  fs.mkdirSync(path.join(dir, 'docs', 'tasks'), { recursive: true });
  const git = spawnSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
  truthy(git.status === 0, 'git init репозитория движка');
  return dir;
}

function emptyWorkspace() {
  const dir = fs.mkdtempSync(path.join(ROOT, 'ws-'));
  const git = spawnSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
  truthy(git.status === 0, 'git init воркспейса');
  return dir;
}

function versionOf(repo) {
  return fs.readFileSync(path.join(repo, 'docs', 'subagent-workflow', 'VERSION'), 'utf8').trim();
}

function makeResponse() {
  return {
    statusCode: 200, headers: {}, writableEnded: false, body: '',
    setHeader(key, value) { this.headers[String(key).toLowerCase()] = value; },
    end(body) { this.body = body === undefined ? '' : String(body); this.writableEnded = true; },
  };
}

async function call(handler, url, body) {
  const request = {
    method: body === undefined ? 'GET' : 'POST',
    url,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    socket: { remoteAddress: '127.0.0.1' },
  };
  if (body !== undefined) {
    request.on = (event, fn) => {
      if (event === 'data') queueMicrotask(() => fn(Buffer.from(JSON.stringify(body))));
      if (event === 'end') queueMicrotask(fn);
      return request;
    };
  }
  const res = makeResponse();
  await handler(request, res);
  let json = null;
  try { json = JSON.parse(res.body); } catch { json = null; }
  return { status: res.statusCode, json, text: res.body };
}

/* --- c1: обновление внешнего движка через маршрут ------------------- */

async function c1() {
  const deploy = await import(pathToFileURL(path.join(PKG, 'plugin', 'lib', 'deploy.js')).href);
  const api = await import(pathToFileURL(path.join(PKG, 'plugin', 'lib', 'api.js')).href);
  const target = String(deploy.targetVersion() || '').trim();
  truthy(/^\d+\.\d+\.\d+$/.test(target), 'targetVersion(): сборка без VERSION');

  const engine = engineRepo('1.9.0');
  const workspace = emptyWorkspace();
  const mapFile = path.join(ROOT, 'engine-roots.json');
  fs.writeFileSync(mapFile, JSON.stringify({ [workspace]: engine }, null, 2) + '\n');
  const previous = process.env[ENGINE_ROOTS_ENV];
  process.env[ENGINE_ROOTS_ENV] = mapFile;
  try {
    const handler = api.createWebHandler(api.createWorkflowRuntime({ roots: [workspace] }));

    let res = await call(handler, '/workflow/api/status?root=' + encodeURIComponent(workspace));
    eq(res.json && res.json.engine.mode, 'mapped', 'status: mode');
    eq(res.json && res.json.engine.version, '1.9.0', 'status: версия внешнего движка');

    /* Запись в воркспейс по-прежнему запрещена: это чужая территория. */
    res = await call(handler, '/workflow/api/update', { root: workspace, confirm: true });
    eq(res.status, 409, 'обновление воркспейса: статус');
    eq(res.json && res.json.code, 'engine-external', 'обновление воркспейса: код');

    /* Явного запроса мало: нужно подтверждение. */
    res = await call(handler, '/workflow/api/update', { root: workspace, target: 'engine-repo' });
    eq(res.status, 400, 'engine-repo без confirm: статус');

    res = await call(handler, '/workflow/api/update', { root: workspace, target: 'engine-repo', confirm: true });
    eq(res.status, 200, 'engine-repo с confirm: статус (ответ: ' + String(res.text).slice(0, 300) + ')');
    eq(res.json && res.json.ok, true, 'engine-repo: ok');
    truthy(res.json && typeof res.json.engineRepo === 'string' && res.json.engineRepo.length > 0, 'engine-repo: ответ называет репозиторий');
    eq(versionOf(engine), target, 'engine-repo: репозиторий движка обновлён');
    truthy(!fs.existsSync(path.join(workspace, 'docs', 'subagent-workflow')), 'engine-repo: воркспейс не изменён');

    res = await call(handler, '/workflow/api/status?root=' + encodeURIComponent(workspace));
    eq(res.json && res.json.engine.version, target, 'status после обновления: версия');

    /* У локального движка нет отдельного репозитория — отказ, а не молчаливая запись. */
    const local = engineRepo('1.9.0');
    const handler2 = api.createWebHandler(api.createWorkflowRuntime({ roots: [local] }));
    res = await call(handler2, '/workflow/api/update', { root: local, target: 'engine-repo', confirm: true });
    eq(res.status, 400, 'локальный движок: статус');
    eq(res.json && res.json.code, 'engine-not-external', 'локальный движок: код');
    eq(versionOf(local), '1.9.0', 'локальный движок: VERSION не изменился');
  } finally {
    if (previous === undefined) delete process.env[ENGINE_ROOTS_ENV];
    else process.env[ENGINE_ROOTS_ENV] = previous;
  }
}

/* --- c2: панель говорит, где обновляется внешний движок ------------- */

async function c2() {
  const client = fs.readFileSync(path.join(PKG, 'plugin', 'lib', 'client.js'), 'utf8');
  for (const word of CLIENT_WORDS) truthy(client.includes(word), 'client.js: нет текста «' + word + '»');
  for (const word of CLIENT_FORBIDDEN) truthy(!client.includes(word), 'client.js: осталось обещание «' + word + '»');
  const tests = fs.readFileSync(path.join(PKG, 'plugin', 'test', 'client.test.mjs'), 'utf8');
  truthy(tests.includes(CLIENT_TEST), 'client.test.mjs: нет теста «' + CLIENT_TEST + '»');

  /* Узкий набор: только свой файл карточки, а не весь набор пакета (0048). */
  const run = spawnSync(process.execPath, [
    '--test',
    path.join(PKG, 'plugin', 'test', 'client.test.mjs'),
  ], {
    cwd: PKG, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 1800000,
  });
  if (run.status !== 0) throw new Error('тесты панели не зелёные: ' + String(run.stdout || '').slice(-1200) + String(run.stderr || '').slice(-600));
}

const cases = { c1, c2 };
const id = String(process.argv[2] || 'c1').toLowerCase();
try {
  if (!Object.hasOwn(cases, id)) {
    console.log('EXTERNAL-ENGINE FAIL usage: node spec/checks/external-engine.mjs c1|c2');
    process.exit(2);
  }
  await cases[id]();
  console.log('EXTERNAL-ENGINE OK ' + id);
} catch (error) {
  console.log('EXTERNAL-ENGINE FAIL ' + id + ': ' + (error && error.message ? error.message : String(error)));
  process.exit(1);
}
