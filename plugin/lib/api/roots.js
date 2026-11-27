/*
 * Корни и рантайм: какие пространства видны, как резолвится движок, какой корень выбран.
 *
 * 0180: часть plugin/lib/api.js; публичный вход — plugin/lib/api.js.
 */
import fs from 'node:fs';
import path from 'node:path';
import { TOOL } from '../state.js';
import { PLUGIN_VERSION } from '../compat.js';
import { resolveEngine, engineView } from '../engine-root.js';
import { PLUGIN_NAME, DEFAULT_UPDATE_SOURCE } from './constants.js';
import { sendJson } from './http.js';
export function normalizeUpdateSource(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const apiBase = typeof raw.apiBase === 'string' && raw.apiBase.trim().length > 0
    ? raw.apiBase.trim().replace(/\/+$/u, '')
    : DEFAULT_UPDATE_SOURCE.apiBase;
  const repo = typeof raw.repo === 'string' && raw.repo.trim().length > 0
    ? raw.repo.trim().replace(/^\/+|\/+$/gu, '')
    : DEFAULT_UPDATE_SOURCE.repo;
  return { apiBase, repo };
}

export function samePath(a, b) {
  const left = path.resolve(String(a)).replace(/[\\/]+$/u, '');
  const right = path.resolve(String(b)).replace(/[\\/]+$/u, '');
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

export function normalizeRoots(config) {
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

export function rootsFromRegistry(getter) {
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
export const PROJECT_MARKER = path.join('docs', 'subagent-workflow', 'workflow.config.json');

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
export function allowedRoots(runtime) {
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

export function engineReadRoot(selectionRoot, engine) {
  /* Конфиг профиля и карта — оба внешние: читаем движок, а не воркспейс. */
  return engine && (engine.source === 'mapping' || engine.source === 'config') && engine.root
    ? engine.root
    : selectionRoot;
}

/** Опции резолвера: декларативная связь из runtime.engines. */
export function engineOptions(runtime) {
  const engines = runtime && runtime.engines ? runtime.engines : null;
  return engines ? { config: { engines } } : {};
}

/** Резолв движка для воркспейса с учётом конфига профиля (2.6.14). */
export function resolveRuntimeEngine(runtime, root) {
  return resolveEngine(root, engineOptions(runtime));
}

/**
 * 409 engine-external для POST-маршрутов, если движок подключён снаружи.
 * @returns {boolean} true, если ответ уже отправлен
 */
export function refuseExternalWrite(runtime, res, rootValue) {
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
export function refuseExternalWriteBeforeBody(runtime, res, queryRoot) {
  if (allowedRoots(runtime).length !== 1) return false;
  return refuseExternalWrite(runtime, res, queryRoot);
}

/**
 * 2.6.16 (0042): статус ответа /api/update по результату обновления.
 * Общий для прямого обновления воркспейса и для явного обновления репозитория
 * внешнего движка: коды отказа одни и те же (deploy.js), меняется только цель.
 */
export function updateResponseStatus(report) {
  if (report && report.ok === true) return 200;
  const code = report && report.code;
  if (code === 'tasks-in-progress' || code === 'up-to-date' || code === 'panel-older') return 409;
  if (code === 'not-found') return 404;
  return 400;
}

export function selectRoot(runtime, value) {
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
