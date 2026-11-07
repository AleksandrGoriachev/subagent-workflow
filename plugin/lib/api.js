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
 * it happens only with confirm: true; /api/update (0.8.0) re-runs init --force
 * to move a deployed copy to the bundled version, blocked by tasks without an
 * acceptance record unless allowInProgress is set.
 *
 * 2.6.3 (B4): the writing POST routes (/api/guard, /api/deploy, /api/update)
 * require
 * `Content-Type: application/json` (415 otherwise) and an Origin of this host or
 * no Origin at all (403 otherwise). The checks run before the body is read and
 * before anything is written: a cross-site `text/plain` request — a browser
 * "simple request" with no preflight — cannot flip the guard or start a deploy.
 *
 * 2.6.9 (0034): a workspace without an engine (split-optimizer) may read one
 * from outside by mapping in ~/.dsh/workflow/engine-roots.json (env
 * WF_ENGINE_ROOTS). GET routes then read the mapped repository and /api/status
 * reports engine {installed, root, source}. The three writing POST routes answer
 * 409 engine-external for source 'mapping' — before the body is read when the
 * panel has a single root, and right after it otherwise — so such a workspace is
 * never modified.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
import {
  deployWorkflow,
  updateWorkflowAsync,
  externalEngineRepo,
  availableSpecRoot,
  availableVersion,
  tasksInProgress,
  compareVersions,
} from './deploy.js';
import {
  resolveEngine,
  engineView,
  cleanEnginePath,
  engineVersion,
  hasEngine,
  writeEngineLink,
} from './engine-root.js';
import { prepareEngineSpec } from './release-source.mjs';
import { imperativeView } from './imperative.js';
import {
  PLUGIN_PACKAGE_NAME,
  pluginInstallMode,
  preparePluginTarball,
  installPluginFiles,
} from './plugin-update.mjs';

export const API_PREFIX = '/workflow';
export const PLUGIN_NAME = 'dsh-workflow-console';

/*
 * 2.6.28 (0067): откуда панель берёт движок для обновления из релиза.
 * apiBase/repo можно переопределить в runtime (конфиг профиля, тесты); значения
 * по умолчанию — публичный GitHub и репозиторий движка.
 */
export const DEFAULT_UPDATE_SOURCE = {
  apiBase: 'https://api.github.com',
  repo: 'AleksandrGoriachev/subagent-workflow',
};

function normalizeUpdateSource(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const apiBase = typeof raw.apiBase === 'string' && raw.apiBase.trim().length > 0
    ? raw.apiBase.trim().replace(/\/+$/u, '')
    : DEFAULT_UPDATE_SOURCE.apiBase;
  const repo = typeof raw.repo === 'string' && raw.repo.trim().length > 0
    ? raw.repo.trim().replace(/^\/+|\/+$/gu, '')
    : DEFAULT_UPDATE_SOURCE.repo;
  return { apiBase, repo };
}

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
  /*
   * 2.6.14 (0039): декларативная связь «воркспейс → движок» из конфига
   * профиля. Форма та же, что у карты: engines.roots = { "<воркспейс>": "<движок>" }.
   * Резолвер получает её во всех местах чтения, поэтому источник связи виден
   * и /api/status, и карточке панели.
   */
  const engines = config && typeof config === 'object'
    && config.engines && typeof config.engines === 'object' && !Array.isArray(config.engines)
    ? config.engines
    : null;
  /* 2.6.28 (0067): источник релиза для /api/update с source: "release". */
  const updateSource = normalizeUpdateSource(
    config && typeof config === 'object' && config.updateSource !== undefined
      ? config.updateSource
      : options.updateSource,
  );
  /*
   * 0079 (WC-52): откуда брать пакет плагина. Локальный tarball (config или
   * WF_PLUGIN_UPDATE_FILE) — для офлайна и тестов; иначе — релиз GitHub.
   */
  const pluginUpdateFile = (() => {
    const fromConfig = config && typeof config === 'object' && typeof config.pluginUpdateFile === 'string'
      ? config.pluginUpdateFile.trim()
      : '';
    if (fromConfig !== '') return fromConfig;
    const fromEnv = typeof process.env.WF_PLUGIN_UPDATE_FILE === 'string' ? process.env.WF_PLUGIN_UPDATE_FILE.trim() : '';
    return fromEnv !== '' ? fromEnv : null;
  })();
  return {
    roots,
    engines,
    updateSource,
    pluginUpdateFile,
    /* 0079: каталог установленного пакета; в тестах подменяется на временный. */
    pluginRoot: typeof options.pluginRoot === 'string' && options.pluginRoot.trim() !== ''
      ? path.resolve(options.pluginRoot)
      : null,
    getWorkspaceRegistry,
    defaultRoot: roots.length > 0 ? roots[0] : null,
    /* 0077 (WC-60): сторож докладывает живое состояние в /api/status. */
    guard: typeof options.guard === 'function' ? options.guard : null,
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

/*
 * 2.6.9 (0034): внешний движок.
 *
 * Воркспейс без движка (split-optimizer: только .dsh и structure) читает движок
 * по карте %USERPROFILE%\.dsh\workflow\engine-roots.json (env WF_ENGINE_ROOTS).
 * Чтение идёт из резолвнутого движка, а запись в такой воркспейс запрещена
 * кодом engine-external: сам воркспейс не меняется. Обычный случай — движок в
 * воркспейсе (source 'workspace') или его нет вовсе (source 'none') — работает
 * как раньше.
 */
function engineReadRoot(selectionRoot, engine) {
  /* Конфиг профиля и карта — оба внешние: читаем движок, а не воркспейс. */
  return engine && (engine.source === 'mapping' || engine.source === 'config') && engine.root
    ? engine.root
    : selectionRoot;
}

/** Опции резолвера: декларативная связь из runtime.engines. */
function engineOptions(runtime) {
  const engines = runtime && runtime.engines ? runtime.engines : null;
  return engines ? { config: { engines } } : {};
}

/** Резолв движка для воркспейса с учётом конфига профиля (2.6.14). */
function resolveRuntimeEngine(runtime, root) {
  return resolveEngine(root, engineOptions(runtime));
}

/**
 * 409 engine-external для POST-маршрутов, если движок подключён снаружи.
 * @returns {boolean} true, если ответ уже отправлен
 */
function refuseExternalWrite(runtime, res, rootValue) {
  const target = selectRoot(runtime, rootValue);
  if (!target.root) return false;
  const engine = resolveRuntimeEngine(runtime, target.root);
  /*
   * Внешний движок — тот, что реально подключён снаружи: карта (2.6.9) или
   * конфиг профиля (2.6.14). Битая запись (каталог без движка) сюда не
   * попадает: разворачивать есть куда, это прежнее поведение карты.
   */
  const external = engine.installed === true && (engine.source === 'mapping' || engine.source === 'config');
  if (!external) return false;
  const origin = engine.source === 'config'
    ? 'Движок объявлен конфигом профиля (engines.roots): ' + engine.root
      + '. Развёртывание, обновление и guard выполняются в репозитории движка, а не здесь. '
      + 'Чтобы развернуть движок в этом воркспейсе, уберите engines.roots для него из конфига профиля.'
    : 'Движок подключён картой из ' + engine.root + '. Развёртывание, обновление и guard '
      + 'выполняются в репозитории движка, а не здесь. Карта: ' + engine.rootsFile + '.';
  sendJson(res, 409, {
    error: 'движок внешний: этот воркспейс не меняется',
    code: 'engine-external',
    hint: origin,
    root: target.root,
    engine: engineView(engine),
  });
  return true;
}

/**
 * Отказ до чтения тела. У панели с единственным разрешённым корнем цель
 * запроса — этот корень: ни query, ни тело не могут назвать другой, поэтому
 * 409 можно отдать, не разбирая тело и ничего не сделав. В многокорневой
 * панели корень приходит в теле, и там решение принимает
 * {@link refuseExternalWrite} после чтения.
 *
 * @returns {boolean} true, если ответ уже отправлен
 */
function refuseExternalWriteBeforeBody(runtime, res, queryRoot) {
  if (allowedRoots(runtime).length !== 1) return false;
  return refuseExternalWrite(runtime, res, queryRoot);
}

/**
 * 2.6.16 (0042): статус ответа /api/update по результату обновления.
 * Общий для прямого обновления воркспейса и для явного обновления репозитория
 * внешнего движка: коды отказа одни и те же (deploy.js), меняется только цель.
 */
function updateResponseStatus(report) {
  if (report && report.ok === true) return 200;
  const code = report && report.code;
  if (code === 'tasks-in-progress' || code === 'up-to-date' || code === 'panel-older') return 409;
  if (code === 'not-found') return 404;
  return 400;
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

/**
 * 0077 (WC-60): живое состояние сторожа долгих ожиданий. Считается в apply()
 * плагина; здесь только читается. Ошибка чтения не отменяет статус панели.
 */
function guardPayload(runtime) {
  try {
    return runtime && typeof runtime.guard === 'function' ? runtime.guard() : null;
  } catch (error) {
    return { error: error && typeof error.message === 'string' ? error.message : String(error) };
  }
}

function repoInfoPayload(info) {
  const policy = policyView(info.config, { root: info.root, configPath: info.configPath });
  return {
    root: info.root,
    /* 0.8.0: обновление движка — версия сборки и задания без приёмки. */
    availableVersion: availableVersion(),
    tasksInProgress: tasksInProgress(info.root),
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
      const postRoutes = rel === '/api/run' || rel === '/api/guard'
        || rel === '/api/deploy' || rel === '/api/update' || rel === '/api/engine-link'
        || rel === '/api/plugin-update';
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
        /*
         * 2.6.9: движок резолвится до чтения. source 'mapping' значит, что
         * воркспейс не меняется: файлы читаются из внешнего репозитория.
         */
        const engine = resolveRuntimeEngine(runtime, selection.root);
        if (!selection.root) {
          sendJson(res, 200, {
            plugin: runtime.plugin,
            guard: guardPayload(runtime),
            roots,
            root: null,
            rootConfigured: false,
            availableVersion: availableVersion(),
            engine: engineView(engine),
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
            availableVersion: availableVersion(),
            engine: engineView(engine),
            repo: null,
            error: 'корень не найден: ' + selection.root,
          });
          return;
        }
        const info = readRepoInfo(engineReadRoot(selection.root, engine));
        sendJson(res, 200, {
          plugin: runtime.plugin,
          guard: guardPayload(runtime),
          roots,
          root: selection.root,
          rootConfigured,
          availableVersion: availableVersion(),
          /* 2.6.9: движок в воркспейсе, снаружи (карта) или его нет. */
          engine: engineView(engine),
          /* Проекты внутри пространства, где workflow развёрнут. */
          projects: discoverNestedProjects(allowedRoots(runtime)),
          repo: repoInfoPayload(info),
          error: null,
        });
        return;
      }

      if (rel === '/api/engine/candidates') {
        /*
         * 2.6.14 (0039): воркспейсы, где движок реально есть, — список для
         * «Подключить существующий». Воркспейс без движка и несуществующий
         * путь не попадают: выбирать для связи нечего.
         */
        const currentRoot = selection.root;
        const candidates = [];
        for (const candidate of allowedRoots(runtime)) {
          if (!fs.existsSync(candidate)) continue;
          const engine = resolveRuntimeEngine(runtime, candidate);
          if (engine.installed !== true) continue;
          const version = engine.version || engineVersion(engine.root);
          if (typeof version !== 'string' || version.trim().length === 0) continue;
          candidates.push({
            path: candidate,
            engineRoot: engine.root,
            version: version.trim(),
            mode: engine.mode,
            source: engine.source,
            current: Boolean(currentRoot && samePath(candidate, currentRoot)),
          });
        }
        sendJson(res, 200, { plugin: runtime.plugin, root: currentRoot, candidates });
        return;
      }

      if (rel === '/api/engine-link') {
        /*
         * 2.6.14 (0039): третья запись панели — связь в карте движков. Те же
         * проверки типа и Origin, что у /api/guard, и только по подтверждению.
         * Конфиг профиля сильнее кнопки: связь из config.engines.roots не
         * подменяется (409 engine-config), карта не меняется.
         */
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
        if (body.confirm !== true) {
          sendJson(res, 400, { error: 'связь с движком требует confirm: true', code: 'confirm-required' });
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
        const declared = resolveRuntimeEngine(runtime, target.root);
        if (declared.source === 'config') {
          sendJson(res, 409, {
            error: 'связь задана конфигом профиля: кнопка её не подменяет',
            code: 'engine-config',
            hint: 'Движок для этого воркспейса объявлен в config.engines.roots ('
              + (declared.root || declared.mapped || 'путь неизвестен') + '). '
              + 'Уберите запись из конфига профиля, если движок должен выбираться в панели.',
            root: target.root,
            engine: engineView(declared),
          });
          return;
        }
        const engineRoot = cleanEnginePath(body.engine);
        if (engineRoot === null) {
          sendJson(res, 400, { error: 'движок должен быть абсолютным путём: ' + String(body.engine) });
          return;
        }
        if (!hasEngine(engineRoot)) {
          sendJson(res, 400, {
            error: 'в каталоге нет движка: ' + engineRoot,
            code: 'not-an-engine',
            hint: 'Движок — это docs/subagent-workflow/VERSION. Разверните движок в том каталоге или выберите другой.',
          });
          return;
        }
        const written = writeEngineLink(target.root, engineRoot);
        if (written.ok !== true) {
          sendJson(res, 500, { error: written.error || 'не удалось записать карту движков', code: written.code || 'map-write-failed' });
          return;
        }
        const linked = resolveRuntimeEngine(runtime, target.root);
        sendJson(res, 200, {
          ok: true,
          plugin: runtime.plugin,
          root: target.root,
          engine: engineView(linked),
          mapFile: written.file,
          note: 'записана только карта движков: воркспейс не изменён',
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
        const engine = resolveRuntimeEngine(runtime, target.root);
        const info = readRepoInfo(engineReadRoot(target.root, engine));
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
        /* 2.6.9: внешний движок — отказ до чтения тела. */
        if (refuseExternalWriteBeforeBody(runtime, res, url.searchParams.get('root'))) return;
        let body;
        try {
          body = await readJsonBody(req);
        } catch (error) {
          sendJson(res, 400, { error: error && error.message ? error.message : 'некорректное тело запроса' });
          return;
        }
        /* 2.6.9: внешний движок — запись запрещена до любых действий. */
        if (refuseExternalWrite(runtime, res, body.root)) return;
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
        /* 2.6.9: внешний движок — отказ до чтения тела. */
        if (refuseExternalWriteBeforeBody(runtime, res, url.searchParams.get('root'))) return;
        let body;
        try {
          body = await readJsonBody(req);
        } catch (error) {
          sendJson(res, 400, { error: error && error.message ? error.message : 'некорректное тело запроса' });
          return;
        }
        /*
         * 2.6.9: воркспейс с внешним движком не разворачивается — он не
         * меняется. Отказ приходит раньше confirm: это свойство воркспейса, а
         * не отсутствие подтверждения.
         */
        if (refuseExternalWrite(runtime, res, body.root)) return;
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
        /*
         * 2.6.14 (0039): «Развернуть здесь» на не-git воркспейсе сначала делает
         * git init — иначе ворота не работают, а пользователь видит только
         * отказ git. Без initGit: true поведение прежнее (not-a-repo).
         */
        const report = deployWorkflow(target.root, {
          specRoot: availableSpecRoot(),
          initGit: body.initGit === true,
        });
        sendJson(res, report.ok ? 200 : 400, { plugin: runtime.plugin, root: target.root, ...report });
        return;
      }

      if (rel === '/api/update') {
        /* 2.6.5: тип и Origin — до тела и до записи; confirm обязателен. */
        const problem = writeRequestProblem(req);
        if (problem) {
          sendJson(res, problem.status, { error: problem.error });
          return;
        }
        /*
         * 2.6.16 (0042): тело читается до решения о внешнем движке. Явный
         * target: 'engine-repo' отличает «обнови репозиторий движка» от
         * «обнови этот воркспейс», и различить их до чтения тела нельзя.
         * Отказ engine-external для воркспейса остаётся: он выдаётся ниже, как
         * только видно, что target не engine-repo.
         */
        let body;
        try {
          body = await readJsonBody(req);
        } catch (error) {
          sendJson(res, 400, { error: error && error.message ? error.message : 'некорректное тело запроса' });
          return;
        }
        if (body.target === 'engine-repo') {
          /*
           * 0042: обновление РЕПОЗИТОРИЯ ДВИЖКА, а не воркспейса. Воркспейс не
           * меняется, поэтому 409 engine-external здесь неуместен: запись идёт
           * туда, откуда читается движок. Подтверждение и разрешённый корень
           * проверяются как у остальных записей панели.
           */
          if (body.confirm !== true) {
            sendJson(res, 400, {
              error: 'обновление движка в репозитории требует confirm: true',
              code: 'confirm-required',
            });
            return;
          }
          const selected = selectRoot(runtime, body.root);
          if (!selected.root) {
            sendJson(res, 400, { error: selected.error });
            return;
          }
          if (!fs.existsSync(selected.root)) {
            sendJson(res, 404, { error: 'корень не найден: ' + selected.root });
            return;
          }
          const engine = resolveRuntimeEngine(runtime, selected.root);
          const engineTarget = externalEngineRepo(engine);
          if (engineTarget.ok !== true) {
            sendJson(res, 400, {
              error: engineTarget.error,
              code: engineTarget.code || 'engine-not-external',
              hint: engineTarget.hint,
              root: selected.root,
              engine: engineView(engine),
            });
            return;
          }
          /*
           * Запись — тем же механизмом, что и прямое обновление: init --force
           * из вложенной спеки в репозитории движка. Своей копии init здесь нет.
           */
          const report = await updateWorkflowAsync(engineTarget.repo, {
            specRoot: availableSpecRoot(),
            allowInProgress: body.allowInProgress === true,
          });
          sendJson(res, updateResponseStatus(report), {
            plugin: runtime.plugin,
            root: selected.root,
            engineRepo: engineTarget.repo,
            ...report,
          });
          return;
        }
        /* 2.6.9: внешний движок — обновление в этом воркспейсе запрещено. */
        if (refuseExternalWrite(runtime, res, body.root)) return;
        if (body.confirm !== true) {
          sendJson(res, 400, { error: 'обновление требует confirm: true' });
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
         * 2.6.28 (0067): body.source === "release" — движок скачивается из
         * последнего релиза GitHub, а не из сборки панели. Скачивание и сверка
         * sha256 идут до любых записей: сеть/подпись упали — 502
         * release-unavailable, воркспейс не изменён. Временный каталог
         * удаляется в finally и на успехе, и на отказе init.
         */
        if (body.source === 'release') {
          const source = runtime.updateSource || DEFAULT_UPDATE_SOURCE;
          let spec;
          try {
            spec = await prepareEngineSpec({ apiBase: source.apiBase, repo: source.repo });
          } catch (error) {
            sendJson(res, 502, {
              code: 'release-unavailable',
              error: 'не удалось получить движок из релиза: '
                + (error && error.message ? error.message : String(error)),
            });
            return;
          }
          try {
            const report = await updateWorkflowAsync(target.root, {
              specRoot: spec.specRoot,
              allowInProgress: body.allowInProgress === true,
              initGit: body.initGit === true,
            });
            sendJson(res, updateResponseStatus(report), {
              plugin: runtime.plugin,
              root: target.root,
              ...report,
              source: 'release',
              targetVersion: spec.version,
            });
          } finally {
            try {
              await spec.cleanup();
            } catch {
              /* временный каталог уберёт ОС; обновление уже выполнено или отклонено */
            }
          }
          return;
        }
        /*
         * Обновление выполняет асинхронный init (updateWorkflowAsync): пока он
         * идёт, event loop свободен и остальные маршруты панели отвечают.
         * allowInProgress — отдельное поле, а не часть confirm: «понимаю риск»
         * пользователь ставит только после списка незавершённых заданий.
         */
        const report = await updateWorkflowAsync(target.root, {
          specRoot: availableSpecRoot(),
          allowInProgress: body.allowInProgress === true,
          initGit: body.initGit === true,
        });
        sendJson(res, updateResponseStatus(report), { plugin: runtime.plugin, root: target.root, ...report });
        return;
      }

      /*
       * 0079 (WC-52): обновление самого плагина из релиза. Заменяет каталог
       * пакета в профиле, прежний сохраняет рядом как .dsh-plugin-backup-*.
       * Для link/junction-установок отказ: код принадлежит рабочему дереву.
       */
      if (rel === '/api/plugin-update') {
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
        if (body.confirm !== true) {
          sendJson(res, 400, {
            error: 'обновление плагина требует confirm: true',
            code: 'confirm-required',
          });
          return;
        }
        const packageRoot = runtime.pluginRoot || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
        const mode = pluginInstallMode(packageRoot);
        if (mode.mode !== 'dir') {
          sendJson(res, 409, {
            ok: false,
            code: 'plugin-dev-install',
            mode: mode.mode,
            error: mode.hint || 'плагин установлен ссылкой: обновление пакетом недоступно',
            hint: mode.hint || null,
          });
          return;
        }
        let prepared;
        try {
          prepared = await preparePluginTarball({
            apiBase: runtime.updateSource ? runtime.updateSource.apiBase : undefined,
            repo: runtime.updateSource ? runtime.updateSource.repo : undefined,
            file: runtime.pluginUpdateFile || undefined,
          });
        } catch (error) {
          sendJson(res, 502, {
            ok: false,
            code: 'plugin-release-unavailable',
            error: 'не удалось получить пакет плагина из релиза: '
              + (error && error.message ? error.message : String(error)),
          });
          return;
        }
        if (compareVersions(prepared.version, PLUGIN_VERSION) <= 0) {
          sendJson(res, 409, {
            ok: false,
            code: 'plugin-up-to-date',
            current: PLUGIN_VERSION,
            version: prepared.version,
          });
          return;
        }
        let installed;
        try {
          installed = installPluginFiles({
            files: prepared.files,
            packageRoot,
            version: prepared.version,
            force: body.force === true,
          });
        } catch (error) {
          /* 0089 (WC-63): каталог плагина — рабочее дерево: пакетом не обновляем. */
          if (error && error.code === 'plugin-dev-tree') {
            sendJson(res, 409, {
              ok: false,
              code: 'plugin-dev-install',
              error: error.message,
              hint: 'обновите код в репозитории (git pull) и перезапустите DSH',
            });
            return;
          }
          sendJson(res, 500, {
            ok: false,
            code: 'plugin-install-failed',
            error: 'установка пакета не удалась: '
              + (error && error.message ? error.message : String(error)),
          });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          plugin: runtime.plugin,
          from: PLUGIN_VERSION,
          to: prepared.version,
          backup: installed.backupName,
          restartRequired: true,
        });
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
        const engine = resolveRuntimeEngine(runtime, selection.root);
        const board = readRepository(engineReadRoot(selection.root, engine));
        sendJson(res, 200, { plugin: runtime.plugin, engine: engineView(engine), ...board });
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
        const engine = resolveRuntimeEngine(runtime, selection.root);
        const readRoot = engineReadRoot(selection.root, engine);
        const info = readRepoInfo(readRoot);
        const guard = readGuard(readRoot);
        sendJson(res, 200, {
          plugin: runtime.plugin,
          root: info.root,
          configPath: info.configPath,
          ...policyView(info.config, { root: info.root, configPath: info.configPath }),
          /* 0081 (WC-56, S4): императив одним взглядом — версия, enforcement, ожидания, отказы. */
          imperative: imperativeView({
            root: info.root,
            readRoot,
            config: info.config,
            engine: engineView(engine),
          }),
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
        const engine = resolveRuntimeEngine(runtime, selection.root);
        const board = readRepository(engineReadRoot(selection.root, engine));
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
          engine: engineView(engine),
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
        const engine = resolveRuntimeEngine(runtime, selection.root);
        const card = readTask(engineReadRoot(selection.root, engine), id);
        if (card && card.error) {
          sendJson(res, card.status || 404, { error: card.error });
          return;
        }
        sendJson(res, 200, {
          plugin: runtime.plugin,
          root: selection.root,
          engine: engineView(engine),
          task: card,
        });
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
