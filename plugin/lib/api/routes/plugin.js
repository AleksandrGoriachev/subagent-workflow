/*
 * Обновление самого пакета панели.
 *
 * 0187: часть маршрутизатора plugin/lib/api/router.js; вход — router.js.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLUGIN_VERSION } from '../../compat.js';
import { compareVersions } from '../../deploy.js';
import { pluginInstallMode, preparePluginTarball, installPluginFiles } from '../../plugin-update.mjs';
import { writeRequestProblem, readJsonBody, sendJson } from '../http.js';

export async function update(ctx) {
  const { runtime, selection, url, req, res, rel } = ctx;
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

