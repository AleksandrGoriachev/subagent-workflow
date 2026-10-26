/**
 * HTTP half: loopback-only GET routes for the panel.
 *
 * The handler is a pure wiring function (mock request/response objects work in
 * tests) so the routes can be exercised without a DSH host. Every route reads
 * the repository through \`state.js\` and never writes: no body parser, no POST
 * branch, no gate runner.
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

/** Configured roots plus every registered workspace (read-only, validated). */
function allowedRoots(runtime) {
  const list = [...runtime.roots];
  for (const candidate of rootsFromRegistry(runtime.getWorkspaceRegistry)) {
    if (!list.some((root) => samePath(root, candidate))) list.push(candidate);
  }
  return list;
}

function isLoopback(req) {
  const address = req.socket && req.socket.remoteAddress;
  if (address === undefined || address === null || address.length === 0) return true;
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
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
      if (method !== 'GET') {
        res.setHeader('Allow', 'GET');
        sendJson(res, 405, { error: 'Method ' + method + ' is not allowed.' });
        return;
      }

      const rel = pathname.slice(API_PREFIX.length) || '/';
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
          repo: repoInfoPayload(info),
          error: null,
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
        sendJson(res, 200, {
          plugin: runtime.plugin,
          root: info.root,
          configPath: info.configPath,
          ...policyView(info.config, { root: info.root, configPath: info.configPath }),
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
