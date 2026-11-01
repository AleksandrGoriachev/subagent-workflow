/*
 * 0.9.0 / 2.6.9: внешний движок — карта, резолв и запрет записи (0034).
 *
 * Воркспейс без движка (split-optimizer: только .dsh и structure) читает движок
 * по карте %USERPROFILE%\.dsh\workflow\engine-roots.json (env WF_ENGINE_ROOTS) и
 * не меняется: POST guard/deploy/update отвечают 409 engine-external до любых
 * действий. Здесь проверяются обе половины — чистые функции карты и маршруты.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorkflowRuntime, createWebHandler } from '../lib/api.js';
import {
  ENGINE_ROOTS_ENV,
  ENGINE_ROOTS_REL,
  enginePathKey,
  engineRootsFile,
  engineView,
  readEngineRoots,
  resolveEngine,
} from '../lib/engine-root.js';

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Развёрнутый движок: маркер — VERSION, как у настоящей копии. */
function engineAt(dir, version = '2.6.9') {
  fs.mkdirSync(path.join(dir, 'docs', 'subagent-workflow'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'subagent-workflow', 'VERSION'), version + '\n');
  return dir;
}

function deployedEngineAt(dir) {
  engineAt(dir);
  fs.writeFileSync(
    path.join(dir, 'docs', 'subagent-workflow', 'workflow.config.json'),
    JSON.stringify({ version: 1, tasksDir: 'docs/tasks', logs: 'local' }, null, 2) + '\n',
  );
  fs.mkdirSync(path.join(dir, 'docs', 'tasks'), { recursive: true });
  return dir;
}

function workspaceAt(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeRoots(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
  return file;
}

/* --- карта --------------------------------------------------------- */

test('engineRootsFile: env WF_ENGINE_ROOTS переопределяет домашний путь', () => {
  const home = tempDir('wf-engine-home-');
  const override = path.join(home, 'roots.json');
  const base = { USERPROFILE: home, HOME: home };
  assert.equal(engineRootsFile({ ...base, [ENGINE_ROOTS_ENV]: override }), path.resolve(override));
  assert.equal(engineRootsFile(base), path.resolve(home, ENGINE_ROOTS_REL));
  assert.equal(engineRootsFile({ ...base, [ENGINE_ROOTS_ENV]: '   ' }), path.resolve(home, ENGINE_ROOTS_REL));
});

test('readEngineRoots: файла нет — не ошибка, карта не создаётся', () => {
  const file = path.join(tempDir('wf-engine-map-'), 'engine-roots.json');
  const map = readEngineRoots({ file });
  assert.equal(map.exists, false);
  assert.equal(map.error, null);
  assert.deepEqual(map.roots, []);
  assert.equal(fs.existsSync(file), false, 'панель не пишет карту');
});

test('readEngineRoots: битый JSON и не-объект не роняют чтение', () => {
  const dir = tempDir('wf-engine-broken-');
  const broken = readEngineRoots({ file: writeRoots(path.join(dir, 'broken.json'), '{ not json') });
  assert.equal(broken.exists, true);
  assert.match(broken.error, /не JSON/u);
  assert.deepEqual(broken.roots, []);
  const array = readEngineRoots({ file: writeRoots(path.join(dir, 'array.json'), '[]') });
  assert.match(array.error, /объект/u);
  const nullValue = readEngineRoots({ file: writeRoots(path.join(dir, 'null.json'), 'null') });
  assert.match(nullValue.error, /объект/u);
});

test('readEngineRoots: относительные записи пропускаются, дубли нормализуются', () => {
  const dir = tempDir('wf-engine-rel-');
  const ws = path.join(dir, 'ws');
  const engine = path.join(dir, 'engine');
  const other = path.join(dir, 'engine-two');
  const wsTwo = path.join(dir, 'ws-two');
  const quote = (value) => JSON.stringify(value);
  /*
   * Сырой JSON: карта — файл, и в нём возможны записи, которые совпадают
   * после нормализации (хвостовой слэш). Точные дубли ключей JSON.parse
   * схлопывает сам, а нормализованные — уже этот модуль.
   */
  const text = '{'
    + quote('relative/ws') + ':' + quote(engine) + ','
    + quote(ws) + ':' + quote(engine) + ','
    + quote(ws + path.sep) + ':' + quote(other) + ','
    + quote(wsTwo) + ':' + quote('relative/engine')
    + '}';
  const map = readEngineRoots({ file: writeRoots(path.join(dir, 'roots.json'), text) });
  assert.equal(map.roots.length, 1, 'относительные пропущены, дубль после нормализации — тоже');
  assert.equal(map.roots[0].workspace, ws);
  assert.equal(map.roots[0].engine, engine, 'первая запись выигрывает');
  assert.ok(map.byKey.has(enginePathKey(ws)));
  assert.equal(map.skipped.length, 3, 'относительный воркспейс, относительный движок и дубль по слэшу');
  assert.equal(map.byKey.get(enginePathKey(ws)).engine, engine, 'первая запись выигрывает');
});

test('readEngineRoots: ключи без учёта регистра и хвостового слэша', () => {
  const dir = tempDir('wf-engine-norm-');
  const ws = path.join(dir, 'ws');
  const engine = path.join(dir, 'engine');
  const file = writeRoots(path.join(dir, 'roots.json'), { [ws + path.sep]: engine + path.sep });
  const map = readEngineRoots({ file });
  assert.equal(map.roots.length, 1);
  assert.equal(map.roots[0].workspace, ws, 'хвостовой слэш снят');
  assert.equal(map.roots[0].engine, engine);
  assert.ok(map.byKey.has(enginePathKey(ws)), 'регистр/слэш не мешают сравнению');
  if (process.platform === 'win32') {
    assert.equal(enginePathKey(ws.toUpperCase()), enginePathKey(ws), 'Windows: регистр не важен');
  }
});

/* --- резолв -------------------------------------------------------- */

test('resolveEngine: движок в воркспейсе — source workspace', () => {
  const dir = tempDir('wf-engine-self-');
  const ws = engineAt(path.join(dir, 'ws'));
  const engine = resolveEngine(ws, { file: path.join(dir, 'absent.json') });
  assert.deepEqual(engineView(engine), { installed: true, root: ws, source: 'workspace' });
});

test('resolveEngine: карта даёт source mapping', () => {
  const dir = tempDir('wf-engine-mapped-');
  const ws = workspaceAt(path.join(dir, 'ws'));
  const engineDir = engineAt(path.join(dir, 'engine'));
  const file = writeRoots(path.join(dir, 'engine-roots.json'), { [ws]: engineDir });
  const engine = resolveEngine(ws, { file });
  assert.deepEqual(engineView(engine), { installed: true, root: engineDir, source: 'mapping' });
  assert.equal(engine.workspace, ws);
  assert.equal(engine.mapped, engineDir);
});

test('resolveEngine: карта на каталог без движка — installed false, запись не запрещена', () => {
  const dir = tempDir('wf-engine-empty-');
  const ws = workspaceAt(path.join(dir, 'ws'));
  const empty = workspaceAt(path.join(dir, 'not-an-engine'));
  const file = writeRoots(path.join(dir, 'engine-roots.json'), { [ws]: empty });
  const engine = resolveEngine(ws, { file });
  assert.equal(engine.installed, false);
  assert.equal(engine.source, 'none');
  assert.equal(engine.mapped, empty, 'путь из карты виден для диагностики');
});

test('resolveEngine: нет карты — source none', () => {
  const dir = tempDir('wf-engine-none-');
  const ws = workspaceAt(path.join(dir, 'ws'));
  const engine = resolveEngine(ws, { file: path.join(dir, 'absent.json') });
  assert.deepEqual(engineView(engine), { installed: false, root: null, source: 'none' });
});

test('resolveEngine: env WF_ENGINE_ROOTS подхватывается в момент вызова', () => {
  const dir = tempDir('wf-engine-env-');
  const ws = workspaceAt(path.join(dir, 'ws'));
  const engineDir = engineAt(path.join(dir, 'engine'));
  const file = writeRoots(path.join(dir, 'roots.json'), { [ws]: engineDir });
  const saved = process.env[ENGINE_ROOTS_ENV];
  process.env[ENGINE_ROOTS_ENV] = file;
  try {
    assert.equal(resolveEngine(ws).source, 'mapping');
  } finally {
    if (saved === undefined) delete process.env[ENGINE_ROOTS_ENV];
    else process.env[ENGINE_ROOTS_ENV] = saved;
  }
});

/* --- маршруты ------------------------------------------------------ */

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    writableEnded: false,
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(body) {
      this.body = body === undefined ? '' : String(body);
      this.writableEnded = true;
    },
  };
}

function call(handler, options = {}) {
  const res = makeRes();
  const listeners = { data: [], end: [], error: [] };
  const req = {
    method: options.method || 'GET',
    url: options.url,
    socket: { remoteAddress: '127.0.0.1' },
    headers: { 'content-type': 'application/json' },
    on(event, fn) {
      (listeners[event] || listeners.data).push(fn);
      return req;
    },
  };
  return new Promise((resolve) => {
    Promise.resolve(handler(req, res)).then(() => resolve(res), () => resolve(res));
    queueMicrotask(() => {
      if (options.body !== undefined) {
        for (const fn of listeners.data) fn(Buffer.from(JSON.stringify(options.body), 'utf8'));
      }
      for (const fn of listeners.end) fn();
    });
  });
}

function parse(res) {
  try {
    return JSON.parse(res.body);
  } catch {
    return null;
  }
}

async function withRootsEnv(value, fn) {
  const saved = process.env[ENGINE_ROOTS_ENV];
  process.env[ENGINE_ROOTS_ENV] = value;
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env[ENGINE_ROOTS_ENV];
    else process.env[ENGINE_ROOTS_ENV] = saved;
  }
}

test('API: /api/status отдаёт engine mapping, чтение идёт из движка', async () => {
  const dir = tempDir('wf-engine-api-');
  const ws = workspaceAt(path.join(dir, 'ws'));
  const engineDir = deployedEngineAt(path.join(dir, 'engine'));
  const file = writeRoots(path.join(dir, 'engine-roots.json'), { [ws]: engineDir });
  await withRootsEnv(file, async () => {
    const handler = createWebHandler(createWorkflowRuntime({ roots: [ws] }));
    const status = await call(handler, { url: '/workflow/api/status?root=' + encodeURIComponent(ws) });
    const json = parse(status);
    assert.equal(status.statusCode, 200);
    assert.deepEqual(json.engine, { installed: true, root: engineDir, source: 'mapping' });
    assert.equal(json.root, ws, 'открыт воркспейс, а не движок');
    assert.equal(json.repo.root, engineDir, 'файлы прочитаны из движка');
    assert.equal(json.repo.configLoaded, true);

    const tasks = await call(handler, { url: '/workflow/api/tasks?root=' + encodeURIComponent(ws) });
    assert.equal(tasks.statusCode, 200);
    assert.equal(parse(tasks).root, engineDir);

    const policy = await call(handler, { url: '/workflow/api/policy?root=' + encodeURIComponent(ws) });
    assert.equal(policy.statusCode, 200);
    assert.equal(parse(policy).root, engineDir);
  });
  assert.equal(fs.existsSync(path.join(ws, 'docs')), false, 'воркспейс остался пустым');
});

test('API: POST guard/deploy/update при mapping — 409 engine-external до любых действий', async () => {
  const dir = tempDir('wf-engine-409-');
  const ws = workspaceAt(path.join(dir, 'ws'));
  const engineDir = deployedEngineAt(path.join(dir, 'engine'));
  const file = writeRoots(path.join(dir, 'engine-roots.json'), { [ws]: engineDir });
  await withRootsEnv(file, async () => {
    const handler = createWebHandler(createWorkflowRuntime({ roots: [ws] }));
    const guard = await call(handler, {
      method: 'POST',
      url: '/workflow/api/guard',
      body: { root: ws, enabled: true, confirm: true },
    });
    assert.equal(guard.statusCode, 409);
    const guardJson = parse(guard);
    assert.equal(guardJson.code, 'engine-external');
    assert.match(guardJson.hint, /карт/u);
    assert.equal(guardJson.root, ws);
    assert.deepEqual(guardJson.engine, { installed: true, root: engineDir, source: 'mapping' });

    const deploy = await call(handler, {
      method: 'POST',
      url: '/workflow/api/deploy',
      body: { root: ws, confirm: true },
    });
    assert.equal(deploy.statusCode, 409);
    assert.equal(parse(deploy).code, 'engine-external');

    const update = await call(handler, {
      method: 'POST',
      url: '/workflow/api/update',
      body: { root: ws, confirm: true, allowInProgress: true },
    });
    assert.equal(update.statusCode, 409);
    assert.equal(parse(update).code, 'engine-external');
  });
  /* Воркспейс не меняется: ни docs/, ни .gitignore, ни журналов. */
  assert.equal(fs.existsSync(path.join(ws, 'docs')), false, 'docs/ не появился');
  assert.equal(fs.existsSync(path.join(ws, '.gitignore')), false, '.gitignore не тронут');
  /* И движок не обновлялся: deploy.log не появился. */
  assert.equal(fs.existsSync(path.join(engineDir, 'docs', 'subagent-workflow', 'deploy.log')), false);
});

test('API: обычный воркспейс не получает 409 — guard пишет как раньше', async () => {
  const dir = tempDir('wf-engine-normal-');
  const repo = deployedEngineAt(path.join(dir, 'repo'));
  const handler = createWebHandler(createWorkflowRuntime({ roots: [repo] }));
  const status = await call(handler, { url: '/workflow/api/status?root=' + encodeURIComponent(repo) });
  assert.equal(parse(status).engine.source, 'workspace');
  const guard = await call(handler, {
    method: 'POST',
    url: '/workflow/api/guard',
    body: { root: repo, enabled: true },
  });
  assert.notEqual(guard.statusCode, 409);
  assert.equal(guard.statusCode, 200);
  assert.equal(parse(guard).enabled, true);
});

test('API: битая карта не роняет панель', async () => {
  const dir = tempDir('wf-engine-badtomap-');
  const ws = workspaceAt(path.join(dir, 'ws'));
  const file = writeRoots(path.join(dir, 'engine-roots.json'), '{ broken');
  await withRootsEnv(file, async () => {
    const handler = createWebHandler(createWorkflowRuntime({ roots: [ws] }));
    const status = await call(handler, { url: '/workflow/api/status?root=' + encodeURIComponent(ws) });
    assert.equal(status.statusCode, 200);
    const json = parse(status);
    assert.deepEqual(json.engine, { installed: false, root: null, source: 'none' });
    assert.equal(json.repo.configLoaded, false);
  });
});
