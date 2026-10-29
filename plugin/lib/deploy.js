/**
 * Развёртывание и обновление движка в корне workspace (0.8.0).
 *
 * Единственная операция записи, которую панель делает по явной команде
 * пользователя: вложенная спека (`vendor/spec`) запускается через `init.mjs` в
 * выбранный корень. Модуль ничего не подписывает, не коммитит и не трогает
 * `guard.enabled` — это отдельная кнопка и отдельный маршрут.
 *
 * 0.7.1 (B1 ночного ревью): ключ приёмщика создаётся В ПРОЕКТЕ —
 * `<repo>/.wf-keys/`, туда его направляет явный `--key-out`. Глобальный
 * `%USERPROFILE%\.wf-keys` не трогается: развернули A, потом B — ключ A цел,
 * его `acceptors.json` по-прежнему сходится с подписью. Каталог ключа
 * попадает в `.gitignore` проекта (это делает init; deploy дополнительно
 * проверяет строку идемпотентно).
 *
 * 0.8.0: обновление развёрнутой копии до версии вложенной спеки. Перед init
 * проверяются задания без записи приёмки: обновление меняет ворота и
 * workflow.config.json, и незавершённое задание может сломаться на перепроверке.
 * Поэтому по умолчанию возвращается `tasks-in-progress` со списком ID, а
 * продолжение возможно только с `allowInProgress: true` (галочка «понимаю
 * риск»). Каждое развёртывание/обновление пишет строку в
 * `docs/subagent-workflow/deploy.log`.
 *
 * Два входа в одну операцию:
 *  - `updateWorkflow` — синхронный (CLI/тесты), init через spawnSync;
 *  - `updateWorkflowAsync` — HTTP-маршрут панели: init запускается асинхронным
 *    spawn, поэтому event loop DSH не блокируется до 180 с и остальные
 *    маршруты живы, пока идёт обновление.
 * Обе ветки используют одни и те же preflight/финализацию, поэтому коды и
 * журнал не расходятся.
 *
 * Корень приходит только из `selectRoot` (runtime.roots), а спека — из tarball
 * плагина: установка не требует сети. В dev-копии плагина vendor нет, поэтому
 * спека берётся из соседнего каталога пакета (`<package>/../spec`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Пути внутри проекта: по VERSION отличаем «развёрнуто» от «не развёрнуто». */
export const VERSION_REL = path.join('docs', 'subagent-workflow', 'VERSION');
export const CONFIG_REL = path.join('docs', 'subagent-workflow', 'workflow.config.json');
export const DEPLOY_LOG_REL = path.join('docs', 'subagent-workflow', 'deploy.log');

/* Вложенная спека tarball и dev-фолбэк: ровно тот же выбор, что у packs-plugin. */
export const VENDOR_SPEC = path.join(PACKAGE_ROOT, 'vendor', 'spec');
export const DEV_SPEC = path.resolve(PACKAGE_ROOT, '..', 'spec');

/* 0.7.1: ключ приёмщика — каталог проекта, а не глобальный профиль машины. */
export const KEY_DIR_REL = '.wf-keys';
export const KEY_ID = 'agent-judge';

export const DEFAULT_TIMEOUT_MS = 180000;
/* Панель показывает хвост вывода: длинный лог не должен раздувать ответ. */
export const LOG_LIMIT = 20000;
/* Предел накопления вывода асинхронного init: защита от бесконечного лога. */
const OUTPUT_LIMIT = 4 * 1024 * 1024;

/** Спека, которую панель вкладывает в tarball; в dev — исходная spec/ пакета. */
export function availableSpecRoot() {
  return fs.existsSync(VENDOR_SPEC) ? VENDOR_SPEC : DEV_SPEC;
}

/**
 * Версия движка, лежащая в сборке панели.
 *
 * init берёт версию из `packageRoot/../VERSION` (vendor/VERSION рядом с
 * vendor/spec), поэтому и здесь сначала смотрим соседний VERSION, затем
 * VERSION внутри самой спеки (развёрнутая копия).
 */
export function targetVersion(specRoot = availableSpecRoot()) {
  const spec = path.resolve(String(specRoot || ''));
  const candidates = [
    path.join(spec, '..', 'VERSION'),
    path.join(spec, 'VERSION'),
  ];
  for (const candidate of candidates) {
    try {
      const text = fs.readFileSync(candidate, 'utf8').trim();
      if (text !== '') return text;
    } catch {
      /* следующий кандидат */
    }
  }
  return null;
}

/** Доступная (вложенная в сборку) версия движка для шапки панели. */
export function availableVersion() {
  return targetVersion(availableSpecRoot());
}

function tail(text, limit = LOG_LIMIT) {
  const value = String(text || '');
  return value.length > limit ? '…\n' + value.slice(value.length - limit) : value;
}

function dirExists(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return null;
  }
}

/** Развёрнутая версия движка или null, если VERSION нет. */
export function deployedVersion(root) {
  const value = readText(path.join(path.resolve(String(root || '')), VERSION_REL));
  return value === '' ? null : value;
}

function actorOf(options = {}) {
  const candidates = [
    options.actor,
    process.env && process.env.DSH_SESSION_ID,
    process.env && process.env.TASK_ACTOR_SESSION,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const value = candidate.trim();
    if (value !== '') return value;
  }
  return 'unknown';
}

/**
 * Каталог ключа и журнал развёртывания — локальное состояние проекта, а не
 * файлы пакета: строки в .gitignore ставятся идемпотентно.
 */
function ensureIgnored(repo, line, comment) {
  const file = path.join(repo, '.gitignore');
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    text = '';
  }
  if (text.split(/\r?\n/).includes(line)) return;
  try {
    fs.appendFileSync(file, (text && !text.endsWith('\n') ? '\n' : '')
      + '# ' + comment + '\n' + line + '\n');
  } catch {
    /* .gitignore не записался — init всё равно поставит свои строки; ключ важнее */
  }
}

function ensureKeyIgnored(repo) {
  ensureIgnored(repo, KEY_DIR_REL + '/', 'subagent-workflow: ключ приёмщика проекта');
}

function ensureDeployLogIgnored(repo) {
  ensureIgnored(repo, DEPLOY_LOG_REL.split(path.sep).join('/'), 'subagent-workflow: журнал развёртывания');
}

/**
 * Одна строка журнала: время, from → to, актор, результат. Пишется и при
 * успехе, и при отказе init — иначе «почему не обновилось» видно только в
 * выводе, который панель не сохраняет.
 */
function appendDeployLog(repo, { from, to, actor, result }) {
  const file = path.join(repo, DEPLOY_LOG_REL);
  const line = new Date().toISOString()
    + ' deploy from=' + (from || 'none')
    + ' to=' + (to || '?')
    + ' actor=' + (actor || 'unknown')
    + ' result=' + (result || 'unknown')
    + '\n';
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, line, 'utf8');
  } catch {
    /* журнал не должен отменять уже выполненное развёртывание */
  }
}

/**
 * Задания без валидной записи приёмки.
 *
 * «Незавершённое» — каталог `docs/tasks/<id>` с task.md/criteria.lock/red.json/
 * verify.json, у которого нет acceptance.json со `status: accepted`. Служебные
 * каталоги (`_superseded`, скрытые) не считаются: это история, а не работа.
 *
 * @param {string} root корень проекта
 * @returns {string[]} ID заданий в стабильном порядке
 */
export function tasksInProgress(root) {
  const repo = path.resolve(String(root || ''));
  const tasksRoot = path.join(repo, 'docs', 'tasks');
  if (!dirExists(tasksRoot)) return [];
  const ids = [];
  let entries;
  try {
    entries = fs.readdirSync(tasksRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
    const dir = path.join(tasksRoot, entry.name);
    const started = ['task.md', 'criteria.lock', 'red.json', 'verify.json']
      .some((name) => fs.existsSync(path.join(dir, name)));
    if (!started) continue;
    let accepted = false;
    try {
      const record = JSON.parse(fs.readFileSync(path.join(dir, 'acceptance.json'), 'utf8'));
      accepted = Boolean(record && record.status === 'accepted');
    } catch {
      accepted = false;
    }
    if (!accepted) ids.push(entry.name);
  }
  return ids;
}

/**
 * Общие проверки до запуска init: их же используют синхронная и асинхронная
 * ветки. Возвращает либо `{ok:false, code, error}`, либо подготовку к запуску.
 */
function prepareUpdate(root, options = {}) {
  const repo = path.resolve(String(root || ''));
  if (!root || !dirExists(repo)) {
    return { ok: false, code: 'not-found', error: 'корень не найден: ' + repo };
  }
  if (!fs.existsSync(path.join(repo, '.git'))) {
    return { ok: false, code: 'not-a-repo', error: 'не git-репозиторий: ' + repo + ' — нужен git init' };
  }
  const from = deployedVersion(repo);
  if (!from) {
    return {
      ok: false,
      code: 'not-deployed',
      error: 'workflow не развёрнут в ' + repo + ': нажмите «Развернуть workflow здесь»',
    };
  }
  const specRoot = path.resolve(String(options.specRoot || availableSpecRoot()));
  const to = targetVersion(specRoot);
  if (!to) {
    return {
      ok: false,
      code: 'init-failed',
      error: 'в сборке нет VERSION: обновлять нечем (' + specRoot + ')',
      version: from,
    };
  }
  /*
   * up-to-date проверяется ДО списка незавершённых заданий: если обновлять
   * нечего, предупреждение о риске бессмысленно и повтор кнопки должен быть
   * безопасным даже при работе над задачей.
   */
  if (to === from) {
    return { ok: false, code: 'up-to-date', version: from, targetVersion: to };
  }
  const tasks = tasksInProgress(repo);
  if (tasks.length > 0 && options.allowInProgress !== true) {
    return {
      ok: false,
      code: 'tasks-in-progress',
      tasks,
      version: from,
      targetVersion: to,
      error: 'есть незавершённые задания: ' + tasks.join(', ')
        + ' — обновление может сломать их перепроверку',
    };
  }
  const init = path.join(specRoot, 'scripts', 'init.mjs');
  if (!fs.existsSync(init)) {
    return {
      ok: false,
      code: 'init-failed',
      error: 'в сборке нет движка: ' + init,
      log: '',
      version: from,
    };
  }
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  return {
    ok: true,
    repo,
    specRoot,
    init,
    versionFile: path.join(repo, VERSION_REL),
    keyDir: path.join(repo, KEY_DIR_REL),
    from,
    to,
    tasks,
    actor: actorOf(options),
    timeoutMs,
    args: [init, '--repo', repo, '--force', '--key-out', path.join(repo, KEY_DIR_REL), '--key-id', KEY_ID],
  };
}

/** Финализация обеих веток: проверка результата, журнал, коды. */
function finishUpdate(prepared, run) {
  const log = tail(String(run.stdout || '') + String(run.stderr || ''));
  const failed = (error) => {
    appendDeployLog(prepared.repo, {
      from: prepared.from,
      to: prepared.to,
      actor: prepared.actor,
      result: 'init-failed',
    });
    return {
      ok: false,
      code: 'init-failed',
      error,
      log,
      from: prepared.from,
      to: prepared.to,
      version: prepared.from,
      tasks: prepared.tasks,
    };
  };
  if (run.error) {
    const timedOut = run.timedOut === true
      || run.error.code === 'ETIMEDOUT'
      || run.signal === 'SIGTERM';
    return failed(timedOut
      ? 'init не уложился в ' + prepared.timeoutMs + ' мс и был остановлен'
      : 'init не запустился: ' + (run.error.message || String(run.error)));
  }
  if (run.status !== 0) {
    return failed('init завершился с кодом ' + (run.status === null ? '?' : run.status));
  }
  ensureKeyIgnored(prepared.repo);
  ensureDeployLogIgnored(prepared.repo);
  if (!fs.existsSync(prepared.versionFile)) {
    return failed('init завершился, но ' + VERSION_REL + ' не появился: в сборке нет VERSION');
  }
  const version = readText(prepared.versionFile) || prepared.to;
  appendDeployLog(prepared.repo, {
    from: prepared.from,
    to: version,
    actor: prepared.actor,
    result: 'ok',
  });
  return {
    ok: true,
    from: prepared.from,
    to: version,
    version,
    log,
    tasks: prepared.tasks,
  };
}

/**
 * Развернуть движок из `specRoot` в `root` (первое развёртывание).
 *
 * Коды отказа: `not-found` (корня нет), `not-a-repo` (нет .git), `already-deployed`
 * (уже есть VERSION — для обновления есть updateWorkflow), `init-failed` (init
 * упал, таймаут или сборка без движка). Успех: `{ ok: true, version, log }`.
 *
 * @param {string} root корень проекта (уже проверенный selectRoot)
 * @param {{specRoot?: string, timeoutMs?: number}} [options]
 * @returns {{ok: boolean, code?: string, error?: string, version?: string|null, log?: string}}
 */
export function deployWorkflow(root, options = {}) {
  const repo = path.resolve(String(root || ''));
  if (!root || !dirExists(repo)) {
    return { ok: false, code: 'not-found', error: 'корень не найден: ' + repo };
  }
  /*
   * .git — файл в worktree и каталог в обычном клоне; existsSync покрывает оба.
   * Без репозитория init всё равно скопировал бы файлы, но хуки и guard молча
   * остались бы невключёнными — поэтому отказ, а не половина развёртывания.
   */
  if (!fs.existsSync(path.join(repo, '.git'))) {
    return {
      ok: false,
      code: 'not-a-repo',
      error: 'не git-репозиторий: ' + repo + ' — нужен git init',
    };
  }
  const versionFile = path.join(repo, VERSION_REL);
  if (fs.existsSync(versionFile)) {
    let version = null;
    try {
      version = fs.readFileSync(versionFile, 'utf8').trim() || null;
    } catch {
      version = null;
    }
    return {
      ok: false,
      code: 'already-deployed',
      version,
      error: 'workflow уже развёрнут в ' + repo + (version ? ' (версия ' + version + ')' : '')
        + ': обновление — кнопкой «Обновить движок»',
    };
  }
  const specRoot = path.resolve(String(options.specRoot || availableSpecRoot()));
  const init = path.join(specRoot, 'scripts', 'init.mjs');
  if (!fs.existsSync(init)) {
    return {
      ok: false,
      code: 'init-failed',
      error: 'в сборке нет движка: ' + path.join(specRoot, 'scripts', 'init.mjs'),
      log: '',
    };
  }
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const actor = actorOf(options);
  const to = targetVersion(specRoot);
  /*
   * init запускается в репозитории: --force обновляет файлы пакета, ключ и
   * workflow.config.json не перезаписывает (это решает сам init). Вывод
   * захватывается целиком: по нему панель объясняет отказ.
   *
   * --key-out обязателен (0.7.1): без него init писал бы ключ в глобальный
   * %USERPROFILE%\.wf-keys и второе развёртывание уничтожало бы ключ первого
   * проекта. Путь — каталог проекта; --key-id фиксируем явно, чтобы умолчание
   * init не меняло адрес ключа молча.
   */
  const keyDir = path.join(repo, KEY_DIR_REL);
  const result = spawnSync(process.execPath,
    [init, '--repo', repo, '--force', '--key-out', keyDir, '--key-id', KEY_ID], {
    cwd: repo,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
    env: process.env,
  });
  const log = tail(String(result.stdout || '') + String(result.stderr || ''));
  if (result.error) {
    const timedOut = result.error.code === 'ETIMEDOUT' || result.signal === 'SIGTERM';
    appendDeployLog(repo, { from: null, to, actor, result: 'init-failed' });
    return {
      ok: false,
      code: 'init-failed',
      error: timedOut
        ? 'init не уложился в ' + timeoutMs + ' мс и был остановлен'
        : 'init не запустился: ' + (result.error.message || String(result.error)),
      log,
    };
  }
  if (result.status !== 0) {
    appendDeployLog(repo, { from: null, to, actor, result: 'init-failed' });
    return {
      ok: false,
      code: 'init-failed',
      error: 'init завершился с кодом ' + (result.status === null ? '?' : result.status),
      log,
    };
  }
  /* Ключ проекта мог быть создан до записи VERSION: игнор ставим до проверки ниже. */
  ensureKeyIgnored(repo);
  ensureDeployLogIgnored(repo);
  /*
   * Успех без VERSION — это не успех: значит сборка приехала без VERSION рядом со
   * спекой (pack-plugin кладёт его в vendor), и «развёрнуто» определить нечем.
   */
  if (!fs.existsSync(versionFile)) {
    appendDeployLog(repo, { from: null, to, actor, result: 'init-failed' });
    return {
      ok: false,
      code: 'init-failed',
      error: 'init завершился, но ' + VERSION_REL + ' не появился: в сборке нет VERSION',
      log,
    };
  }
  const version = fs.readFileSync(versionFile, 'utf8').trim();
  appendDeployLog(repo, { from: null, to: version, actor, result: 'ok' });
  return { ok: true, version, log };
}

/**
 * Обновить развёрнутую копию до версии вложенной спеки (синхронно).
 *
 * Коды отказа: `not-found`, `not-a-repo`, `not-deployed`, `up-to-date`,
 * `tasks-in-progress` (+ `tasks`), `init-failed`. Успех:
 * `{ok:true, from, to, version, log, tasks}`.
 *
 * @param {string} root корень проекта
 * @param {{specRoot?: string, allowInProgress?: boolean, timeoutMs?: number, actor?: string}} [options]
 */
export function updateWorkflow(root, options = {}) {
  const prepared = prepareUpdate(root, options);
  if (prepared.ok !== true) return prepared;
  const result = spawnSync(process.execPath, prepared.args, {
    cwd: prepared.repo,
    encoding: 'utf8',
    timeout: prepared.timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
    env: process.env,
  });
  return finishUpdate(prepared, {
    status: result.status,
    signal: result.signal,
    error: result.error || null,
    stdout: result.stdout,
    stderr: result.stderr,
  });
}

/**
 * То же обновление, но init запускается асинхронным `spawn`: HTTP-маршрут
 * панели не блокирует event loop DSH и остальные запросы живы, пока идёт
 * обновление. Возвращает промис с результатом той же формы, что и
 * `updateWorkflow`.
 *
 * @param {string} root корень проекта
 * @param {{specRoot?: string, allowInProgress?: boolean, timeoutMs?: number, actor?: string}} [options]
 * @returns {Promise<object>}
 */
export function updateWorkflowAsync(root, options = {}) {
  return new Promise((resolve) => {
    let prepared;
    try {
      prepared = prepareUpdate(root, options);
    } catch (error) {
      resolve({ ok: false, code: 'init-failed', error: error && error.message ? error.message : String(error) });
      return;
    }
    if (prepared.ok !== true) {
      resolve(prepared);
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const child = spawn(process.execPath, prepared.args, {
      cwd: prepared.repo,
      windowsHide: true,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        /* процесс уже завершился */
      }
    }, prepared.timeoutMs);
    const settle = (run) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(finishUpdate(prepared, run));
    };
    child.stdout.on('data', (chunk) => {
      if (stdout.length < OUTPUT_LIMIT) stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < OUTPUT_LIMIT) stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      const failure = timedOut ? Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }) : error;
      settle({ status: null, signal: null, error: failure, timedOut, stdout, stderr });
    });
    child.on('close', (status, signal) => {
      settle({
        status,
        signal,
        error: timedOut ? Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }) : null,
        timedOut,
        stdout,
        stderr,
      });
    });
  });
}
