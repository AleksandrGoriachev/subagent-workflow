/*
 * 2.6.14 (0039): связь «воркспейс → движок» объявляется конфигом профиля или
 * выбирается кнопкой, а не правкой карты руками.
 *
 * Здесь проверяются маршруты, которые делают связь видимой и записываемой:
 * POST /api/engine-link (confirm, свой Origin, атомарная карта, 409
 * engine-config при декларативной связи) и GET /api/engine/candidates
 * (только воркспейсы с движком, с версией и признаком current).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorkflowRuntime, createWebHandler } from '../lib/api.js';
import { writeEngineLink } from '../lib/engine-root.js';

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function workspace(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Развёрнутый движок: маркер — VERSION, как у настоящей копии. */
function engineAt(dir, version = '2.6.14') {
  fs.mkdirSync(path.join(dir, 'docs', 'subagent-workflow'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'subagent-workflow', 'VERSION'), version + '\n');
  return dir;
}

function writeMap(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
  return file;
}

function removeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 50, retryDelay: 200 });
  } catch {
    /* утечка временного каталога не отменяет проверенное поведение */
  }
}

function samePath(left, right) {
  return path.resolve(String(left)).toLowerCase() === path.resolve(String(right)).toLowerCase();
}

function mapHasWorkspace(map, wanted) {
  return Object.keys(map).some((key) => samePath(key, wanted));
}

/* --- HTTP-двойники: тот же приём, что в api.test.mjs ------------------- */

function makeRequest(url, options = {}) {
  const headers = options.headers !== undefined
    ? options.headers
    : (options.body === undefined ? {} : { 'content-type': 'application/json' });
  const request = {
    method: options.method || 'GET',
    url,
    headers,
    socket: { remoteAddress: options.remote === undefined ? '127.0.0.1' : options.remote },
  };
  if (options.body !== undefined) {
    const text = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    const listeners = { data: [], end: [], error: [] };
    request.on = (event, fn) => {
      (listeners[event] || listeners.data).push(fn);
      return request;
    };
    queueMicrotask(() => {
      for (const fn of listeners.data) fn(Buffer.from(text, 'utf8'));
      for (const fn of listeners.end) fn();
    });
  }
  return request;
}

function makeResponse() {
  return {
    statusCode: 200,
    headers: {},
    writableEnded: false,
    body: '',
    setHeader(key, value) {
      this.headers[String(key).toLowerCase()] = value;
    },
    end(body) {
      this.body = body === undefined ? '' : String(body);
      this.writableEnded = true;
    },
  };
}

async function call(handler, url, options = {}) {
  const res = makeResponse();
  await handler(makeRequest(url, options), res);
  let json = null;
  try {
    json = JSON.parse(res.body);
  } catch {
    json = null;
  }
  return { status: res.statusCode, headers: res.headers, json, text: res.body };
}

/** Подменить env WF_ENGINE_ROOTS на время теста и вернуть прежнее значение. */
async function withMapFile(file, fn) {
  const saved = process.env.WF_ENGINE_ROOTS;
  process.env.WF_ENGINE_ROOTS = file;
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env.WF_ENGINE_ROOTS;
    else process.env.WF_ENGINE_ROOTS = saved;
  }
}

/* --- POST /api/engine-link ------------------------------------------- */

test('POST /api/engine-link: confirm, тип и Origin — до записи (2.6.14)', async () => {
  const dir = tempDir('wf-engine-link-guard-');
  const ws = workspace(path.join(dir, 'ws'));
  const engine = engineAt(path.join(dir, 'engine'), '2.6.14');
  const mapDir = path.join(dir, 'map');
  const mapFile = path.join(mapDir, 'engine-roots.json');
  try {
    await withMapFile(mapFile, async () => {
      const handler = createWebHandler(createWorkflowRuntime({ roots: [ws] }));
      const route = '/workflow/api/engine-link';

      let res = await call(handler, route, { method: 'POST', body: { root: ws, engine } });
      assert.equal(res.status, 400, 'без confirm — 400');
      assert.equal(fs.existsSync(mapFile), false, 'без confirm карта не создана');

      res = await call(handler, route, { method: 'POST', body: { root: ws, engine, confirm: false } });
      assert.equal(res.status, 400, 'confirm: false — 400');
      assert.equal(fs.existsSync(mapFile), false);

      res = await call(handler, route, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: { root: ws, engine, confirm: true },
      });
      assert.equal(res.status, 415, 'text/plain — 415 до записи');

      res = await call(handler, route, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
        body: { root: ws, engine, confirm: true },
      });
      assert.equal(res.status, 403, 'чужой Origin — 403');
      assert.equal(fs.existsSync(mapFile), false, 'ни один отказ не создал карту');
    });
  } finally {
    removeDir(dir);
  }
});

test('POST /api/engine-link: атомарная карта, /api/status называет источник (2.6.14)', async () => {
  const dir = tempDir('wf-engine-link-write-');
  const ws = workspace(path.join(dir, 'ws'));
  const engine = engineAt(path.join(dir, 'engine'), '2.6.14');
  const mapDir = path.join(dir, 'map');
  const mapFile = path.join(mapDir, 'engine-roots.json');
  try {
    await withMapFile(mapFile, async () => {
      /* Карта уже существует: запись должна дополнить её, а не затереть. */
      const other = workspace(path.join(dir, 'other'));
      writeMap(mapFile, { [other]: engineAt(path.join(dir, 'engine-b'), '2.6.13') });

      const handler = createWebHandler(createWorkflowRuntime({ roots: [ws] }));
      const res = await call(handler, '/workflow/api/engine-link', {
        method: 'POST',
        body: { root: ws, engine, confirm: true },
      });
      assert.equal(res.status, 200);
      assert.equal(res.json.ok, true);
      assert.equal(res.json.engine.mode, 'mapped');
      assert.equal(res.json.engine.version, '2.6.14');

      const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
      assert.ok(mapHasWorkspace(map, ws), 'связь записана');
      assert.ok(mapHasWorkspace(map, other), 'прежняя запись сохранена');
      const leftovers = fs.readdirSync(mapDir).filter((name) => name !== 'engine-roots.json');
      assert.deepEqual(leftovers, [], 'атомарная запись не оставляет временных файлов');

      const status = await call(handler, '/workflow/api/status?root=' + encodeURIComponent(ws));
      assert.equal(status.status, 200);
      assert.equal(status.json.engine.mode, 'mapped');
      assert.equal(status.json.engine.source, 'mapping');
      assert.ok(samePath(status.json.engine.root, engine));
      assert.equal(status.json.engine.version, '2.6.14');
      assert.equal(fs.existsSync(path.join(ws, 'docs')), false, 'воркспейс не изменён');
    });
  } finally {
    removeDir(dir);
  }
});

test('POST /api/engine-link: относительный путь, каталог без движка и чужой корень — 400 (2.6.14)', async () => {
  const dir = tempDir('wf-engine-link-bad-');
  const ws = workspace(path.join(dir, 'ws'));
  const engine = engineAt(path.join(dir, 'engine'), '2.6.14');
  const empty = workspace(path.join(dir, 'empty'));
  const mapFile = path.join(dir, 'map', 'engine-roots.json');
  try {
    await withMapFile(mapFile, async () => {
      const handler = createWebHandler(createWorkflowRuntime({ roots: [ws] }));
      const route = '/workflow/api/engine-link';

      let res = await call(handler, route, {
        method: 'POST',
        body: { root: ws, engine: 'relative/engine', confirm: true },
      });
      assert.equal(res.status, 400, 'относительный движок отвергнут');

      res = await call(handler, route, { method: 'POST', body: { root: ws, engine: empty, confirm: true } });
      assert.equal(res.status, 400, 'каталог без движка отвергнут');
      assert.equal(res.json.code, 'not-an-engine');

      res = await call(handler, route, {
        method: 'POST',
        body: { root: path.join(dir, 'other'), engine, confirm: true },
      });
      assert.equal(res.status, 400, 'корень вне runtime.roots отвергнут');
      assert.equal(fs.existsSync(mapFile), false, 'ни один отказ не создал карту');
    });
  } finally {
    removeDir(dir);
  }
});

test('POST /api/engine-link: конфиг профиля сильнее кнопки — 409 engine-config (2.6.14)', async () => {
  const dir = tempDir('wf-engine-link-config-');
  const ws = workspace(path.join(dir, 'ws'));
  const engine = engineAt(path.join(dir, 'engine'), '2.6.14');
  const engineC = engineAt(path.join(dir, 'engine-c'), '2.6.10');
  const mapFile = path.join(dir, 'map', 'engine-roots.json');
  try {
    await withMapFile(mapFile, async () => {
      writeMap(mapFile, {});
      const handler = createWebHandler(createWorkflowRuntime({
        roots: [ws],
        engines: { roots: { [ws]: engineC } },
      }));
      const res = await call(handler, '/workflow/api/engine-link', {
        method: 'POST',
        body: { root: ws, engine, confirm: true },
      });
      assert.equal(res.status, 409);
      assert.equal(res.json.code, 'engine-config');
      assert.match(res.json.hint, /engines\.roots/u);
      const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
      assert.equal(mapHasWorkspace(map, ws), false, 'карта не тронута');

      /* Чтение при этом идёт из объявленного движка, а не из воркспейса. */
      const status = await call(handler, '/workflow/api/status?root=' + encodeURIComponent(ws));
      assert.equal(status.json.engine.mode, 'mapped');
      assert.equal(status.json.engine.source, 'config');
      assert.equal(status.json.engine.version, '2.6.10');
    });
  } finally {
    removeDir(dir);
  }
});

/* --- GET /api/engine/candidates -------------------------------------- */

test('GET /api/engine/candidates: только воркспейсы с движком, версия и current (2.6.14)', async () => {
  const dir = tempDir('wf-engine-candidates-');
  const withEngine = engineAt(path.join(dir, 'ws-with-engine'), '2.6.13');
  const withoutEngine = workspace(path.join(dir, 'ws-without-engine'));
  const current = engineAt(path.join(dir, 'ws-current'), '2.6.14');
  const missing = path.join(dir, 'no-such-workspace');
  const registry = {
    list: () => [
      { id: 'a', path: withEngine },
      { id: 'b', path: withoutEngine },
      { id: 'c', path: current },
      { id: 'd', path: missing },
    ],
  };
  try {
    const handler = createWebHandler(createWorkflowRuntime({}, { getWorkspaceRegistry: () => registry }));
    const res = await call(handler, '/workflow/api/engine/candidates?root=' + encodeURIComponent(current));
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.candidates));
    const list = res.json.candidates;
    const byPath = (wanted) => list.find((item) => item && samePath(item.path, wanted));

    const first = byPath(withEngine);
    assert.ok(first, 'воркспейс с движком присутствует');
    assert.equal(first.version, '2.6.13');
    assert.equal(first.current, false);
    assert.ok(!byPath(withoutEngine), 'воркспейс без движка не попадает');
    assert.ok(!byPath(missing), 'несуществующий путь не попадает');
    const self = byPath(current);
    assert.ok(self, 'текущий воркспейс присутствует');
    assert.equal(self.current, true);
    assert.equal(self.version, '2.6.14');
    for (const item of list) {
      assert.equal(typeof item.path, 'string');
      assert.equal(typeof item.version, 'string');
      assert.ok(item.version.trim().length > 0, 'у каждой записи есть версия');
    }
  } finally {
    removeDir(dir);
  }
});

/* --- запись карты ----------------------------------------------------- */

test('writeEngineLink: атомарная запись и отказ на битой карте (2.6.14)', () => {
  const dir = tempDir('wf-engine-write-');
  const ws = workspace(path.join(dir, 'ws'));
  const engine = engineAt(path.join(dir, 'engine'), '2.6.14');
  const mapDir = path.join(dir, 'map');
  const mapFile = path.join(mapDir, 'engine-roots.json');
  try {
    const first = writeEngineLink(ws, engine, { file: mapFile, env: {} });
    assert.equal(first.ok, true);
    assert.deepEqual(fs.readdirSync(mapDir), ['engine-roots.json'], 'временный файл не остался');
    const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
    assert.ok(mapHasWorkspace(map, ws));

    fs.writeFileSync(mapFile, '{ broken', 'utf8');
    const broken = writeEngineLink(ws, engine, { file: mapFile, env: {} });
    assert.equal(broken.ok, false);
    assert.equal(broken.code, 'map-broken');
    assert.equal(fs.readFileSync(mapFile, 'utf8'), '{ broken', 'битая карта не перезаписана');

    const relative = writeEngineLink(ws, 'relative/engine', { file: mapFile, env: {} });
    assert.equal(relative.ok, false, 'относительный движок не записывается');
  } finally {
    removeDir(dir);
  }
});
