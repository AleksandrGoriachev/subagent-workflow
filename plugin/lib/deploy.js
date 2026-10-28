/**
 * Развёртывание движка в корень workspace (0.7.0).
 *
 * Единственная операция записи, которую панель делает по явной команде
 * пользователя: вложенная спека (`vendor/spec`) запускается через `init.mjs` в
 * выбранный корень. Модуль ничего не подписывает, не коммитит и не трогает
 * `guard.enabled` — это отдельная кнопка и отдельный маршрут.
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
   */
  const result = spawnSync(process.execPath, [init, '--repo', repo, '--force'], {
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
