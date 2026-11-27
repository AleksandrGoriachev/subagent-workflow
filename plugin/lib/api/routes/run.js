/*
 * Проверки и прогон гейтов (read-only).
 *
 * 0187: часть маршрутизатора plugin/lib/api/router.js; вход — router.js.
 */
import fs from 'node:fs';
import { readRepoInfo } from '../../state.js';
import { buildCheck, runCheck, CHECK_IDS, CHECK_TITLES } from '../../checks.js';
import { engineReadRoot, resolveRuntimeEngine, selectRoot } from '../roots.js';
import { readJsonBody, sendJson } from '../http.js';

export async function checks(ctx) {
  const { runtime, selection, url, req, res, rel } = ctx;
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

export async function run(ctx) {
  const { runtime, selection, url, req, res, rel } = ctx;
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

