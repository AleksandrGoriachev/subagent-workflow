/**
 * Развёртывание движка в корень workspace (0.7.1).
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
 * Корень приходит только из `selectRoot` (runtime.roots), а спека — из tarball
 * плагина: установка не требует сети. В dev-копии плагина vendor нет, поэтому
 * спека берётся из соседнего каталога пакета (`<package>/../spec`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Пути внутри проекта: по VERSION отличаем «развёрнуто» от «не развёрнуто». */
export const VERSION_REL = path.join('docs', 'subagent-workflow', 'VERSION');
export const CONFIG_REL = path.join('docs', 'subagent-workflow', 'workflow.config.json');

/* Вложенная спека tarball и dev-фолбэк: ровно тот же выбор, что у packs-plugin. */
export const VENDOR_SPEC = path.join(PACKAGE_ROOT, 'vendor', 'spec');
export const DEV_SPEC = path.resolve(PACKAGE_ROOT, '..', 'spec');

/* 0.7.1: ключ приёмщика — каталог проекта, а не глобальный профиль машины. */
export const KEY_DIR_REL = '.wf-keys';
export const KEY_ID = 'agent-judge';

/**
 * Каталог ключа обязан быть в .gitignore проекта: приватный ключ не коммитится.
 * init ставит строку сам; здесь — идемпотентная страховка на случай сборки со
 * старым init (и чтобы обещание панели не зависело от версии вложенной спеки).
 */
function ensureKeyIgnored(repo) {
  const file = path.join(repo, '.gitignore');
  const line = KEY_DIR_REL + '/';
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    text = '';
  }
  if (text.split(/\r?\n/).includes(line)) return;
  try {
    fs.appendFileSync(file, (text && !text.endsWith('\n') ? '\n' : '')
      + '# subagent-workflow: ключ приёмщика проекта\n' + line + '\n');
  } catch {
    /* .gitignore не записался — init всё равно поставит строку; ключ важнее */
  }
}

export const DEFAULT_TIMEOUT_MS = 180000;
/* Панель показывает хвост вывода: длинный лог не должен раздувать ответ. */
export const LOG_LIMIT = 20000;

/** Спека, которую панель вкладывает в tarball; в dev — исходная spec/ пакета. */
export function availableSpecRoot() {
  return fs.existsSync(VENDOR_SPEC) ? VENDOR_SPEC : DEV_SPEC;
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

/**
 * Развернуть движок из `specRoot` в `root`.
 *
 * Коды отказа: `not-found` (корня нет), `not-a-repo` (нет .git), `already-deployed`
 * (уже есть VERSION — обновление кнопкой не делается), `init-failed` (init
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
        + ': обновление кнопкой не делается',
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
    return {
      ok: false,
      code: 'init-failed',
      error: 'init завершился с кодом ' + (result.status === null ? '?' : result.status),
      log,
    };
  }
  /* Ключ проекта мог быть создан до записи VERSION: игнор ставим до проверки ниже. */
  ensureKeyIgnored(repo);
  /*
   * Успех без VERSION — это не успех: значит сборка приехала без VERSION рядом со
   * спекой (pack-plugin кладёт его в vendor), и «развёрнуто» определить нечем.
   */
  if (!fs.existsSync(versionFile)) {
    return {
      ok: false,
      code: 'init-failed',
      error: 'init завершился, но ' + VERSION_REL + ' не появился: в сборке нет VERSION',
      log,
    };
  }
  const version = fs.readFileSync(versionFile, 'utf8').trim();
  return { ok: true, version, log };
}
