/*
 * Адаптер репозитория: единственное место, где читаются файлы и git.
 *
 * 0179: часть state.js; публичный вход — plugin/lib/state.js (баррель).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { TOOL, STAGE_ORDER, DEFAULT_CONFIG } from './constants.js';
import { toPosix, fromPosix, sha256Bytes, exists, readText, readJsonSafe } from './primitives.js';
import { parseTaskMeta } from './contract.js';
import { buildTaskState, boardTask, countStages } from './task-state.js';
/* ------------------------------------------------------------------ *
 * repository adapter (the only place that reads files)
 * ------------------------------------------------------------------ */

export function loadConfig(root) {
  const file = path.join(root, 'docs', 'subagent-workflow', 'workflow.config.json');
  const raw = readJsonSafe(file);
  if (raw.error) {
    return { ...DEFAULT_CONFIG, loaded: false, file, error: raw.error };
  }
  if (!raw.value) return { ...DEFAULT_CONFIG, loaded: false, file, error: null };
  const value = raw.value;
  return {
    ...DEFAULT_CONFIG,
    ...value,
    actor: { ...DEFAULT_CONFIG.actor, ...(value.actor || {}) },
    policy: {
      ...DEFAULT_CONFIG.policy,
      ...(value.policy || {}),
      roles: { ...DEFAULT_CONFIG.policy.roles, ...((value.policy || {}).roles || {}) },
    },
    models: { ...DEFAULT_CONFIG.models, ...(value.models || {}) },
    roles: { ...DEFAULT_CONFIG.roles, ...(value.roles || {}) },
    loaded: true,
    file,
    error: null,
  };
}

/**
 * Run a command with its output captured through temporary files instead of
 * pipes. DSH's workspace sandbox denies piped stdio (EPERM), while file-backed
 * stdio keeps read-only git usable inside the same sandbox.
 */
export function captureCommand(command, args, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-console-cmd-'));
  const outFile = path.join(dir, 'stdout');
  const errFile = path.join(dir, 'stderr');
  let outFd;
  let errFd;
  try {
    outFd = fs.openSync(outFile, 'w');
    errFd = fs.openSync(errFile, 'w');
    const result = spawnSync(command, args, {
      cwd: options.cwd,
      windowsHide: true,
      timeout: options.timeoutMs || 20000,
      stdio: ['ignore', outFd, errFd],
    });
    let stdout = '';
    let stderr = '';
    try { stdout = fs.readFileSync(outFile, 'utf8'); } catch { /* ignore */ }
    try { stderr = fs.readFileSync(errFile, 'utf8'); } catch { /* ignore */ }
    return {
      status: result.status,
      signal: result.signal || null,
      error: result.error || null,
      stdout,
      stderr,
    };
  } finally {
    if (outFd !== undefined) { try { fs.closeSync(outFd); } catch { /* ignore */ } }
    if (errFd !== undefined) { try { fs.closeSync(errFd); } catch { /* ignore */ } }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

/** Read-only git helper. Never passes a mutating subcommand. */
export function runGit(root, args) {
  /*
   * 0098 (2.6.93): под нагрузкой локальный git иногда не укладывался в 20 с
   * (ETIMEDOUT на «git config user.email»), и гейт тестов падал ложным красным.
   * Таймаут настраивается WF_GIT_TIMEOUT_MS, по умолчанию 120 с.
   */
  const gitTimeoutMs = Number(process.env.WF_GIT_TIMEOUT_MS) || 120000;
  try {
    const result = captureCommand('git', ['-C', root, ...args], { timeoutMs: gitTimeoutMs });
    const ok = !result.error && result.status === 0;
    return { ok, status: result.status, stdout: result.stdout, stderr: result.stderr, error: result.error };
  } catch (error) {
    return { ok: false, status: null, stdout: '', stderr: '', error };
  }
}

export function readGitHead(root) {
  const result = runGit(root, ['rev-parse', '--verify', 'HEAD']);
  return result.ok ? result.stdout.trim() : null;
}

export function readGitLog(root, paths, limit = 20) {
  const target = paths && paths.length > 0 ? paths.map(toPosix) : ['.'];
  const result = runGit(root, [
    'log',
    '-n', String(limit),
    '--date=short',
    '--pretty=format:%h%x09%ad%x09%s',
    '--',
    ...target,
  ]);
  if (!result.ok) return [];
  const out = [];
  for (const line of result.stdout.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const hash = parts.shift() || '';
    const date = parts.shift() || '';
    const subject = parts.join('\t');
    out.push({ hash, date, subject });
  }
  return out;
}

function walkFiles(root) {
  const out = [];
  const skipDirs = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__']);
  const walk = (dir, rel) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const childRel = rel ? rel + '/' + entry.name : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        walk(path.join(dir, entry.name), childRel);
      } else if (entry.isFile()) {
        out.push(childRel);
      }
    }
  };
  walk(root, '');
  return out;
}

export function listRepoFiles(root) {
  const tracked = runGit(root, ['ls-files', '-z']);
  if (tracked.ok) {
    const set = new Set();
    for (const item of tracked.stdout.split('\0')) if (item) set.add(toPosix(item));
    const untracked = runGit(root, ['ls-files', '--others', '--exclude-standard', '-z']);
    if (untracked.ok) for (const item of untracked.stdout.split('\0')) if (item) set.add(toPosix(item));
    return [...set].sort();
  }
  return walkFiles(root).sort();
}

export function globToRegExp(pattern) {
  const source = toPosix(pattern);
  let regex = '^';
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === '*') {
      if (source[i + 1] === '*') {
        i += 1;
        if (source[i + 1] === '/') {
          i += 1;
          regex += '(?:.*/)?';
        } else {
          regex += '.*';
        }
      } else {
        regex += '[^/]*';
      }
    } else if (char === '?') {
      regex += '[^/]';
    } else if (char === '[') {
      const end = source.indexOf(']', i + 1);
      if (end === -1) regex += '\\[';
      else {
        regex += source.slice(i, end + 1);
        i = end;
      }
    } else {
      regex += char.replace(/[.+^\${}()|\\]/g, '\\$&');
    }
  }
  return new RegExp(regex + '$');
}

export function matchesAny(file, patterns) {
  const value = toPosix(file);
  return (patterns || []).some((pattern) => globToRegExp(pattern).test(value));
}

/** Hash the protected files of one task, with a per-run stat cache. */
export function hashProtectedFiles(root, meta, taskRel, { repoFiles, hashCache } = {}) {
  const patterns = meta && Array.isArray(meta.protectedPaths) ? meta.protectedPaths : [];
  if (patterns.length === 0) return [];
  const exclude = [
    '.git/**',
    'node_modules/**',
    String(taskRel) + '/**',
    ...(meta && Array.isArray(meta.hashExclude) ? meta.hashExclude : []),
  ];
  const files = (repoFiles || []).filter((file) => matchesAny(file, patterns) && !matchesAny(file, exclude));
  return files.sort().map((file) => {
    const absolute = path.join(root, fromPosix(file));
    let stat;
    try {
      stat = fs.statSync(absolute);
    } catch {
      return { path: file, sha256: null };
    }
    const key = absolute + '\0' + stat.mtimeMs + '\0' + stat.size;
    if (hashCache && hashCache.has(key)) return { path: file, sha256: hashCache.get(key) };
    let hash = null;
    try {
      hash = sha256Bytes(fs.readFileSync(absolute));
    } catch {
      hash = null;
    }
    if (hashCache) hashCache.set(key, hash);
    return { path: file, sha256: hash };
  });
}

function readPackageInfo(root) {
  const workflowDir = path.join(root, 'docs', 'subagent-workflow');
  let packageVersion = null;
  const versionFile = path.join(workflowDir, 'VERSION');
  if (exists(versionFile)) {
    const text = readText(versionFile).trim();
    if (text) packageVersion = text;
  }
  let specVersion = null;
  const specFile = path.join(workflowDir, 'SPEC.md');
  if (exists(specFile)) {
    const head = readText(specFile).split('\n').slice(0, 20).join('\n');
    const match = head.match(/Версия:\s*([0-9]+(?:\.[0-9]+)*)/);
    if (match) specVersion = match[1];
  }
  const versionSource = packageVersion
    ? 'VERSION'
    : specVersion
      ? 'SPEC'
      : null;
  if (!packageVersion) packageVersion = specVersion;
  return { packageVersion, specVersion, versionSource };
}

/** Which workflow files exist in the deployed copy (used by compat checks). */
export function readWorkflowInfo(root) {
  const dir = path.join(path.resolve(root), 'docs', 'subagent-workflow');
  const has = (rel) => exists(path.join(dir, rel));
  return {
    dir: exists(dir),
    spec: has('SPEC.md'),
    versionFile: has('VERSION'),
    attackGate: has('scripts/task-attack.mjs'),
    policyLib: has('scripts/lib/policy.mjs'),
    checkAcceptance: has('scripts/task-check-acceptance.mjs'),
    templates: has('templates/task.md'),
  };
}

function readOneTask(root, dir, { config, repoFiles, hashCache, baseline = null }) {
  const parseErrors = [];
  const files = {
    task: path.join(dir, 'task.md'),
    criteria: path.join(dir, 'criteria.json'),
    lock: path.join(dir, 'criteria.lock'),
    attack: path.join(dir, 'attack.json'),
    red: path.join(dir, 'red.json'),
    verify: path.join(dir, 'verify.json'),
    acceptance: path.join(dir, 'acceptance.json'),
  };
  const present = {};
  for (const [name, file] of Object.entries(files)) present[name] = exists(file);
  const taskMd = present.task ? readText(files.task) : null;
  const criteriaRaw = present.criteria ? readText(files.criteria) : null;
  const lockRaw = readJsonSafe(files.lock);
  if (lockRaw.error) parseErrors.push({ file: 'criteria.lock', message: lockRaw.error });
  const attackRaw = readJsonSafe(files.attack);
  if (attackRaw.error) parseErrors.push({ file: 'attack.json', message: attackRaw.error });
  const redRaw = readJsonSafe(files.red);
  if (redRaw.error) parseErrors.push({ file: 'red.json', message: redRaw.error });
  const verifyRaw = readJsonSafe(files.verify);
  if (verifyRaw.error) parseErrors.push({ file: 'verify.json', message: verifyRaw.error });
  const acceptanceRaw = readJsonSafe(files.acceptance);
  if (acceptanceRaw.error) parseErrors.push({ file: 'acceptance.json', message: acceptanceRaw.error });

  const metaResult = parseTaskMeta(taskMd);
  const id = String(metaResult.ok && metaResult.meta.id !== undefined ? metaResult.meta.id : path.basename(dir));
  const taskRel = toPosix(path.relative(root, dir));
  const protectedActual = metaResult.ok && lockRaw.value
    ? hashProtectedFiles(root, metaResult.meta, taskRel, { repoFiles, hashCache })
    : null;
  const attackSha256 = exists(path.join(dir, 'attack.json'))
    ? sha256Bytes(fs.readFileSync(path.join(dir, 'attack.json')))
    : null;

  return buildTaskState({
    id,
    dir: taskRel,
    regress: baseline && baseline.byTask ? baseline.byTask[String(id)] || null : null,
    taskMd,
    criteriaRaw,
    lock: lockRaw.value,
    attack: attackRaw.value,
    red: redRaw.value,
    verify: verifyRaw.value,
    acceptance: acceptanceRaw.value,
    present,
    attackSha256,
    protectedActual,
    config,
    head: null,
    gitLog: null,
    parseErrors,
  });
}

/**
 * regress.baseline.json (2.3.1): легализованный долг регресса.
 *
 * Панель — только чтение: сама она регресс не запускает (это ворота), и на диске
 * от него остаётся ровно этот файл. Читаем его, чтобы назвать статус задания и
 * срок пересмотра, а не выдумывать «регресс не проверялся».
 */
export function readBaseline(root) {
  const resolved = path.resolve(root);
  const file = path.join(resolved, 'regress.baseline.json');
  const rel = 'regress.baseline.json';
  const empty = { present: false, path: rel, generatedAt: null, version: null, entries: [], byTask: {}, expired: [], error: null };
  if (!exists(file)) return empty;
  let parsed;
  try {
    parsed = JSON.parse(readText(file));
  } catch (error) {
    return { ...empty, present: true, error: String(error && error.message ? error.message : error) };
  }
  const today = new Date().toISOString().slice(0, 10);
  const entries = (Array.isArray(parsed && parsed.entries) ? parsed.entries : [])
    .filter((entry) => entry && typeof entry.task === 'string' && typeof entry.status === 'string')
    .map((entry) => ({
      task: String(entry.task),
      status: String(entry.status),
      reason: String(entry.reason || ''),
      since: entry.since ? String(entry.since) : null,
      reviewBy: entry.reviewBy ? String(entry.reviewBy) : null,
      expired: Boolean(entry.reviewBy && String(entry.reviewBy).slice(0, 10) < today),
    }));
  const byTask = {};
  for (const entry of entries) if (!byTask[entry.task]) byTask[entry.task] = entry;
  return {
    present: true,
    path: rel,
    generatedAt: parsed && parsed.generatedAt ? String(parsed.generatedAt) : null,
    version: parsed && parsed.version !== undefined ? Number(parsed.version) || null : null,
    entries,
    byTask,
    expired: entries.filter((entry) => entry.expired),
    error: null,
  };
}

/** Read the whole repository: config, task list and every task's board state. */
export function readRepository(root, options = {}) {
  const resolved = path.resolve(root);
  const config = loadConfig(resolved);
  const tasksDirRel = toPosix(config.tasksDir || 'docs/tasks');
  const tasksDir = path.resolve(resolved, fromPosix(tasksDirRel));
  const repoFiles = listRepoFiles(resolved);
  const hashCache = new Map();
  const head = readGitHead(resolved);
  const packageInfo = readPackageInfo(resolved);
  const baseline = readBaseline(resolved);
  const tasks = [];
  const skipped = [];

  let entries = [];
  try {
    entries = fs.readdirSync(tasksDir, { withFileTypes: true });
  } catch (error) {
    skipped.push({ path: tasksDirRel, reason: 'каталог заданий не читается: ' + String(error.message || error) });
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue;
    const dir = path.join(tasksDir, entry.name);
    const rel = toPosix(path.join(tasksDirRel, entry.name));
    if (!entry.isDirectory()) {
      skipped.push({ path: rel, reason: 'плоский файл: формат v1.1, не v2' });
      continue;
    }
    if (!exists(path.join(dir, 'task.md'))) {
      skipped.push({ path: rel, reason: 'каталог без task.md' });
      continue;
    }
    tasks.push(readOneTask(resolved, dir, { config, repoFiles, hashCache, baseline }));
  }

  const order = new Map(STAGE_ORDER.map((code, index) => [code, index]));
  tasks.sort((a, b) => {
    const stage = (order.get(a.stage) || 0) - (order.get(b.stage) || 0);
    if (stage !== 0) return stage;
    return String(a.id).localeCompare(String(b.id), 'ru');
  });

  return {
    root: resolved,
    tasksDir: tasksDirRel,
    config,
    configPath: config.file,
    configLoaded: config.loaded,
    packageVersion: packageInfo.packageVersion,
    specVersion: packageInfo.specVersion,
    versionSource: packageInfo.versionSource,
    workflow: readWorkflowInfo(resolved),
    head,
    tasks: tasks.map(boardTask),
    counts: countStages(tasks),
    skipped,
    /* 0.4.0: долг регресса — на доске, а не только в терминале. */
    regress: {
      present: baseline.present,
      path: baseline.path,
      generatedAt: baseline.generatedAt,
      error: baseline.error,
      entries: baseline.entries.length,
      expired: baseline.expired.length,
    },
    tool: TOOL,
  };
}

/** Light repository header: config, paths, versions and HEAD, without tasks. */
export function readRepoInfo(root) {
  const resolved = path.resolve(root);
  const config = loadConfig(resolved);
  const info = readPackageInfo(resolved);
  return {
    root: resolved,
    tasksDir: toPosix(config.tasksDir || 'docs/tasks'),
    configPath: config.file,
    configLoaded: config.loaded,
    config,
    packageVersion: info.packageVersion,
    specVersion: info.specVersion,
    versionSource: info.versionSource,
    workflow: readWorkflowInfo(resolved),
    head: readGitHead(resolved),
  };
}

/** Read one task with the full card, including read-only git log. */
export function readTask(root, id) {
  const resolved = path.resolve(root);
  const config = loadConfig(resolved);
  const tasksDirRel = toPosix(config.tasksDir || 'docs/tasks');
  const tasksDir = path.resolve(resolved, fromPosix(tasksDirRel));
  const safeId = String(id);
  if (safeId.length === 0 || safeId !== path.basename(safeId) || safeId === '.' || safeId === '..') {
    return { error: 'некорректный id задачи', status: 400 };
  }
  const dir = path.resolve(tasksDir, safeId);
  if (!exists(path.join(dir, 'task.md'))) {
    return { error: 'задача не найдена: ' + safeId, status: 404 };
  }
  const repoFiles = listRepoFiles(resolved);
  const hashCache = new Map();
  const state = readOneTask(resolved, dir, { config, repoFiles, hashCache, baseline: readBaseline(resolved) });
  const taskRel = toPosix(path.relative(resolved, dir));
  const head = readGitHead(resolved);
  const log = readGitLog(resolved, [taskRel]);
  return {
    ...state,
    git: { head, log },
    packageVersion: readPackageInfo(resolved).packageVersion,
  };
}

