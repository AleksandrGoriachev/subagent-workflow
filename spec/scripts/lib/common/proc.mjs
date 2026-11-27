/*
 * Процессы: синхронный запуск без пайпов, запуск команды с таймаутом.
 *
 * 0181: часть spec/scripts/lib/common.mjs; публичный вход — common.mjs.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
export function runSync(command, opts = {}) {
  const started = Date.now();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cmd-'));
  const outFile = path.join(dir, 'stdout');
  const errFile = path.join(dir, 'stderr');
  let ofd;
  let efd;
  let res;
  try {
    ofd = fs.openSync(outFile, 'w');
    efd = fs.openSync(errFile, 'w');
    const childEnv = { ...process.env, ...(opts.env || {}) };
    for (const key of opts.unsetEnv || []) delete childEnv[key];
    res = spawnSync(command, {
      shell: true,
      cwd: opts.cwd || process.cwd(),
      timeout: opts.timeoutMs || 120000,
      env: childEnv,
      windowsHide: true,
      stdio: ['ignore', ofd, efd],
    });
  } finally {
    if (ofd !== undefined) { try { fs.closeSync(ofd); } catch { /* ignore */ } }
    if (efd !== undefined) { try { fs.closeSync(efd); } catch { /* ignore */ } }
  }
  let stdout = '';
  let stderr = '';
  try { stdout = fs.readFileSync(outFile, 'utf8'); } catch { /* ignore */ }
  try { stderr = fs.readFileSync(errFile, 'utf8'); } catch { /* ignore */ }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  return {
    exitCode: res && res.status !== null ? res.status : (res && res.error ? 127 : (res && res.signal ? 124 : 0)),
    stdout,
    stderr,
    signal: res ? res.signal || null : null,
    timedOut: Boolean(res && res.error && (res.error.code === 'ETIMEDOUT' || res.error.killed)),
    durationMs: Date.now() - started,
    error: res ? res.error || null : null,
  };
}

/*
 * Синхронный запуск без пайпов (0059, WC-37). В ограниченной песочнице DSH
 * процесс не может открыть именованный канал: spawnSync с stdio 'pipe' (в том
 * числе по умолчанию) падает с EPERM. Здесь вывод ребёнка идёт в два временных
 * файла, которые отдаются в stdio ['ignore', ofd, efd], после завершения
 * читаются и удаляются.
 *
 * Результат совместим со spawnSync: { status, stdout, stderr, signal, error }.
 * Поддержаны cwd, env, timeout, windowsHide и encoding: 'utf8' даёт строки,
 * 'buffer' или отсутствие encoding — Buffer, как у spawnSync по умолчанию.
 * Отсутствующий бинарник не бросает: status: null и заполненный error.
 */
/**
 * 0146: запущен ли файл как CLI. Сравнение через realpath + pathToFileURL — иначе
 * на Windows короткое имя каталога (GORYAC~1) не совпадает с import.meta.url, и
 * скрипт молча выходит с кодом 0, ничего не сделав (находка: e2e --audit).
 */
export function isMainModule(metaUrl, argvPath = process.argv[1]) {
  if (!argvPath) return false;
  try {
    return metaUrl === pathToFileURL(fs.realpathSync(argvPath)).href;
  } catch {
    return false;
  }
}

export function spawnSyncPipeFree(command, args, options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const list = Array.isArray(args) ? args : [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-spawn-'));
  const outFile = path.join(dir, 'stdout');
  const errFile = path.join(dir, 'stderr');
  let ofd;
  let efd;
  let ifd;
  let res = null;
  let launchError = null;
  /* 0143: stdin тоже через файл — иначе git credential fill без пайпа не ответит. */
  const inFile = path.join(dir, 'stdin');
  if (typeof opts.input === 'string') fs.writeFileSync(inFile, opts.input);
  try {
    ofd = fs.openSync(outFile, 'w');
    efd = fs.openSync(errFile, 'w');
    ifd = typeof opts.input === 'string' ? fs.openSync(inFile, 'r') : null;
    res = spawnSync(command, list, {
      cwd: opts.cwd || process.cwd(),
      env: opts.env && typeof opts.env === 'object' ? opts.env : process.env,
      timeout: opts.timeout,
      windowsHide: opts.windowsHide === true,
      stdio: [ifd === null ? 'ignore' : ifd, ofd, efd],
    });
  } catch (error) {
    launchError = error;
  } finally {
    if (ifd !== null && ifd !== undefined) { try { fs.closeSync(ifd); } catch { /* ignore */ } }
    if (ofd !== undefined) { try { fs.closeSync(ofd); } catch { /* ignore */ } }
    if (efd !== undefined) { try { fs.closeSync(efd); } catch { /* ignore */ } }
  }
  const asText = opts.encoding === 'utf8';
  const read = (file) => {
    try {
      const data = fs.readFileSync(file);
      return asText ? data.toString('utf8') : data;
    } catch {
      return asText ? '' : Buffer.alloc(0);
    }
  };
  const stdout = read(outFile);
  const stderr = read(errFile);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  return {
    status: res && res.status !== undefined ? res.status : null,
    stdout,
    stderr,
    signal: res ? res.signal || null : null,
    error: launchError || (res ? res.error || null : null),
  };
}


export function runCommand(command, opts = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const maxOutput = opts.maxOutput || 5 * 1024 * 1024;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cmd-'));
    const outFile = path.join(dir, 'stdout');
    const errFile = path.join(dir, 'stderr');
    let ofd;
    let efd;
    let child;
    let timer;
    let timedOut = false;
    let done = false;

    const finalize = (code, signal, error) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      if (ofd !== undefined) { try { fs.closeSync(ofd); } catch { /* ignore */ } }
      if (efd !== undefined) { try { fs.closeSync(efd); } catch { /* ignore */ } }
      let stdout = '';
      let stderr = '';
      let outputTruncated = false;
      try {
        const outSize = fs.statSync(outFile).size;
        const errSize = fs.statSync(errFile).size;
        outputTruncated = outSize > maxOutput || errSize > maxOutput;
        stdout = fs.readFileSync(outFile).subarray(0, maxOutput).toString('utf8');
        stderr = fs.readFileSync(errFile).subarray(0, maxOutput).toString('utf8');
      } catch { /* ignore */ }
      if (error) stderr = (stderr ? stderr + String.fromCharCode(10) : '') + error.message;
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
      resolve({
        exitCode: error ? 127 : (code === null ? 124 : code),
        stdout, stderr, signal: signal || null, timedOut,
        durationMs: Date.now() - started, outputTruncated, error: error || null,
      });
    };

    try {
      ofd = fs.openSync(outFile, 'w');
      efd = fs.openSync(errFile, 'w');
      const childEnv = { ...process.env, ...(opts.env || {}) };
      for (const key of opts.unsetEnv || []) delete childEnv[key];
      child = spawn(command, {
        shell: true,
        cwd: opts.cwd || process.cwd(),
        env: childEnv,
        windowsHide: true,
        stdio: ['ignore', ofd, efd],
      });
    } catch (error) {
      finalize(127, null, error);
      return;
    }

    timer = setTimeout(() => { timedOut = true; try { child.kill('SIGTERM'); } catch { /* ignore */ } }, opts.timeoutMs || 120000);
    child.on('error', (error) => finalize(127, null, error));
    child.on('close', (code, signal) => finalize(timedOut && code === null ? 124 : code, signal, null));
  });
}

/*
 * Пул критериев (0045, WC-12): независимые проверки ворот идут параллельно.
 *
 * 0041: три прогона ворот по 189 с при max(критерий) = 115 с — 74 с чистой
 * суммы на каждом прогоне. Критерии не делят состояние (runCheck изолирует
 * временные корни), поэтому прогон идёт по max, а не по сумме, а порядок строк
 * остаётся прежним — по списку criteria.json, а не по порядку завершения.
 *
 * Степень параллелизма: options.concurrency → WF_CRITERIA_PARALLEL → 4.
 * Значение 1 — строго последовательно, прежнее поведение. Нечисло или число
 * меньше 1 не валит ворота: берётся следующее по приоритету значение.
 */
export function criteriaConcurrency(options = {}) {
  const parse = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 1) return null;
    return Math.floor(n);
  };
  const declared = parse(options.concurrency);
  if (declared !== null) return declared;
  const fromEnv = parse(process.env.WF_CRITERIA_PARALLEL);
  return fromEnv === null ? 4 : fromEnv;
}

/**
 * Запускает критерии пулом и возвращает строки в порядке входного списка.
 *
 * Каждый критерий идёт через runCommand с cwd из c.cwd (относительно
 * options.cwd/options.repo), timeoutMs из c.timeoutMs (иначе options.timeoutMs,
 * иначе 120000) и env из options/env. Падение одного критерия не отменяет и не
 * обрывает остальные: исключение runCommand превращается в строку с
 * exitCode !== 0 и текстом ошибки в output, а не в reject пула.
 *
 * Строка: { id, command, exitCode, output, durationMs } плюс stdout/stderr/
 * timedOut — ворота пишут по ним лог и причины, не запуская критериев заново.
 * Manual-критерии не исполняются и строк не дают.
 */
