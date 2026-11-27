/*
 * Маршрутизатор: 18 путей /workflow/api/* — один конвейер, каждая ветвь самодостаточна.
 *
 * 0180: часть plugin/lib/api.js; публичный вход — plugin/lib/api.js.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readRepoInfo, readRepository, readTask, policyView, loadConfig } from '../state.js';
import { compatView, PLUGIN_VERSION } from '../compat.js';
import { buildCheck, runCheck, CHECK_IDS, CHECK_TITLES } from '../checks.js';
import { writeGuardEnabled, readGuard, GUARD_CONFIG_REL } from '../guard.js';
import { deployWorkflow, updateWorkflowAsync, externalEngineRepo, availableSpecRoot, availableVersion, compareVersions } from '../deploy.js';
import { engineView, readDeployNotice, cleanEnginePath, engineVersion, hasEngine, writeEngineLink } from '../engine-root.js';
import { prepareEngineSpec } from '../release-source.mjs';
import { releaseCheckPayload, readCachedRelease } from '../release-check.mjs';
import { anchorsStatus, approveAnchors } from '../anchors.js';
import { taskHashArgs, newTaskArgs, taskDirOf } from '../tasks-write.mjs';
import { imperativeView } from '../imperative.js';
import { pluginInstallMode, preparePluginTarball, installPluginFiles } from '../plugin-update.mjs';
import { API_PREFIX, DEFAULT_UPDATE_SOURCE } from './constants.js';
import { samePath, discoverNestedProjects, allowedRoots, engineReadRoot, resolveRuntimeEngine, refuseExternalWrite, refuseExternalWriteBeforeBody, updateResponseStatus, selectRoot } from './roots.js';
import { isLoopback, writeRequestProblem, readJsonBody, sendJson } from './http.js';
import { guardPayload, repoInfoPayload } from './payloads.js';
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
      const postRoutes = rel === '/api/run' || rel === '/api/guard' || rel === '/api/anchors/approve'
        || rel === '/api/deploy' || rel === '/api/update' || rel === '/api/engine-link'
        || rel === '/api/plugin-update' || rel === '/api/task-hash' || rel === '/api/new-task'
        || rel === '/api/release-check';
      if (postRoutes ? method !== 'POST' : method !== 'GET') {
        res.setHeader('Allow', postRoutes ? 'POST' : 'GET');
        sendJson(res, 405, { error: 'Method ' + method + ' is not allowed.' });
        return;
      }

      const selection = selectRoot(runtime, url.searchParams.get('root'));
      /*
       * 2.6.89: снимок метрик эффективности узлов. Считает tools/launch-metrics.mjs
       * (--publish <root>), панель только читает — браузер не пересчитывает журналы.
       */
      if (rel === '/api/metrics') {
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

      if (rel === '/api/status') {
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

      /*
       * 0111 (WC-77): утверждение якорей из панели — человек нажимает, ключ лежит вне репозитория.
       * 2.6.82: слой выбирает человек в предпросмотре — контур (движок) или проект (воркспейс).
       */
      const anchorsLayer = url.searchParams.get('layer') === 'project' ? 'project' : 'contour';
      if (rel === '/api/anchors') {
        sendJson(res, 200, anchorsStatus(selection.root, loadConfig(selection.root), anchorsLayer));
        return;
      }

      if (rel === '/api/anchors/approve') {
        try {
          sendJson(res, 200, approveAnchors(selection.root, loadConfig(selection.root), anchorsLayer));
        } catch (error) {
          sendJson(res, 200, { ok: false, problems: [error && error.message ? error.message : String(error)] });
        }
        return;
      }

      if (rel === '/api/release-check') {
        /*
         * 0102 (WC-65): проверка актуальности по требованию, не на загрузке
         * страницы. Ответ всегда 200: сеть упала — это состояние проверки, а не
         * ошибка маршрута, и панель обязана показать последнюю удачную пару.
         * Тело необязательно: панель шлёт пустой объект.
         */
        let checkBody = {};
        try {
          checkBody = await readJsonBody(req);
        } catch {
          checkBody = {};
        }
        const repoOverride = checkBody && typeof checkBody.repo === 'string' ? checkBody.repo.trim() : '';
        const payload = await releaseCheckPayload({
          repo: repoOverride !== '' ? repoOverride : undefined,
          fetchImpl: typeof runtime.fetchReleaseApi === 'function' ? runtime.fetchReleaseApi : undefined,
        });
        sendJson(res, 200, payload);
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

      /*
       * 0090 (WC-4): первая запись из панели — замок контракта и новое задание.
       * Панель не редактирует тексты: она запускает штатные скрипты движка с
       * явными аргументами (валидация — tasks-write.mjs) и возвращает вывод.
       */
      if (rel === '/api/task-hash' || rel === '/api/new-task') {
        const problem = writeRequestProblem(req);
        if (problem) {
          sendJson(res, problem.status, { error: problem.error });
          return;
        }
        if (refuseExternalWriteBeforeBody(runtime, res, url.searchParams.get('root'))) return;
        let body;
        try {
          body = await readJsonBody(req);
        } catch (error) {
          sendJson(res, 400, { error: error && error.message ? error.message : 'некорректное тело запроса' });
          return;
        }
        if (refuseExternalWrite(runtime, res, body.root)) return;
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
        /* Тот же корень, что у проверок: <engine>/docs/subagent-workflow/scripts. */
        const scriptRel = rel === '/api/task-hash'
          ? 'docs/subagent-workflow/scripts/task-hash.mjs'
          : 'docs/subagent-workflow/scripts/new-task.mjs';
        const script = path.join(engineReadRoot(target.root, engine), scriptRel.split('/').join(path.sep));
        if (!fs.existsSync(script)) {
          sendJson(res, 400, {
            code: 'engine-script-missing',
            error: 'в движке нет ' + scriptRel + ': обновите движок воркспейса',
          });
          return;
        }
        if (rel === '/api/task-hash') {
          let dir;
          try {
            dir = taskDirOf(target.root, info.tasksDir, body.task);
          } catch (error) {
            sendJson(res, 400, { code: 'invalid-arguments', error: error && error.message ? error.message : String(error) });
            return;
          }
          if (!fs.existsSync(dir)) {
            sendJson(res, 404, { code: 'task-not-found', error: 'задание не найдено: ' + dir });
            return;
          }
        }
        let args;
        try {
          args = rel === '/api/task-hash'
            ? taskHashArgs({
              taskDir: taskDirOf(target.root, info.tasksDir, body.task),
              root: target.root,
              mode: body.relock === true ? 'relock' : 'write',
              reason: body.reason,
            })
            : newTaskArgs({
              id: body.id,
              title: body.title,
              risk: body.risk,
              root: target.root,
              executor: body.executor,
              acceptor: body.acceptor,
            });
        } catch (error) {
          sendJson(res, 400, { code: 'invalid-arguments', error: error && error.message ? error.message : String(error) });
          return;
        }
        const run = spawnSync(process.execPath, [script, ...args], {
          cwd: target.root,
          encoding: 'utf8',
          timeout: 120000,
          maxBuffer: 8 * 1024 * 1024,
          windowsHide: true,
          env: process.env,
        });
        const out = String(run.stdout || '');
        const err = String(run.stderr || '');
        const ok = typeof run.status === 'number' && run.status === 0;
        sendJson(res, ok ? 200 : 500, {
          plugin: runtime.plugin,
          root: target.root,
          action: rel === '/api/task-hash' ? (body.relock === true ? 'relock' : 'write') : 'new-task',
          task: rel === '/api/task-hash' ? String(body.task || '') : String(body.id || ''),
          ok,
          exitCode: typeof run.status === 'number' ? run.status : null,
          stdout: out.slice(-4000),
          stderr: err.slice(-4000),
          ...(ok ? {} : { error: (err.slice(-1500) || out.slice(-1500) || 'скрипт завершился с ошибкой') }),
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

export function warn(ctx, message) {
  try {
    ctx.logger.warn(message);
  } catch {
    console.warn('[dsh-workflow-console] ' + message);
  }
}

/** Register the prefix route on the DSH web server for the plugin fiber. */
