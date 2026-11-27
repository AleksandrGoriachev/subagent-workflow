/*
 * Статус, доска, карточка, политика, совместимость, метрики.
 *
 * 0187: часть маршрутизатора plugin/lib/api/router.js; вход — router.js.
 */
import fs from 'node:fs';
import path from 'node:path';
import { readRepoInfo, readRepository, readTask, policyView } from '../../state.js';
import { compatView, PLUGIN_VERSION } from '../../compat.js';
import { readGuard } from '../../guard.js';
import { availableVersion } from '../../deploy.js';
import { engineView, readDeployNotice } from '../../engine-root.js';
import { readCachedRelease } from '../../release-check.mjs';
import { imperativeView } from '../../imperative.js';
import { samePath, discoverNestedProjects, allowedRoots, engineReadRoot, resolveRuntimeEngine } from '../roots.js';
import { sendJson } from '../http.js';
import { guardPayload, repoInfoPayload } from '../payloads.js';

export async function metrics(ctx) {
  const { runtime, selection, url, req, res, rel } = ctx;
  const root = selection.root;
  if (!root) {
    sendJson(res, 400, { error: selection.error || 'root required' });
    return;
  }
  const file = path.join(root, '.dsh', 'workflow', 'metrics.json');
  let snapshot = null;
  let error = null;
  try {
    snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    error = 'снимок метрик не опубликован: node tools/launch-metrics.mjs --publish "' + root + '"';
  }
  sendJson(res, 200, { root, snapshot, error, file });
  return;
}

export async function status(ctx) {
  const { runtime, selection, url, req, res, rel } = ctx;
  const roots = runtime.roots.map((root) => ({ path: root, exists: fs.existsSync(root) }));
  const rootConfigured = selection.root !== null
    && runtime.roots.some((root) => samePath(root, selection.root));
  /*
   * 2.6.9: движок резолвится до чтения. source 'mapping' значит, что
   * воркспейс не меняется: файлы читаются из внешнего репозитория.
   */
  const engine = resolveRuntimeEngine(runtime, selection.root);
  /*
   * 0151: отметка развёртывания из воркспейса. Показывается строкой
   * состояния: политика (gitignore|vendored), что стало машинным и что
   * делать клону. Нет файла или он битый — просто нет отметки.
   */
  const deployNotice = selection.root ? readDeployNotice(selection.root) : null;
  if (!selection.root) {
    sendJson(res, 200, {
      plugin: runtime.plugin,
      guard: guardPayload(runtime),
      roots,
      root: null,
      rootConfigured: false,
      availableVersion: availableVersion(),
      /* 0102: последняя удачная проверка релиза из кэша, без сети на загрузке. */
      latestRelease: readCachedRelease(),
      engine: engineView(engine),
      deployNotice,
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
      latestRelease: readCachedRelease(),
      engine: engineView(engine),
      deployNotice,
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
    latestRelease: readCachedRelease(),
    /* 2.6.9: движок в воркспейсе, снаружи (карта) или его нет. */
    engine: engineView(engine),
    /* 0151: что решило развёртывание — политика и её цена, а не догадка. */
    deployNotice,
    /* Проекты внутри пространства, где workflow развёрнут. */
    projects: discoverNestedProjects(allowedRoots(runtime)),
    repo: repoInfoPayload(info),
    error: null,
  });
  return;
}

export async function tasks(ctx) {
  const { runtime, selection, url, req, res, rel } = ctx;
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
  /*
   * 0106 (2.6.96): здоровье задач — снимок tools/task-monitor.mjs. Панель
   * показывает флаги (красный не доказан, verify красный, зависло), API
   * отдаёт как есть; битый снимок не роняет доску.
   * Файл снимка: <root>/.dsh/workflow/tasks.json (его пишет tools/task-monitor.mjs).
   */
  let health = null;
  try {
    const healthFile = path.join(selection.root, '.dsh', 'workflow', 'tasks.json');
    if (fs.existsSync(healthFile)) health = JSON.parse(fs.readFileSync(healthFile, 'utf8').replace(/^\uFEFF/u, ''));
  } catch (error) {
    health = { error: String(error && error.message ? error.message : error) };
  }
  sendJson(res, 200, { plugin: runtime.plugin, engine: engineView(engine), ...board, health });
  return;
}

export async function task(ctx) {
  const { runtime, selection, url, req, res, rel } = ctx;
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

export async function policy(ctx) {
  const { runtime, selection, url, req, res, rel } = ctx;
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

export async function compat(ctx) {
  const { runtime, selection, url, req, res, rel } = ctx;
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

