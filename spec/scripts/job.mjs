#!/usr/bin/env node
/*
 * 2.6.31 (0072, WC-54): сторож в пакете — start / wait / status / list / kill.
 *
 * Почему: агент ждёт тяжёлый прогон сном (Start-Sleep, длинный wait в
 * инструменте). Каждое такое ожидание — потерянный шаг, невидимая работа и
 * невозможность остановиться. Здесь задание запускается отдельным процессом,
 * а ожидание блокируется на ФАЙЛЕ СОСТОЯНИЯ: процесс-сторож спит и читает
 * <repo>/.tmp/jobs/<id>.json, а не держит шаг агента.
 *
 * Состояние: <repo>/.tmp/jobs/<id>.json (состояние) и <id>.log (stdout+stderr
 * ребёнка). id — 12 hex-символов. Запускающий и ожидающий — разные процессы:
 * start отдаёт id и выходит, wait/list видят задание и после выхода агента.
 *
 * Вывод (вердикт в stdout, не кодом — харнесс нормализует нестандартные коды
 * фоновых заданий в 1 и шумит «ошибкой»):
 *   start  -- <cmd...>                    -> JOB <id>
 *   wait   <id> [--timeout с] [--interval с] -> DONE <id> exit=<код> <мс>ms | TIMEOUT <мс>ms <id>
 *   status <id>                           -> RUNNING <id> | DONE <id> exit=<код>
 *   list                                  -> <id> <состояние> <команда>
 *   kill   <id>                           -> KILLED <id>
 *
 * Коды выхода: 0 — штатная работа wait/status/list/kill (включая TIMEOUT);
 * 2 — ошибка аргументов; 3 — нет такого задания.
 *
 * Пайпов нет: и сторож, и ребёнок получают файловые дескрипторы
 * (см. spawnSyncPipeFree и runCommand в lib/common.mjs) — в ограниченной
 * песочнице DSH именованный канал открыть нельзя (EPERM).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { spawnSyncPipeFree } from './lib/common.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..', '..');
const SELF = fileURLToPath(import.meta.url);
const JOBS = path.join(PKG, '.tmp', 'jobs');

/* Минимум 0,1 с: ожидание не должно крутить процессор. */
const DEFAULT_INTERVAL_SEC = 1;
const MIN_INTERVAL_SEC = 0.1;

/* Терминальные состояния: дальше задание не меняется (кроме кода возврата). */
const TERMINAL = new Set(['DONE', 'KILLED', 'FAILED']);

function die(message, code = 2) {
  process.stderr.write('job: ' + message + String.fromCharCode(10));
  process.exit(code);
}

function stateFile(id) { return path.join(JOBS, id + '.json'); }
function logFile(id) { return path.join(JOBS, id + '.log'); }
function newId() { return crypto.randomBytes(6).toString('hex'); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function readState(id) {
  try {
    const state = JSON.parse(fs.readFileSync(stateFile(id), 'utf8'));
    return state && typeof state === 'object' && !Array.isArray(state) ? state : null;
  } catch {
    return null;
  }
}

/*
 * Запись через временный файл и rename: ожидающий читает состояние в цикле и
 * не должен увидеть половину JSON. При сбое rename (файл занят) — прямая запись:
 * читатель тогда просто повторит попытку на следующем тике.
 */
function writeState(id, state) {
  fs.mkdirSync(JOBS, { recursive: true });
  const target = stateFile(id);
  const tmp = target + '.' + process.pid + '.' + crypto.randomBytes(3).toString('hex') + '.tmp';
  const text = JSON.stringify(state, null, 2) + String.fromCharCode(10);
  try {
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, target);
  } catch {
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
    fs.writeFileSync(target, text, 'utf8');
  }
}

/* Код возврата ребёнка не теряется: числом, а если его нет — состоянием. */
function exitLabel(state) {
  if (state && Number.isInteger(state.exitCode)) return String(state.exitCode);
  if (state && typeof state.signal === 'string' && state.signal !== '') return state.signal;
  return String(state && state.status ? state.status : 'unknown').toLowerCase();
}

function durationMs(state, fallbackFrom) {
  if (state && Number.isInteger(state.durationMs)) return state.durationMs;
  const from = state && Number.isInteger(state.startedMs) ? state.startedMs : fallbackFrom;
  return Math.max(0, Date.now() - (Number.isInteger(from) ? from : Date.now()));
}

/*
 * Разбор аргументов в духе lib/common.mjs: «--ключ значение» и «--ключ=значение».
 * Всё после «--» — команда ребёнка, без разбора: у неё свои ключи.
 */
function parseArgs(argv) {
  const out = { _: [], opts: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') { out._.push(...argv.slice(i + 1)); break; }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) out.opts[arg.slice(2, eq)] = arg.slice(eq + 1);
      else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) { out.opts[arg.slice(2)] = next; i += 1; }
        else out.opts[arg.slice(2)] = true;
      }
    } else out._.push(arg);
  }
  return out;
}

/* ---------- start: запустить и вернуться ---------- */

function commandOf(argv) {
  const at = argv.indexOf('--');
  return at === -1 ? argv.slice() : argv.slice(at + 1);
}

function cmdStart(argv) {
  const cmd = commandOf(argv);
  if (cmd.length === 0) die('usage: job.mjs start -- <команда...>', 2);
  const id = newId();
  const startedMs = Date.now();
  fs.mkdirSync(JOBS, { recursive: true });
  fs.writeFileSync(logFile(id), '', 'utf8');
  const state = {
    id,
    command: cmd.join(' '),
    argv: cmd,
    cwd: process.cwd(),
    status: 'RUNNING',
    pid: null,
    childPid: null,
    startedAt: new Date(startedMs).toISOString(),
    startedMs,
    endedAt: null,
    durationMs: null,
    exitCode: null,
    signal: null,
  };
  writeState(id, state);
  /*
   * Сторож — тот же файл в служебном режиме __run: он и есть detached-процесс,
   * который дождётся ребёнка и запишет код возврата. Сам start ребёнка не ждёт
   * и выходит сразу; stdio у сторожа — ignore, у ребёнка — файл .log.
   */
  const supervisor = spawn(process.execPath, [SELF, '__run', id, '--', ...cmd], {
    cwd: state.cwd,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  supervisor.on('error', () => { /* сбой запуска увидит wait: состояние останется RUNNING до таймаута */ });
  try { supervisor.unref(); } catch { /* ignore */ }
  state.pid = supervisor.pid === undefined ? null : supervisor.pid;
  writeState(id, state);
  process.stdout.write('JOB ' + id + String.fromCharCode(10));
  return 0;
}

/* ---------- __run: сторож задания (служебный режим) ---------- */

function cmdRun(argv) {
  const id = argv[0];
  const state = readState(id);
  if (!state) process.exit(3);
  const cmd = commandOf(argv.slice(1));
  if (cmd.length === 0) process.exit(2);
  const startedMs = Number.isInteger(state.startedMs) ? state.startedMs : Date.now();

  const finish = (code, signal) => {
    const current = readState(id) || state;
    const exitCode = Number.isInteger(code) ? code : null;
    const next = {
      ...current,
      childPid: null,
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      exitCode,
      signal: typeof signal === 'string' && signal !== '' ? signal : null,
    };
    /* KILLED ставит kill: сторож не переписывает вердикт, только код возврата. */
    if (!TERMINAL.has(String(current.status))) next.status = exitCode === null ? 'FAILED' : 'DONE';
    writeState(id, next);
  };

  let fd;
  try {
    fd = fs.openSync(logFile(id), 'a');
  } catch (error) {
    finish(127, null);
    process.exit(0);
  }

  let child;
  try {
    child = spawn(cmd[0], cmd.slice(1), {
      cwd: typeof state.cwd === 'string' ? state.cwd : process.cwd(),
      windowsHide: true,
      stdio: ['ignore', fd, fd],
    });
  } catch (error) {
    try { fs.closeSync(fd); } catch { /* ignore */ }
    finish(127, null);
    process.exit(0);
  }

  const current = readState(id) || state;
  writeState(id, { ...current, childPid: child.pid === undefined ? null : child.pid, pid: process.pid });

  return new Promise((resolve) => {
    let done = false;
    const settle = (code, signal) => {
      if (done) return;
      done = true;
      try { fs.closeSync(fd); } catch { /* ignore */ }
      finish(code, signal);
      resolve(0);
    };
    child.on('error', () => settle(127, null));
    child.on('close', (code, signal) => settle(code, signal));
  });
}

/* ---------- wait: блокироваться на состоянии ---------- */

async function cmdWait(argv) {
  const parsed = parseArgs(argv);
  const id = parsed._[0];
  if (!id) die('usage: job.mjs wait <id> [--timeout <сек>] [--interval <сек>]', 2);
  if (!fs.existsSync(stateFile(id))) die('нет задания ' + id, 3);

  let timeoutSec = null;
  if (parsed.opts.timeout !== undefined) {
    const raw = typeof parsed.opts.timeout === 'string' ? parsed.opts.timeout.trim() : '';
    timeoutSec = raw === '' ? NaN : Number(raw);
    if (!Number.isFinite(timeoutSec) || timeoutSec < 0) die('--timeout: нужно число секунд ≥ 0', 2);
  }
  let intervalSec = DEFAULT_INTERVAL_SEC;
  if (parsed.opts.interval !== undefined) {
    const raw = typeof parsed.opts.interval === 'string' ? parsed.opts.interval.trim() : '';
    const value = raw === '' ? NaN : Number(raw);
    if (!Number.isFinite(value) || value <= 0) die('--interval: нужно число секунд > 0', 2);
    intervalSec = Math.max(MIN_INTERVAL_SEC, value);
  }
  const intervalMs = Math.round(intervalSec * 1000);
  const began = Date.now();
  const deadline = timeoutSec === null ? Infinity : began + Math.round(timeoutSec * 1000);

  for (;;) {
    const state = readState(id);
    if (state && TERMINAL.has(String(state.status))) {
      process.stdout.write('DONE ' + id + ' exit=' + exitLabel(state) + ' ' + durationMs(state, began) + 'ms' + String.fromCharCode(10));
      return 0;
    }
    const now = Date.now();
    if (now >= deadline) {
      process.stdout.write('TIMEOUT ' + (now - began) + 'ms ' + id + String.fromCharCode(10));
      return 0;
    }
    const left = deadline === Infinity ? intervalMs : Math.max(1, Math.min(intervalMs, deadline - now));
    await sleep(left);
  }
}

/* ---------- status ---------- */

function cmdStatus(argv) {
  const id = argv[0];
  if (!id) die('usage: job.mjs status <id>', 2);
  const state = readState(id);
  if (!state) die('нет задания ' + id, 3);
  if (!TERMINAL.has(String(state.status))) {
    process.stdout.write('RUNNING ' + id + String.fromCharCode(10));
  } else {
    process.stdout.write('DONE ' + id + ' exit=' + exitLabel(state) + String.fromCharCode(10));
  }
  return 0;
}

/* ---------- list ---------- */

function cmdList() {
  let names = [];
  try { names = fs.readdirSync(JOBS); } catch { return 0; }
  const states = names
    .filter((name) => name.endsWith('.json'))
    .map((name) => readState(name.slice(0, -5)))
    .filter(Boolean)
    .sort((left, right) => (left.startedMs || 0) - (right.startedMs || 0));
  for (const state of states) {
    process.stdout.write(state.id + ' ' + state.status + ' ' + (state.command || '') + String.fromCharCode(10));
  }
  return 0;
}

/* ---------- kill ---------- */

/* Завершение процесса (на Windows — с деревом потомков). Ошибки не бросают. */
function killTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform === 'win32') {
    const res = spawnSyncPipeFree('taskkill', ['/PID', String(pid), '/T', '/F'], { timeout: 15000 });
    if (res && res.status === 0) return;
  }
  try { process.kill(pid); } catch { /* уже завершён */ }
}

async function cmdKill(argv) {
  const id = argv[0];
  if (!id) die('usage: job.mjs kill <id>', 2);
  const state = readState(id);
  if (!state) die('нет задания ' + id, 3);
  if (!TERMINAL.has(String(state.status))) {
    /* Вердикт KILLED — первым: сторож не должен переписать его на DONE. */
    writeState(id, { ...state, status: 'KILLED', killedAt: new Date().toISOString() });
    killTree(state.childPid);
    /* Дать сторожу записать настоящий код возврата ребёнка (до 1 с). */
    const deadline = Date.now() + 1000;
    for (;;) {
      const now = readState(id);
      if (!now || now.exitCode !== null || Date.now() >= deadline) break;
      await sleep(50);
    }
    killTree(state.pid);
    const after = readState(id) || {};
    if (after.exitCode === null) writeState(id, { ...after, status: 'KILLED', exitCode: null });
  }
  process.stdout.write('KILLED ' + id + String.fromCharCode(10));
  return 0;
}

/* ---------- точка входа ---------- */

const argv = process.argv.slice(2);
const command = argv[0];
const rest = argv.slice(1);

async function main() {
  switch (command) {
    case 'start': return cmdStart(rest);
    case '__run': return cmdRun(rest);
    case 'wait': return cmdWait(rest);
    case 'status': return cmdStatus(rest);
    case 'list': return cmdList();
    case 'kill': return cmdKill(rest);
    default:
      die('usage: job.mjs start -- <команда...> | wait <id> [--timeout с] [--interval с] | status <id> | list | kill <id>', 2);
  }
  return 0;
}

main().then((code) => { process.exitCode = code || 0; }).catch((error) => {
  process.stderr.write('job: ' + (error && error.message ? error.message : String(error)) + String.fromCharCode(10));
  process.exitCode = 1;
});
