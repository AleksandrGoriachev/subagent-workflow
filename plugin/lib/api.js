/**
 * HTTP half: loopback-only routes for the panel.
 *
 * The handler is a pure wiring function (mock request/response objects work in
 * tests) so the routes can be exercised without a DSH host. Read routes are GET
 * and go through state.js. POST routes are the three explicit exceptions:
 * /api/run runs one of the package's read-only gates and returns its log (never
 * writes, signs or accepts); /api/guard flips guard.enabled in
 * workflow.config.json (logged to guard.log); /api/deploy runs the bundled
 * spec's init.mjs in the selected root — the panel's second explicit write, and
 * it happens only with confirm: true.
 *
 * 2.6.3 (B4): both writing POST routes (/api/guard, /api/deploy) require
 * `Content-Type: application/json` (415 otherwise) and an Origin of this host or
 * no Origin at all (403 otherwise). The checks run before the body is read and
 * before anything is written: a cross-site `text/plain` request — a browser
 * "simple request" with no preflight — cannot flip the guard or start a deploy.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  readRepoInfo,
  readRepository,
  readTask,
  policyView,
  TOOL,
} from './state.js';
import { compatView, PLUGIN_VERSION } from './compat.js';
import { buildCheck, runCheck, CHECK_IDS, CHECK_TITLES } from './checks.js';
import { writeGuardEnabled, readGuard, GUARD_CONFIG_REL } from './guard.js';
import { deployWorkflow, availableSpecRoot } from './deploy.js';

export const API_PREFIX = '/workflow';
export const PLUGIN_NAME = 'dsh-workflow-console';

function samePath(a, b) {
  const left = path.resolve(String(a)).replace(/[\\/]+$/u, '');
  const right = path.resolve(String(b)).replace(/[\\/]+$/u, '');
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function normalizeRoots(config) {
  const raw = [];
  if (Array.isArray(config.roots)) {
    for (const item of config.roots) if (typeof item === 'string' && item.trim()) raw.push(item.trim());
  }
  if (typeof config.root === 'string' && config.root.trim()) raw.push(config.root.trim());
  const roots = [];
  for (const item of raw) {
    if (!path.isAbsolute(item)) continue;
    const resolved = path.resolve(item);
    if (!roots.some((existing) => samePath(existing, resolved))) roots.push(resolved);
  }
  return roots;
}

function rootsFromRegistry(getter) {
  if (typeof getter !== 'function') return [];
  try {
    const registry = getter();
    if (!registry || typeof registry.list !== 'function') return [];
    const roots = [];
    for (const workspace of registry.list()) {
      const value = workspace && workspace.path;
      if (typeof value !== 'string' || !path.isAbsolute(value)) continue;
      const resolved = path.resolve(value);
      if (!roots.some((existing) => samePath(existing, resolved))) roots.push(resolved);
    }
    return roots;
  } catch {
    return [];
  }
}

/**
 * Build the static runtime of the plugin: configured roots and the plugin
 * identity shown in the panel header.
 */
export function createWorkflowRuntime(config = {}, options = {}) {
  const getWorkspaceRegistry = typeof options.getWorkspaceRegistry === 'function'
    ? options.getWorkspaceRegistry
    : null;
  let roots = normalizeRoots(config || {});
  if (roots.length === 0) roots = rootsFromRegistry(getWorkspaceRegistry);
  return {
    roots,
    getWorkspaceRegistry,
    defaultRoot: roots.length > 0 ? roots[0] : null,
    plugin: { name: PLUGIN_NAME, version: PLUGIN_VERSION, tool: TOOL },
  };
}

/** Маркер развёрнутого workflow внутри проекта. */
const PROJECT_MARKER = path.join('docs', 'subagent-workflow', 'workflow.config.json');

/**
 * Проекты прямо внутри корня, где workflow развёрнут.
 *
 * Панель должна показать проект своего пространства, даже если он не прописан в
 * roots профиля.
 */
export function discoverNestedProjects(roots) {
  const found = [];
  for (const root of roots) {
    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const candidate = path.join(root, entry.name);
      let deployed = false;
      try {
        deployed = fs.existsSync(path.join(candidate, PROJECT_MARKER));
      } catch {
        deployed = false;
      }
      if (!deployed) continue;
      if (found.some((item) => samePath(item.path, candidate))) continue;
      found.push({ path: candidate, name: entry.name });
    }
  }
  return found;
}

/** Configured roots plus every registered workspace (read-only, validated). */
function allowedRoots(runtime) {
  const list = [...runtime.roots];
  for (const candidate of rootsFromRegistry(runtime.getWorkspaceRegistry)) {
    if (!list.some((root) => samePath(root, candidate))) list.push(candidate);
  }
  /* Проекты своего пространства разрешаем читать наравне с настроенными корнями. */
  for (const project of discoverNestedProjects(list)) {
    if (!list.some((root) => samePath(root, project.path))) list.push(project.path);
  }
  return list;
}

function isLoopback(req) {
  const address = req.socket && req.socket.remoteAddress;
  if (address === undefined || address === null || address.length === 0) return true;
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

/*
 * 2.6.3 (B4): защита изменяющих POST-маршрутов.
 *
 * Content-Type обязателен и только application/json: text/plain — «простой
 * запрос» браузера, он уходит с чужой страницы без preflight, и сервер не
 * должен разбирать такое тело как команду. Origin: отсутствие допустимо (curl,
 * старое same-origin поведение), а чужой Origin отвергается. Проверки стоят до
 * чтения тела и любых записей.
 */
const LOOPBACK_ORIGIN_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function isJsonRequest(req) {
  const headers = req && req.headers ? req.headers : {};
  const raw = headers['content-type'];
  if (typeof raw !== 'string') return false;
  return raw.split(';')[0].trim().toLowerCase() === 'application/json';
}

function originAllowed(req) {
  const headers = req && req.headers ? req.headers : {};
  const raw = headers.origin;
  if (raw === undefined || raw === null || String(raw).trim() === '') return true;
  let origin;
  try {
    origin = new URL(String(raw));
  } catch {
    return false;
  }
  if (origin.protocol !== 'http:' && origin.protocol !== 'https:') return false;
  const host = typeof headers.host === 'string' ? headers.host.trim().toLowerCase() : '';
  if (host.length > 0) return origin.host.toLowerCase() === host;
  /*
   * Заголовка Host нет только у прямого вызова обработчика (тесты) и у
   * нестандартных прокси: там сверять не с чем, поэтому разрешаем loopback-
   * источник — панель всегда открыта на 127.0.0.1/localhost.
   */
  return LOOPBACK_ORIGIN_HOSTS.has(origin.hostname);
}

/** @returns {{status: number, error: string}|null} */
function writeRequestProblem(req) {
  if (!isJsonRequest(req)) {
    return { status: 415, error: 'Content-Type должен быть application/json' };
  }
  if (!originAllowed(req)) {
    return { status: 403, error: 'Origin не совпадает с хостом панели' };
  }
  return null;
}

/** Read a small JSON body; the only POST route takes one. */
function readJsonBody(req, limit = 8192) {
  return new Promise((resolve, reject) => {
    if (!req || typeof req.on !== 'function') {
      resolve({});
      return;
    }
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('тело запроса слишком большое'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (text.trim().length === 0) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(text);
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch {
        reject(new Error('тело запроса не JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value, null, 2);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

function selectRoot(runtime, value) {
  const wanted = typeof value === 'string' ? value.trim() : '';
  if (wanted.length === 0) {
    if (!runtime.defaultRoot) return { root: null, error: 'корень не настроен: добавьте roots в cordis.patch.yml' };
    return { root: runtime.defaultRoot, error: null };
  }
  if (!path.isAbsolute(wanted)) return { root: null, error: 'root должен быть абсолютным путём' };
  const match = allowedRoots(runtime).find((candidate) => samePath(candidate, wanted));
  if (!match) return { root: null, error: 'root не входит в разрешённые корни (настройки профиля или workspace)' };
  return { root: match, error: null };
}

function repoInfoPayload(info) {
  const policy = policyView(info.config, { root: info.root, configPath: info.configPath });
  return {
    root: info.root,
    tasksDir: info.tasksDir,
    configPath: info.configPath,
    configLoaded: info.configLoaded,
    packageVersion: info.packageVersion,
    specVersion: info.specVersion,
    versionSource: info.versionSource,
    head: info.head,
    workflow: info.workflow,
    policy,
    compat: compatView({
      pluginVersion: PLUGIN_VERSION,
      packageVersion: info.packageVersion,
      specVersion: info.specVersion,
      versionSource: info.versionSource,
      workflow: info.workflow,
      config: info.config,
      tasks: [],
    }),
  };
}

/**
 * Create the request handler. \`runtime\` is the object returned by
 * {@link createWorkflowRuntime}; tests pass the same object.
 */
export function createWebHandler(runtime) {
  return async (req, res) => {
    try {
      const method = String(req.method || 'GET').toUpperCase();
      const url = new URL(String(req.url || '/'), 'http://localhost');
      const pathname = url.pathname;
      if (pathname !== API_PREFIX && !pathname.startsWith(API_PREFIX + '/')) {
        sendJson(res, 404, { error: 'Not found' });
        return;
      }
      if (!isLoopback(req)) {
        sendJson(res, 403, { error: 'This endpoint is available on loopback only.' });
        return;
      }
      const rel = pathname.slice(API_PREFIX.length) || '/';
      const postRoutes = rel === '/api/run' || rel === '/api/guard' || rel === '/api/deploy';
      if (postRoutes ? method !== 'POST' : method !== 'GET') {
        res.setHeader('Allow', postRoutes ? 'POST' : 'GET');
        sendJson(res, 405, { error: 'Method ' + method + ' is not allowed.' });
        return;
      }

      const selection = selectRoot(runtime, url.searchParams.get('root'));
      if (rel === '/api/status') {
        const roots = runtime.roots.map((root) => ({ path: root, exists: fs.existsSync(root) }));
        const rootConfigured = selection.root !== null
          && runtime.roots.some((root) => samePath(root, selection.root));
        if (!selection.root) {
          sendJson(res, 200, {
            plugin: runtime.plugin,
            roots,
            root: null,
            rootConfigured: false,
            repo: null,
            error: selection.error,
          });
          return;
        }
        if (!fs.existsSync(selection.root)) {
          sendJson(res, 200, {
            plugin: runtime.plugin,
            roots,
            root: selection.root,
            rootConfigured,
            repo: null,
            error: 'корень не найден: ' + selection.root,
          });
          return;
        }
        const info = readRepoInfo(selection.root);
        sendJson(res, 200, {
          plugin: runtime.plugin,
          roots,
          root: selection.root,
          rootConfigured,
          /* Проекты внутри пространства, где workflow развёрнут. */
          projects: discoverNestedProjects(allowedRoots(runtime)),
          repo: repoInfoPayload(info),
          error: null,
        });
        return;
      }

      if (rel === '/api/checks') {
        sendJson(res, 200, {
          plugin: runtime.plugin,
          checks: CHECK_IDS.map((id) => ({
            id,
            title: CHECK_TITLES[id],
            scope: id === 'doctor' ? 'repo' : 'task',
            writeFree: true,
          })),
        });
        return;
      }

      if (rel === '/api/run') {
        let body;
        try {
          body = await readJsonBody(req);
        } catch (error) {
          sendJson(res, 400, { error: error && error.message ? error.message : 'некорректное тело запроса' });
          return;
        }
        const target = selectRoot(runtime, body.root);
        if (!target.root) {
          sendJson(res, 400, { error: target.error });
          return;
        }
        if (!fs.existsSync(target.root)) {
          sendJson(res, 404, { error: 'корень не найден: ' + target.root });
          return;
        }
        const info = readRepoInfo(target.root);
        let spec;
        try {
          spec = buildCheck(body.check, {
            root: info.root,
            tasksDir: info.tasksDir,
            task: body.task,
            keysFile: info.config && info.config.keysFile,
          });
        } catch (error) {
          sendJson(res, 400, { error: error && error.message ? error.message : String(error) });
          return;
        }
        const result = await runCheck(spec, { timeoutMs: body.timeoutMs });
        sendJson(res, 200, {
          plugin: runtime.plugin,
          root: info.root,
          task: body.task ? String(body.task) : null,
          ...result,
        });
        return;
      }

      if (rel === '/api/guard') {
        /* 2.6.3 (B4): тип и Origin — до тела и до записи. */
        const problem = writeRequestProblem(req);
        if (problem) {
          sendJson(res, problem.status, { error: problem.error });
          return;
        }
        let body;
        try {
          body = await readJsonBody(req);
        } catch (error) {
          sendJson(res, 400, { error: error && error.message ? error.message : 'некорректное тело запроса' });
          return;
        }
        /*
         * Единственная запись панели: флаг guard.enabled для выбранного
         * пространства плюс строка в guard.log. Ничего другого здесь не
         * пишется — иначе панель стала бы вторым редактором конфигурации.
         */
        if (typeof body.enabled !== 'boolean') {
          sendJson(res, 400, { error: 'enabled должен быть true или false' });
          return;
        }
        const target = selectRoot(runtime, body.root);
        if (!target.root) {
          sendJson(res, 400, { error: target.error });
          return;
        }
        if (!fs.existsSync(target.root)) {
          sendJson(res, 404, { error: 'корень не найден: ' + target.root });
          return;
        }
        if (!fs.existsSync(path.join(target.root, GUARD_CONFIG_REL))) {
          sendJson(res, 400, { error: 'workflow не развёрнут: нет ' + GUARD_CONFIG_REL });
          return;
        }
        const report = writeGuardEnabled(target.root, body.enabled);
        sendJson(res, 200, {
          plugin: runtime.plugin,
          root: report.root,
          enabled: report.guard.enabled,
          previous: report.previous,
          changed: report.changed,
          actor: report.actor,
          loggedAt: report.loggedAt,
          configPath: report.configPath,
          logPath: report.logPath,
          note: 'записан только guard.enabled; включение и выключение отмечены в guard.log',
        });
        return;
      }

      if (rel === '/api/deploy') {
        /* 2.6.3 (B4): тип и Origin — до тела и до записи. */
        const problem = writeRequestProblem(req);
        if (problem) {
          sendJson(res, problem.status, { error: problem.error });
          return;
        }
        let body;
        try {
          body = await readJsonBody(req);
        } catch (error) {
          sendJson(res, 400, { error: error && error.message ? error.message : 'некорректное тело запроса' });
          return;
        }
        /*
         * Развёртывание — вторая запись панели, и она возможна только по явной
         * команде: без confirm: true ничего не пишется. Корень проходит через
         * selectRoot, поэтому «разверни в C:\чужой-проект» из тела запроса не
         * проходит: источник корня — открытое пространство, а не клиент.
         */
        if (body.confirm !== true) {
          sendJson(res, 400, { error: 'развёртывание требует confirm: true' });
          return;
        }
        const target = selectRoot(runtime, body.root);
        if (!target.root) {
          sendJson(res, 400, { error: target.error });
          return;
        }
        if (!fs.existsSync(target.root)) {
          sendJson(res, 404, { error: 'корень не найден: ' + target.root });
          return;
        }
        /*
         * Спека — из tarball (vendor/spec), в dev-копии плагина — соседняя spec/
         * пакета. Ни сети, ни скачивания: версия движка равна версии сборки.
         */
        const report = deployWorkflow(target.root, { specRoot: availableSpecRoot() });
        sendJson(res, report.ok ? 200 : 400, { plugin: runtime.plugin, root: target.root, ...report });
        return;
      }

      if (rel === '/api/tasks') {
        if (!selection.root) {
          sendJson(res, 400, { error: selection.error });
          return;
        }
        if (!fs.existsSync(selection.root)) {
          sendJson(res, 404, { error: 'корень не найден: ' + selection.root });
          return;
        }
        const board = readRepository(selection.root);
        sendJson(res, 200, { plugin: runtime.plugin, ...board });
        return;
      }

      if (rel === '/api/policy') {
        if (!selection.root) {
          sendJson(res, 400, { error: selection.error });
          return;
        }
        if (!fs.existsSync(selection.root)) {
          sendJson(res, 404, { error: 'корень не найден: ' + selection.root });
          return;
        }
        const info = readRepoInfo(selection.root);
        const guard = readGuard(selection.root);
        sendJson(res, 200, {
          plugin: runtime.plugin,
          root: info.root,
          configPath: info.configPath,
          ...policyView(info.config, { root: info.root, configPath: info.configPath }),
          /* guard — настройка ворот, а не политика: панель только показывает и переключает флаг. */
          guard: {
            enabled: guard.enabled,
            mode: guard.mode,
            allow: guard.allow,
            bypassMarker: guard.bypassMarker,
            logPath: guard.logPath,
          },
        });
        return;
      }

      if (rel === '/api/compat') {
        if (!selection.root) {
          sendJson(res, 400, { error: selection.error });
          return;
        }
        if (!fs.existsSync(selection.root)) {
          sendJson(res, 404, { error: 'корень не найден: ' + selection.root });
          return;
        }
        const board = readRepository(selection.root);
        const compat = compatView({
          pluginVersion: PLUGIN_VERSION,
          packageVersion: board.packageVersion,
          specVersion: board.specVersion,
          versionSource: board.versionSource,
          workflow: board.workflow,
          config: board.config,
          tasks: board.tasks,
        });
        sendJson(res, 200, {
          plugin: runtime.plugin,
          root: board.root,
          configPath: board.configPath,
          ...compat,
        });
        return;
      }

      if (rel.startsWith('/api/task/')) {
        if (!selection.root) {
          sendJson(res, 400, { error: selection.error });
          return;
        }
        if (!fs.existsSync(selection.root)) {
          sendJson(res, 404, { error: 'корень не найден: ' + selection.root });
          return;
        }
        let id;
        try {
          id = decodeURIComponent(rel.slice('/api/task/'.length).replace(/\/+$/u, ''));
        } catch {
          sendJson(res, 400, { error: 'некорректный id задачи' });
          return;
        }
        if (!id || id.includes('/') || id.includes('\\') || id === '.' || id === '..') {
          sendJson(res, 400, { error: 'некорректный id задачи' });
          return;
        }
        const card = readTask(selection.root, id);
        if (card && card.error) {
          sendJson(res, card.status || 404, { error: card.error });
          return;
        }
        sendJson(res, 200, { plugin: runtime.plugin, root: selection.root, task: card });
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (error) {
      if (res.writableEnded !== true) {
        sendJson(res, 500, { error: error && error.message ? error.message : 'Internal server error' });
      }
    }
  };
}

function warn(ctx, message) {
  try {
    ctx.logger.warn(message);
  } catch {
    console.warn('[dsh-workflow-console] ' + message);
  }
}

/** Register the prefix route on the DSH web server for the plugin fiber. */
export function registerWorkflowWeb(ctx, runtime) {
  const handler = createWebHandler(runtime);
  const route = { kind: 'prefix', path: API_PREFIX, handler };
  try {
    ctx.effect(() => ctx.webServer.register(route));
  } catch (error) {
    warn(ctx, 'Web routes at "' + API_PREFIX + '" were not registered: ' + (error && error.message ? error.message : String(error)));
  }
}
