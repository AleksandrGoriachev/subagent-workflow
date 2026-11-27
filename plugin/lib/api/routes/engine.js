/*
 * Движок: кандидаты, связь с движком, обновление развёрнутой копии.
 *
 * 0187: часть маршрутизатора plugin/lib/api/router.js; вход — router.js.
 */
import fs from 'node:fs';
import { updateWorkflowAsync, externalEngineRepo, availableSpecRoot } from '../../deploy.js';
import { engineView, cleanEnginePath, engineVersion, hasEngine, writeEngineLink } from '../../engine-root.js';
import { prepareEngineSpec } from '../../release-source.mjs';
import { DEFAULT_UPDATE_SOURCE } from '../constants.js';
import { samePath, allowedRoots, resolveRuntimeEngine, refuseExternalWrite, updateResponseStatus, selectRoot } from '../roots.js';
import { writeRequestProblem, readJsonBody, sendJson } from '../http.js';

export async function candidates(ctx) {
  const { runtime, selection, url, req, res, rel } = ctx;
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

export async function link(ctx) {
  const { runtime, selection, url, req, res, rel } = ctx;
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

export async function update(ctx) {
  const { runtime, selection, url, req, res, rel } = ctx;
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

