/**
 * Diagnostics: run one of the package's read-only gates and return its log.
 *
 * This is the first place where the panel *does* something instead of only
 * reading. The boundary is explicit and narrow:
 *  - a fixed allowlist of three checks (doctor, lint, check-acceptance);
 *  - every one of them only reads the repository — no lock, record or config
 *    is written, and the panel never signs or accepts anything;
 *  - the command is spawned without a shell, so nothing from the URL or the
 *    body reaches a command line unquoted;
 *  - output goes to a log file rather than a pipe: inside the DSH sandbox a
 *    child with piped stdio fails with EPERM, while file descriptors work.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

export const CHECK_IDS = ['doctor', 'lint', 'check-acceptance'];

const DEFAULT_TIMEOUT_MS = 120000;
const LOG_TAIL_CHARS = 24000;

/** Where the panel explains what it is about to run. */
export const CHECK_TITLES = {
  doctor: 'doctor — окружение, ключи, шаблоны, политика',
  lint: 'lint — задание и критерии против правил',
  'check-acceptance': 'check-acceptance — подпись и полнота записи',
};

function normalizeRel(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//u, '');
}

/**
 * Resolve one check into a concrete command. Throws an Error with a readable
 * message when the deployed copy cannot run it (old workflow, missing task).
 */
export function buildCheck(id, input) {
  if (!CHECK_IDS.includes(id)) throw new Error('неизвестная проверка: ' + String(id));
  const root = String(input.root || '');
  if (!root) throw new Error('не указан корень репозитория');
  const tasksDir = normalizeRel(input.tasksDir || 'docs/tasks');
  const workflowDir = 'docs/subagent-workflow';
  const taskId = input.task ? String(input.task) : '';
  if (taskId && !/^[A-Za-z0-9._-]+$/u.test(taskId)) throw new Error('некорректный id задачи: ' + taskId);
  const taskRel = taskId ? tasksDir + '/' + taskId : '';

  let script;
  let args;
  if (id === 'doctor') {
    script = workflowDir + '/scripts/doctor.mjs';
    args = ['--repo', '.'];
  } else if (id === 'lint') {
    if (!taskRel) throw new Error('lint запускается для задачи: не передан id');
    script = workflowDir + '/scripts/task-lint.mjs';
    args = ['--task', taskRel];
  } else {
    if (!taskRel) throw new Error('check-acceptance запускается для задачи: не передан id');
    script = workflowDir + '/scripts/task-check-acceptance.mjs';
    args = ['--file', taskRel + '/acceptance.json', '--repo', '.', '--task', taskRel];
    const keysFile = input.keysFile ? normalizeRel(input.keysFile) : '';
    if (keysFile) args.push('--keys', keysFile);
  }

  const scriptPath = path.join(root, script.split('/').join(path.sep));
  if (!fs.existsSync(scriptPath)) {
    throw new Error('скрипт не найден: ' + script + ' — развёрнутая копия workflow старше 2.0?');
  }
  return {
    id,
    title: CHECK_TITLES[id],
    root,
    script,
    scriptPath,
    args,
    cwd: root,
    command: 'node ' + script + ' ' + args.join(' '),
  };
}

function clampTimeout(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(number, 5000), 30 * 60000);
}

/**
 * Run the resolved command, wait for it, and read the log back. Never rejects
 * for a non-zero exit code: a failing check is a result, not an error.
 */
export async function runCheck(spec, options = {}) {
  const timeoutMs = clampTimeout(options.timeoutMs);
  const logDir = path.join(os.tmpdir(), 'dsh-workflow-console');
  fs.mkdirSync(logDir, { recursive: true });
  const stamp = crypto.randomBytes(6).toString('hex');
  const logPath = path.join(logDir, spec.id + '-' + stamp + '.log');
  const fd = fs.openSync(logPath, 'w');
  const started = Date.now();
  let timedOut = false;
  let spawnError = null;
  let exitCode = null;
  let signal = null;

  try {
    await new Promise((resolve) => {
      let child;
      try {
        child = spawn(process.execPath, [spec.scriptPath, ...spec.args], {
          cwd: spec.cwd,
          stdio: ['ignore', fd, fd],
          windowsHide: true,
          env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
        });
      } catch (error) {
        spawnError = error;
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        timedOut = true;
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
      child.on('error', (error) => { spawnError = error; });
      child.on('close', (code, sig) => {
        clearTimeout(timer);
        exitCode = code;
        signal = sig;
        resolve();
      });
    });
  } finally {
    try { fs.closeSync(fd); } catch { /* already closed */ }
  }

  let log = '';
  try {
    log = fs.readFileSync(logPath, 'utf8');
  } catch {
    log = '';
  }
  const truncated = log.length > LOG_TAIL_CHARS;
  const tail = truncated ? log.slice(log.length - LOG_TAIL_CHARS) : log;
  const durationMs = Date.now() - started;
  return {
    check: spec.id,
    title: spec.title,
    command: spec.command,
    cwd: spec.cwd,
    exitCode: spawnError ? null : exitCode,
    ok: !timedOut && !spawnError && exitCode === 0,
    timedOut,
    signal: signal || null,
    durationMs,
    timeoutMs,
    logPath,
    log: tail.trim(),
    truncated,
    error: spawnError ? (spawnError.message || String(spawnError)) : null,
    writeFree: true,
  };
}
