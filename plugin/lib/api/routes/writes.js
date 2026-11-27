/*
 * Записи панели по подтверждению: guard, deploy, task-hash/new-task.
 *
 * 0187: часть маршрутизатора plugin/lib/api/router.js; вход — router.js.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readRepoInfo } from '../../state.js';
import { writeGuardEnabled, GUARD_CONFIG_REL } from '../../guard.js';
import { deployWorkflow, availableSpecRoot } from '../../deploy.js';
import { taskHashArgs, newTaskArgs, taskDirOf } from '../../tasks-write.mjs';
import { engineReadRoot, resolveRuntimeEngine, refuseExternalWrite, refuseExternalWriteBeforeBody, selectRoot } from '../roots.js';
import { writeRequestProblem, readJsonBody, sendJson } from '../http.js';

export async function guard(ctx) {
  const { runtime, selection, url, req, res, rel } = ctx;
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

export async function deploy(ctx) {
  const { runtime, selection, url, req, res, rel } = ctx;
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

export async function tasks(ctx) {
  const { runtime, selection, url, req, res, rel } = ctx;
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

