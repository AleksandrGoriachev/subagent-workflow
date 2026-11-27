/*
 * Маршрутизатор панели: 18 путей /workflow/api/*.
 *
 * 0187: раскладка по доменам — обработчики живут в plugin/lib/api/routes/*.js,
 * здесь остаётся диспетчер: префикс, loopback, метод, выбор корня и таблица
 * «путь → обработчик». Тела маршрутов перенесены без изменения поведения:
 * те же коды, тела, порядок проверок и сообщения. POST-пути требуют POST и
 * отвечают 405 с Allow: POST, остальные — GET с Allow: GET, неизвестный путь —
 * 404, исключение — 500, если ответ ещё не отправлен.
 */
import { API_PREFIX } from './constants.js';
import { isLoopback, sendJson } from './http.js';
import { selectRoot } from './roots.js';
import * as statusRoutes from './routes/status.js';
import * as engineRoutes from './routes/engine.js';
import * as pluginRoutes from './routes/plugin.js';
import * as writeRoutes from './routes/writes.js';
import * as runRoutes from './routes/run.js';
import * as anchorRoutes from './routes/anchors.js';
import * as releaseRoutes from './routes/release.js';

/* Маршруты, меняющие состояние: требуют POST и Content-Type/Origin-проверок в обработчике. */
const POST_PATHS = new Set([
  '/api/run', '/api/guard', '/api/anchors/approve', '/api/deploy', '/api/update',
  '/api/engine-link', '/api/plugin-update', '/api/task-hash', '/api/new-task', '/api/release-check',
]);

const ROUTES = new Map([
  ['/api/status', statusRoutes.status],
  ['/api/tasks', statusRoutes.tasks],
  ['/api/policy', statusRoutes.policy],
  ['/api/compat', statusRoutes.compat],
  ['/api/metrics', statusRoutes.metrics],
  ['/api/anchors', anchorRoutes.anchors],
  ['/api/anchors/approve', anchorRoutes.approve],
  ['/api/release-check', releaseRoutes.check],
  ['/api/engine/candidates', engineRoutes.candidates],
  ['/api/engine-link', engineRoutes.link],
  ['/api/update', engineRoutes.update],
  ['/api/plugin-update', pluginRoutes.update],
  ['/api/checks', runRoutes.checks],
  ['/api/run', runRoutes.run],
  ['/api/guard', writeRoutes.guard],
  ['/api/deploy', writeRoutes.deploy],
  ['/api/task-hash', writeRoutes.tasks],
  ['/api/new-task', writeRoutes.tasks],
]);

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
      const postRoute = POST_PATHS.has(rel);
      if (postRoute ? method !== 'POST' : method !== 'GET') {
        res.setHeader('Allow', postRoute ? 'POST' : 'GET');
        sendJson(res, 405, { error: 'Method ' + method + ' is not allowed.' });
        return;
      }

      const selection = selectRoot(runtime, url.searchParams.get('root'));
      const ctx = { runtime, selection, url, req, res, rel };
      const handler = ROUTES.get(rel);
      if (handler !== undefined) {
        await handler(ctx);
        return;
      }
      if (rel.startsWith('/api/task/')) {
        await statusRoutes.task(ctx);
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

export function warn(ctx, message) {
  try {
    ctx.logger.warn(message);
  } catch {
    console.warn('[dsh-workflow-console] ' + message);
  }
}
