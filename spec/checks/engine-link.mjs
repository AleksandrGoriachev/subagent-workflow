#!/usr/bin/env node
/*
 * 2.6.14 (0039): связь «воркспейс → внешний движок» объявляется конфигом и кнопкой.
 *
 * Одна проверка на задание: источники резолвера (local → config → карта → absent),
 * POST /api/engine-link (confirm, свой Origin, атомарная карта, конфиг не
 * подменяется), список кандидатов, карточка панели и флаги init.
 *
 * Запуск: node spec/checks/engine-link.mjs c1 … c6 | all
 * Каждый подрежим печатает ровно одну строку: «ENGINE-LINK OK cN» или
 * «ENGINE-LINK FAIL cN: причина». Причина — первая сломанная инварианта, а не
 * стек: красный прогон обязан падать по делу, а приёмка — читаться глазами.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-engine-link-'));
/*
 * Конвенция пакета (2.6.10): вне пакета — в развёрнутой копии docs/subagent-workflow —
 * проверка печатает SKIP и выходит 0. Без этого deployed-copy видит ENOENT на
 * plugin/lib и краснеет на любой реализации.
 */
if (!fs.existsSync(path.join(PKG, 'spec'))) {
  console.log('SKIP: проверка пакета вне пакета');
  process.exit(0);
}
const ENGINE_ROOTS_ENV = 'WF_ENGINE_ROOTS';

/* Слова панели: их читает человек, поэтому они часть контракта, а не украшение. */
const CARD_WORDS = [
  'движок не подключён',
  'Развернуть здесь',
  'Подключить существующий',
  'задано конфигом профиля',
  'выбрано в панели',
];
/* Поведенческие тесты карточки: исполнитель обязан их написать, проверка их ищет. */
const CARD_TESTS = [
  '0.9.3 absent: два действия, без ошибки',
  '0.9.3 mapped: путь, версия, источник',
];

function eq(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(label + ': ожидалось ' + JSON.stringify(expected) + ', получено ' + JSON.stringify(actual));
  }
}

function truthy(value, label) {
  if (!value) throw new Error(label);
}

function samePath(left, right) {
  const norm = (value) => String(path.resolve(value)).replace(/[\\/]+$/u, '');
  const a = norm(left);
  const b = norm(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(ROOT, prefix));
}

function workspace(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Развёрнутый движок: маркер — VERSION, как у настоящей копии. */
function engineAt(dir, version) {
  fs.mkdirSync(path.join(dir, 'docs', 'subagent-workflow'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'subagent-workflow', 'VERSION'), version + '\n');
  return dir;
}

function writeMap(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
  return file;
}

function mapEntryFor(map, workspacePath) {
  const entry = Object.entries(map).find(([key]) => samePath(key, workspacePath));
  return entry ? entry[1] : undefined;
}

function tail(text, limit = 1200) {
  const value = String(text || '').trim();
  return value.length <= limit ? value : '…' + value.slice(-limit);
}

/*
 * Дочерний процесс с захватом вывода ЧЕРЕЗ ФАЙЛЫ, а не pipe: в песочнице DSH
 * именованные каналы закрыты, и spawnSync с encoding умирает EPERM. Тот же
 * приём, что в spec/scripts/lib/common.mjs.
 */
function runCapture(command, args, options = {}) {
  const dir = fs.mkdtempSync(path.join(ROOT, 'run-'));
  const outFile = path.join(dir, 'out.txt');
  const errFile = path.join(dir, 'err.txt');
  const ofd = fs.openSync(outFile, 'a');
  const efd = fs.openSync(errFile, 'a');
  try {
    const res = spawnSync(command, args, {
      cwd: options.cwd || PKG,
      timeout: options.timeout || 1800000,
      stdio: ['ignore', ofd, efd],
      env: options.env ? { ...process.env, ...options.env } : process.env,
    });
    return {
      status: res.status,
      error: res.error,
      stdout: fs.readFileSync(outFile, 'utf8'),
      stderr: fs.readFileSync(errFile, 'utf8'),
    };
  } finally {
    fs.closeSync(ofd);
    fs.closeSync(efd);
  }
}

/* --- HTTP-двойники: тот же приём, что в plugin/test/api.test.mjs ------- */

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

/* --- c1: порядок источников ------------------------------------------- */

async function c1() {
  const { resolveEngine, engineView } = await import(pathToFileURL(path.join(PKG, 'plugin', 'lib', 'engine-root.js')).href);
  const dir = tempDir('c1-');
  const ws = workspace(path.join(dir, 'ws'));
  const local = engineAt(path.join(dir, 'local'), '2.6.12');
  const engineA = engineAt(path.join(dir, 'engine-a'), '2.6.14');
  const engineB = engineAt(path.join(dir, 'engine-b'), '2.6.13');
  const map = writeMap(path.join(dir, 'roots.json'), { [ws]: engineB });
  const config = { engines: { roots: { [ws]: engineA } } };

  /* Конфиг перекрывает карту: декларативная связь не подменяется молча. */
  let found = resolveEngine(ws, { config, file: map, env: {} });
  eq(found.mode, 'mapped', 'config: mode');
  eq(found.source, 'config', 'config: source');
  eq(found.root, engineA, 'config: root');
  eq(found.version, '2.6.14', 'config: version');
  eq(found.installed, true, 'config: installed');

  /* Карта — следующий источник: без конфига связь берётся из файла. */
  found = resolveEngine(ws, { file: map, env: {} });
  eq(found.mode, 'mapped', 'карта: mode');
  eq(found.source, 'mapping', 'карта: source');
  eq(found.root, engineB, 'карта: root');
  eq(found.version, '2.6.13', 'карта: version');

  /* Ни конфига, ни записи — absent: структура без движка, а не ошибка. */
  const empty = path.join(dir, 'no-such-map.json');
  found = resolveEngine(ws, { file: empty, env: {} });
  eq(found.mode, 'absent', 'absent: mode');
  eq(found.source, 'none', 'absent: source');
  eq(found.installed, false, 'absent: installed');
  eq(found.root, null, 'absent: root');

  /* Локальный движок сильнее и конфига, и карты. */
  found = resolveEngine(local, { config: { engines: { roots: { [local]: engineA } } }, file: map, env: {} });
  eq(found.mode, 'local', 'local: mode');
  eq(found.source, 'workspace', 'local: source');
  eq(found.root, local, 'local: root');
  eq(found.version, '2.6.12', 'local: version');

  /* Запись конфига без движка — объявленная, но битая связь: absent с source config. */
  found = resolveEngine(ws, { config: { engines: { roots: { [ws]: path.join(dir, 'missing-engine') } } }, file: map, env: {} });
  eq(found.mode, 'absent', 'битый конфиг: mode');
  eq(found.source, 'config', 'битый конфиг: source');
  eq(found.installed, false, 'битый конфиг: installed');

  /* Относительный путь в конфиге — не связь: как и в карте, пропускается. */
  found = resolveEngine(ws, { config: { engines: { roots: { [ws]: 'relative/engine' } } }, file: map, env: {} });
  eq(found.source, 'mapping', 'относительный конфиг: fallback на карту');

  /* Проекция для /api/status отдаёт mode, version и source, не только installed. */
  const view = engineView(resolveEngine(ws, { config, file: map, env: {} }));
  eq(view.mode, 'mapped', 'engineView: mode');
  eq(view.version, '2.6.14', 'engineView: version');
  eq(view.source, 'config', 'engineView: source');
  eq(view.root, engineA, 'engineView: root');
  eq(view.installed, true, 'engineView: installed');
}

/* --- c2: POST /api/engine-link ---------------------------------------- */

async function c2() {
  const { createWorkflowRuntime, createWebHandler } = await import(pathToFileURL(path.join(PKG, 'plugin', 'lib', 'api.js')).href);
  const dir = tempDir('c2-');
  const ws = workspace(path.join(dir, 'ws'));
  const empty = workspace(path.join(dir, 'empty'));
  const engineA = engineAt(path.join(dir, 'engine-a'), '2.6.14');
  const engineC = engineAt(path.join(dir, 'engine-c'), '2.6.10');
  const mapDir = path.join(dir, 'map');
  const mapFile = path.join(mapDir, 'engine-roots.json');
  const previous = process.env[ENGINE_ROOTS_ENV];
  process.env[ENGINE_ROOTS_ENV] = mapFile;
  try {
    const handler = createWebHandler(createWorkflowRuntime({ roots: [ws] }));
    const route = '/workflow/api/engine-link';

    let res = await call(handler, route, { method: 'POST', body: { root: ws, engine: engineA } });
    eq(res.status, 400, 'POST без confirm: статус');
    truthy(!fs.existsSync(mapFile), 'POST без confirm: карта не создана');

    res = await call(handler, route, { method: 'POST', body: { root: ws, engine: engineA, confirm: false } });
    eq(res.status, 400, 'POST confirm:false: статус');

    res = await call(handler, route, { method: 'POST', body: { root: ws, engine: engineA, confirm: true } });
    eq(res.status, 200, 'POST с confirm: статус');
    eq(res.json && res.json.ok, true, 'POST с confirm: ok');
    truthy(fs.existsSync(mapFile), 'POST с confirm: карта создана');
    const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
    const linked = mapEntryFor(map, ws);
    truthy(typeof linked === 'string' && samePath(linked, engineA), 'POST с confirm: запись ' + ws + ' → ' + engineA);
    const leftovers = fs.readdirSync(mapDir).filter((name) => name !== 'engine-roots.json');
    eq(leftovers.length, 0, 'POST с confirm: временных файлов не осталось (атомарная запись)');

    res = await call(handler, '/workflow/api/status?root=' + encodeURIComponent(ws));
    eq(res.status, 200, 'GET status после связи: статус');
    eq(res.json.engine.mode, 'mapped', 'GET status после связи: mode');
    eq(res.json.engine.source, 'mapping', 'GET status после связи: source');
    eq(res.json.engine.root, engineA, 'GET status после связи: root');
    eq(res.json.engine.version, '2.6.14', 'GET status после связи: version');

    res = await call(handler, route, { method: 'POST', body: { root: ws, engine: 'relative/engine', confirm: true } });
    eq(res.status, 400, 'POST относительный движок: статус');

    res = await call(handler, route, { method: 'POST', body: { root: ws, engine: empty, confirm: true } });
    eq(res.status, 400, 'POST каталог без движка: статус');
    eq(res.json && res.json.code, 'not-an-engine', 'POST каталог без движка: код');

    res = await call(handler, route, { method: 'POST', body: { root: path.join(dir, 'other'), engine: engineA, confirm: true } });
    eq(res.status, 400, 'POST чужой корень: статус');

    res = await call(handler, route, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: { root: ws, engine: engineA, confirm: true },
    });
    eq(res.status, 415, 'POST text/plain: статус');

    res = await call(handler, route, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
      body: { root: ws, engine: engineA, confirm: true },
    });
    eq(res.status, 403, 'POST чужой Origin: статус');

    /* Конфиг перекрывает кнопку: декларативная связь не подменяется, 409. */
    const ws2 = workspace(path.join(dir, 'ws2'));
    const handler2 = createWebHandler(createWorkflowRuntime({
      roots: [ws2],
      engines: { roots: { [ws2]: engineC } },
    }));
    res = await call(handler2, route, { method: 'POST', body: { root: ws2, engine: engineA, confirm: true } });
    eq(res.status, 409, 'POST при связи из конфига: статус');
    eq(res.json && res.json.code, 'engine-config', 'POST при связи из конфига: код');
    const after = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
    eq(mapEntryFor(after, ws2), undefined, 'POST при связи из конфига: карта не тронута');
  } finally {
    if (previous === undefined) delete process.env[ENGINE_ROOTS_ENV];
    else process.env[ENGINE_ROOTS_ENV] = previous;
  }
}

/* --- c3: кандидаты ----------------------------------------------------- */

async function c3() {
  const { createWorkflowRuntime, createWebHandler } = await import(pathToFileURL(path.join(PKG, 'plugin', 'lib', 'api.js')).href);
  const dir = tempDir('c3-');
  const withEngine = engineAt(path.join(dir, 'ws-with-engine'), '2.6.13');
  const withoutEngine = workspace(path.join(dir, 'ws-without-engine'));
  const current = engineAt(path.join(dir, 'ws-current'), '2.6.14');
  const registry = {
    list: () => [
      { id: 'a', path: withEngine },
      { id: 'b', path: withoutEngine },
      { id: 'c', path: current },
      { id: 'd', path: path.join(dir, 'no-such-workspace') },
    ],
  };
  const handler = createWebHandler(createWorkflowRuntime({}, { getWorkspaceRegistry: () => registry }));
  const res = await call(handler, '/workflow/api/engine/candidates?root=' + encodeURIComponent(current));
  eq(res.status, 200, 'GET candidates: статус');
  truthy(res.json && Array.isArray(res.json.candidates), 'GET candidates: массив candidates');
  const list = res.json.candidates;
  const byPath = (wanted) => list.find((item) => item && typeof item.path === 'string' && samePath(item.path, wanted));

  const first = byPath(withEngine);
  truthy(first, 'кандидаты: зарегистрированный воркспейс с движком присутствует');
  eq(first.version, '2.6.13', 'кандидаты: версия из VERSION');
  eq(first.current, false, 'кандидаты: не текущий');

  const self = byPath(current);
  truthy(self, 'кандидаты: текущий воркспейс присутствует');
  eq(self.version, '2.6.14', 'кандидаты: версия текущего');
  eq(self.current, true, 'кандидаты: current=true у выбранного корня');

  eq(byPath(withoutEngine), undefined, 'кандидаты: воркспейс без движка не попадает');
  eq(byPath(path.join(dir, 'no-such-workspace')), undefined, 'кандидаты: несуществующий путь не попадает');
  for (const item of list) {
    truthy(typeof item.path === 'string' && typeof item.version === 'string' && item.version.trim() !== '',
      'кандидаты: у каждой записи есть path и version');
  }
}

/* --- c4: карточка движка в панели ------------------------------------- */

async function c4() {
  const client = fs.readFileSync(path.join(PKG, 'plugin', 'lib', 'client.js'), 'utf8');
  for (const word of CARD_WORDS) {
    truthy(client.includes(word), 'client.js: нет текста «' + word + '»');
  }
  const tests = fs.readFileSync(path.join(PKG, 'plugin', 'test', 'client.test.mjs'), 'utf8');
  for (const title of CARD_TESTS) {
    truthy(tests.includes(title), 'client.test.mjs: нет теста «' + title + '»');
  }
  const run = runCapture(process.execPath, [path.join(PKG, 'plugin', 'tools', 'test.mjs')], { timeout: 1800000 });
  if (run.status !== 0) {
    throw new Error('тесты панели не зелёные: exit ' + run.status
      + (run.error ? ' (' + run.error.message + ')' : '') + '; ' + tail(run.stdout, 600) + tail(run.stderr, 600));
  }
}

/* --- c5: init --external и --git-init --------------------------------- */

function runInit(args, env) {
  /* Ключ пишется только в --key-out: домашний ~/.wf-keys вне песочницы задания. */
  return runCapture(process.execPath, [path.join(PKG, 'spec', 'scripts', 'init.mjs'), ...args], {
    timeout: 300000,
    env,
  });
}

async function c5() {
  const dir = tempDir('c5-');
  const engineA = engineAt(path.join(dir, 'engine-a'), '2.6.14');
  const mapFile = path.join(dir, 'map', 'engine-roots.json');

  const keyOut = path.join(dir, 'keys');
  const keyArgs = ['--key-id', 'agent-judge', '--key-out', keyOut];

  const wsExternal = workspace(path.join(dir, 'ws-external'));
  let run = runInit(['--repo', wsExternal, '--external', engineA, ...keyArgs], { [ENGINE_ROOTS_ENV]: mapFile });
  eq(run.status, 0, 'init --external: exit (stderr: ' + tail(run.stderr, 400) + ')');
  truthy(fs.existsSync(mapFile), 'init --external: карта создана');
  const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  const linked = mapEntryFor(map, wsExternal);
  truthy(typeof linked === 'string' && samePath(linked, engineA), 'init --external: запись воркспейса');
  truthy(!fs.existsSync(path.join(wsExternal, 'docs', 'subagent-workflow')), 'init --external: движок не разворачивается');

  const wsGit = workspace(path.join(dir, 'ws-git'));
  run = runInit(['--repo', wsGit, '--git-init', ...keyArgs], {});
  eq(run.status, 0, 'init --git-init: exit (stderr: ' + tail(run.stderr, 400) + ')');
  truthy(fs.existsSync(path.join(wsGit, '.git')), 'init --git-init: репозиторий создан');
  truthy(fs.existsSync(path.join(wsGit, 'docs', 'subagent-workflow', 'VERSION')), 'init --git-init: движок развёрнут');

  const wsBroken = workspace(path.join(dir, 'ws-broken'));
  run = runInit(['--repo', wsBroken, '--external', path.join(dir, 'no-engine'), ...keyArgs], { [ENGINE_ROOTS_ENV]: mapFile });
  truthy(run.status !== 0, 'init --external без движка: ненулевой код');
  const after = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  eq(mapEntryFor(after, wsBroken), undefined, 'init --external без движка: карта не тронута');
}

/* --- c6: регресс пакета ----------------------------------------------- */

async function c6() {
  /* Тесты панели — в c4: карточка проверяется поведением, а не чтением. */
  const steps = [
    { label: 'самопроверка правил', file: 'spec/selftest.mjs' },
    { label: 'сквозной цикл', file: 'spec/e2e.mjs' },
    { label: 'развёрнутая копия', file: 'spec/checks/deployed-copy.mjs' },
  ];
  for (const step of steps) {
    const run = runCapture(process.execPath, [path.join(PKG, step.file)]);
    if (run.status !== 0) {
      throw new Error(step.label + ' (' + step.file + '): exit ' + run.status
        + '; ' + tail(run.stdout, 800) + tail(run.stderr, 800));
    }
  }
}

/* --- диспетчер --------------------------------------------------------- */

const cases = { c1, c2, c3, c4, c5, c6 };
const id = String(process.argv[2] || 'all').toLowerCase();
try {
  if (id === 'all') {
    for (const key of ['c1', 'c2', 'c3', 'c4', 'c5']) await cases[key]();
    console.log('ENGINE-LINK OK all');
  } else if (!Object.hasOwn(cases, id)) {
    console.log('ENGINE-LINK FAIL usage: node spec/checks/engine-link.mjs c1..c6|all');
    process.exit(2);
  } else {
    await cases[id]();
    console.log('ENGINE-LINK OK ' + id);
  }
} catch (error) {
  console.log('ENGINE-LINK FAIL ' + id + ': ' + (error && error.message ? error.message : String(error)));
  process.exit(1);
}